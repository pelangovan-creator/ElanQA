import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { extname } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdService } from '../common/id.service';
import { StorageService } from '../common/storage.service';
import { AiService } from '../ai/ai.service';
import { AuthUser } from '../common/decorators';
import { roleHas } from '../common/permissions';
import { REQUIREMENT_CATEGORIES } from '../common/enums';
import { parseDocument, SUPPORTED_EXTENSIONS } from './parsing';
import { atomize, AtomicItem } from './analysis/atomizer';
import { classify } from './analysis/classifier';
import { findAmbiguities, questionFor } from './analysis/ambiguity';
import { reverseCheck } from './analysis/reverse-check';
import { diffItems } from './analysis/diff';
import { aiClassify } from './analysis/ai-classifier';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DOC_TYPES = ['BRD', 'FRD', 'SRS', 'UserStory', 'Wireframe', 'Email', 'ChangeRequest', 'Other'] as const;
const NO_TEST_KINDS = new Set(['Header']);

export interface UploadedFile { buffer: Buffer; originalname: string; mimetype: string; size: number }

interface ItemDraft extends AtomicItem {
  category: string;
  subCategory?: string;
  ambiguousTerms: string[];
  aiGenerated: boolean;
  changeType?: 'Added' | 'Modified' | 'Unchanged';
  previousText?: string;
  inherit?: { oldId: string; coverageStatus: string; noTestReason: string | null; acknowledgedById: string | null; acknowledgedAt: Date | null };
}

@Injectable()
export class RequirementsService {
  private readonly logger = new Logger(RequirementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
  ) {}

  // ───────────────────────────── Upload & versioning ─────────────────────────────

  async upload(projectId: string, user: AuthUser, file: UploadedFile | undefined, meta: { title?: string; docType?: string }, documentId?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('A non-empty file is required');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    const ext = extname(file.originalname).toLowerCase();
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BadRequestException(`Unsupported file type "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    }

    let doc;
    if (documentId) {
      doc = await this.prisma.requirementDocument.findFirst({ where: { id: documentId, projectId } });
      if (!doc) throw new NotFoundException('Document not found');
    } else {
      const title = meta.title?.trim() || file.originalname;
      const docType = meta.docType && (DOC_TYPES as readonly string[]).includes(meta.docType) ? meta.docType : 'Other';
      doc = await this.prisma.requirementDocument.create({
        data: { projectId, docKey: await this.ids.next(projectId, 'DOC'), title, docType },
      });
    }

    const sha256 = StorageService.sha256(file.buffer);
    const previous = await this.prisma.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { version: 'desc' } });
    if (previous?.sha256 === sha256) throw new ConflictException(`This file is identical to version ${previous.version}`);

    const storagePath = await this.storage.put(['projects', projectId, 'documents', doc.id], file.originalname, file.buffer);
    const version = await this.prisma.documentVersion.create({
      data: {
        documentId: doc.id, version: (previous?.version ?? 0) + 1, fileName: file.originalname, mimeType: file.mimetype || 'application/octet-stream',
        storagePath, sha256, sizeBytes: file.size, uploadedById: user.id,
      },
    });

    const lastParsed = await this.prisma.documentVersion.findFirst({ where: { documentId: doc.id, parseStatus: 'Parsed', id: { not: version.id } }, orderBy: { version: 'desc' } });
    try {
      await this.process(projectId, version.id, lastParsed?.id, user);
    } catch (err) {
      const message = err instanceof BadRequestException ? err.message : `Parsing failed: ${(err as Error).message}`;
      this.logger.error(`Version ${version.id}: ${message}`);
      await this.prisma.documentVersion.update({ where: { id: version.id }, data: { parseStatus: 'Failed', parseError: message } });
    }
    await this.audit.log({ userId: user.id, projectId, action: 'UPLOAD', entityType: 'DocumentVersion', entityId: version.id, after: { document: doc.docKey, version: version.version, fileName: file.originalname, sha256 } });
    return this.getVersion(projectId, version.id);
  }

  /** Parse → atomise → classify → diff vs. previous version → persist → reverse check → coverage. */
  private async process(projectId: string, versionId: string, previousVersionId: string | undefined, user: AuthUser) {
    const version = await this.prisma.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
    const parsed = await parseDocument(await this.storage.get(version.storagePath), version.fileName);
    if (!parsed.blocks.length) throw new BadRequestException('No text could be extracted from the document');

    const firstBlock = await this.ids.reserve(projectId, 'REQ', parsed.blocks.length);
    const { items } = atomize(parsed.blocks, firstBlock);

    // Classification: rules first (deterministic baseline), then Claude when configured.
    const drafts: ItemDraft[] = items.map((it) => {
      const c = classify(it.text, it.sourceKind, it.isTableHeader);
      const terms = NO_TEST_KINDS.has(it.sourceKind) || it.isTableHeader ? [] : findAmbiguities(it.text);
      return { ...it, ...c, ambiguousTerms: terms, aiGenerated: false };
    });
    const aiResults = await aiClassify(this.ai, drafts.map((d) => ({ text: d.text, sourceKind: d.sourceKind, sectionTitle: d.sectionTitle })));
    for (const [i, r] of aiResults) {
      const d = drafts[i];
      if (NO_TEST_KINDS.has(d.sourceKind) || d.isTableHeader) continue;
      if ((REQUIREMENT_CATEGORIES as readonly string[]).includes(r.category)) {
        d.category = r.category;
        d.subCategory = r.subCategory;
      }
      d.ambiguousTerms = [...new Set([...d.ambiguousTerms, ...r.ambiguousTerms.map((t) => t.trim()).filter(Boolean)])];
      d.aiGenerated = true;
    }

    // Version diff: matched items inherit their requirement ID, coverage decisions and test links.
    let diff: Record<string, unknown> | null = null;
    const oldItems = previousVersionId ? await this.prisma.requirementItem.findMany({ where: { versionId: previousVersionId } }) : [];
    if (previousVersionId) {
      const res = diffItems(oldItems.map((o) => ({ key: o.id, text: o.text })), drafts.map((d, i) => ({ key: String(i), text: d.text })));
      const oldById = new Map(oldItems.map((o) => [o.id, o]));
      const renamed = new Map<string, string>(); // new atomizer reqId → inherited reqId
      for (const m of res.matches) {
        const d = drafts[Number(m.newKey)];
        const o = oldById.get(m.oldKey)!;
        renamed.set(d.reqId, o.reqId);
        d.changeType = m.type;
        if (m.type === 'Modified') d.previousText = o.text;
        d.inherit = { oldId: o.id, coverageStatus: o.coverageStatus, noTestReason: o.noTestReason, acknowledgedById: o.acknowledgedById, acknowledgedAt: o.acknowledgedAt };
      }
      for (const k of res.added) drafts[Number(k)].changeType = 'Added';
      for (const d of drafts) {
        d.reqId = renamed.get(d.reqId) ?? d.reqId;
        if (d.parentReqId) d.parentReqId = renamed.get(d.parentReqId) ?? d.parentReqId;
      }
      this.dedupeReqIds(drafts);

      const affectedOldIds = [...res.removed, ...res.matches.filter((m) => m.type === 'Modified').map((m) => m.oldKey)];
      const impacted = await this.prisma.testCase.findMany({
        where: { requirements: { some: { requirementId: { in: affectedOldIds } } } },
        select: { id: true, tcId: true },
      });
      diff = {
        previousVersionId,
        unchanged: res.matches.filter((m) => m.type === 'Unchanged').length,
        added: drafts.filter((d) => d.changeType === 'Added').map((d) => ({ reqId: d.reqId, text: d.text })),
        modified: res.matches.filter((m) => m.type === 'Modified').map((m) => {
          const d = drafts[Number(m.newKey)];
          return { reqId: d.reqId, oldText: d.previousText, newText: d.text, similarity: m.similarity };
        }),
        removed: res.removed.map((k) => ({ reqId: oldById.get(k)!.reqId, text: oldById.get(k)!.text })),
        impactedTestCases: impacted.map((t) => t.tcId),
      };
      if (impacted.length) await this.prisma.testCase.updateMany({ where: { id: { in: impacted.map((t) => t.id) } }, data: { needsRegeneration: true } });
    }

    const rc = reverseCheck(parsed.rawText, drafts.filter((d) => d.isLeaf).map((d) => d.text));

    await this.prisma.$transaction(async (tx) => {
      await tx.requirementItem.createMany({
        data: drafts.map((d) => {
          const structural = NO_TEST_KINDS.has(d.sourceKind) || d.isTableHeader;
          const inheritedManual = d.changeType === 'Unchanged' && d.inherit && ['Informational', 'Acknowledged'].includes(d.inherit.coverageStatus);
          return {
            projectId, versionId, reqId: d.reqId, parentReqId: d.parentReqId ?? null, sequence: d.sequence,
            section: d.section ?? null, sectionTitle: d.sectionTitle ?? null, page: d.page ?? null, sourceKind: d.sourceKind,
            text: d.text, category: d.category, subCategory: d.subCategory ?? null,
            ambiguousTerms: d.ambiguousTerms.length ? JSON.stringify(d.ambiguousTerms) : null,
            coverageStatus: inheritedManual ? d.inherit!.coverageStatus : structural ? 'Informational' : 'Unmapped',
            noTestReason: inheritedManual ? d.inherit!.noTestReason : structural ? (d.isTableHeader ? 'Table column heading - structural, no test needed' : 'Section heading - structural, no test needed') : null,
            acknowledgedById: inheritedManual ? d.inherit!.acknowledgedById : null,
            acknowledgedAt: inheritedManual ? d.inherit!.acknowledgedAt : null,
            changeType: d.changeType ?? null, previousText: d.previousText ?? null, aiGenerated: d.aiGenerated,
          };
        }),
      });

      if (previousVersionId) {
        const created = await tx.requirementItem.findMany({ where: { versionId }, select: { id: true, reqId: true } });
        const newIdByReq = new Map(created.map((c) => [c.reqId, c.id]));
        const pairs = drafts.filter((d) => d.inherit).map((d) => ({ oldId: d.inherit!.oldId, newId: newIdByReq.get(d.reqId)! }));
        for (const { oldId, newId } of pairs) {
          const [sLinks, tLinks] = await Promise.all([
            tx.scenarioRequirement.findMany({ where: { requirementId: oldId } }),
            tx.testCaseRequirement.findMany({ where: { requirementId: oldId } }),
          ]);
          if (sLinks.length) await tx.scenarioRequirement.createMany({ data: sLinks.map((l) => ({ scenarioId: l.scenarioId, requirementId: newId })) });
          if (tLinks.length) await tx.testCaseRequirement.createMany({ data: tLinks.map((l) => ({ testCaseId: l.testCaseId, requirementId: newId })) });
          await tx.clarificationQuestion.updateMany({ where: { requirementId: oldId }, data: { requirementId: newId } });
        }
        await tx.requirementItem.updateMany({ where: { versionId: previousVersionId }, data: { isCurrent: false } });
      }

      await tx.documentVersion.update({
        where: { id: versionId },
        data: {
          parseStatus: 'Parsed', parseError: null, extractedText: parsed.rawText, ocrUsed: parsed.ocrUsed,
          warnings: parsed.warnings.length ? JSON.stringify(parsed.warnings) : null,
          wordCountOriginal: rc.originalWords, wordCountExtracted: rc.extractedWords, reverseCheckOk: rc.ok,
          reverseCheckJson: JSON.stringify(rc), diffJson: diff ? JSON.stringify(diff) : null, itemCount: drafts.length,
        },
      });
    }, { timeout: 120_000 });

    await this.createAmbiguityQuestions(projectId, versionId, user);
    await this.recomputeCoverage(projectId);
  }

  /** Guard: two new items could inherit the same old ID only through a bug - keep IDs unique regardless. */
  private dedupeReqIds(drafts: ItemDraft[]) {
    const seen = new Set<string>();
    for (const d of drafts) {
      let id = d.reqId;
      for (let n = 2; seen.has(id); n++) id = `${d.reqId}-${n}`;
      d.reqId = id;
      seen.add(id);
    }
  }

  /** One clarification question per (item, ambiguous term) for new or modified items. */
  private async createAmbiguityQuestions(projectId: string, versionId: string, user: AuthUser) {
    const items = await this.prisma.requirementItem.findMany({
      where: { versionId, ambiguousTerms: { not: null }, OR: [{ changeType: null }, { changeType: { in: ['Added', 'Modified'] } }] },
      orderBy: { sequence: 'asc' },
    });
    const qs = items.flatMap((it) => (JSON.parse(it.ambiguousTerms!) as string[]).map((term) => ({ it, term })));
    if (!qs.length) return;
    const first = await this.ids.reserve(projectId, 'Q', qs.length);
    await this.prisma.clarificationQuestion.createMany({
      data: qs.map(({ it, term }, i) => ({
        projectId, qId: `Q-${String(first + i).padStart(3, '0')}`, requirementId: it.id,
        sectionPage: [it.section && `§${it.section}`, it.page && `p.${it.page}`].filter(Boolean).join(' ') || null,
        question: questionFor(term, it.reqId), category: 'Ambiguity', raisedBy: 'QA Pilot (auto)',
        priority: ['TBD', 'should', 'fast/quick'].includes(term) ? 'High' : 'Medium', aiGenerated: true,
      })),
    });
    await this.audit.log({ userId: user.id, projectId, action: 'GENERATE', entityType: 'ClarificationQuestion', after: { count: qs.length, versionId } });
  }

  // ───────────────────────────── Queries ─────────────────────────────

  async listDocuments(projectId: string) {
    return this.prisma.requirementDocument.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true, version: true, fileName: true, sizeBytes: true, parseStatus: true, parseError: true, itemCount: true,
            wordCountOriginal: true, wordCountExtracted: true, reverseCheckOk: true, ocrUsed: true, createdAt: true,
          },
        },
      },
    });
  }

  async getVersion(projectId: string, versionId: string) {
    const v = await this.prisma.documentVersion.findFirst({
      where: { id: versionId, document: { projectId } },
      include: { document: true },
    });
    if (!v) throw new NotFoundException('Version not found');
    const { extractedText, reverseCheckJson, diffJson, warnings, ...rest } = v;
    return {
      ...rest,
      extractedTextLength: extractedText?.length ?? 0,
      reverseCheck: reverseCheckJson ? JSON.parse(reverseCheckJson) : null,
      diff: diffJson ? JSON.parse(diffJson) : null,
      warnings: warnings ? JSON.parse(warnings) : [],
    };
  }

  async original(projectId: string, versionId: string) {
    const v = await this.prisma.documentVersion.findFirst({ where: { id: versionId, document: { projectId } } });
    if (!v) throw new NotFoundException('Version not found');
    return { data: await this.storage.get(v.storagePath), fileName: v.fileName, mimeType: v.mimeType };
  }

  async listItems(projectId: string, f: { documentId?: string; versionId?: string; category?: string; kind?: string; coverage?: string; q?: string; ambiguous?: string; changed?: string; take?: string; skip?: string }) {
    const where: Prisma.RequirementItemWhereInput = {
      projectId,
      ...(f.versionId ? { versionId: f.versionId } : { isCurrent: true }),
      ...(f.documentId ? { version: { documentId: f.documentId } } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(f.kind ? { sourceKind: f.kind } : {}),
      ...(f.coverage ? { coverageStatus: f.coverage } : {}),
      ...(f.ambiguous === 'true' ? { ambiguousTerms: { not: null } } : {}),
      ...(f.changed === 'true' ? { changeType: { in: ['Added', 'Modified'] } } : {}),
      ...(f.q ? { OR: [{ text: { contains: f.q } }, { reqId: { contains: f.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.requirementItem.findMany({
        where,
        orderBy: [{ version: { document: { createdAt: 'asc' } } }, { sequence: 'asc' }],
        take: Math.min(Number(f.take) || 200, 1000),
        skip: Number(f.skip) || 0,
        include: { version: { select: { version: true, document: { select: { docKey: true, title: true } } } }, _count: { select: { questions: true, scenarioLinks: true, testCaseLinks: true } } },
      }),
      this.prisma.requirementItem.count({ where }),
    ]);
    return { total, items: items.map((i) => ({ ...i, ambiguousTerms: i.ambiguousTerms ? JSON.parse(i.ambiguousTerms) : [] })) };
  }

  async updateItem(projectId: string, itemId: string, dto: { category?: string; subCategory?: string | null }, user: AuthUser) {
    const before = await this.prisma.requirementItem.findFirst({ where: { id: itemId, projectId } });
    if (!before) throw new NotFoundException('Requirement item not found');
    // The text itself is immutable: it is the verbatim client wording.
    const after = await this.prisma.requirementItem.update({
      where: { id: itemId },
      data: { category: dto.category ?? before.category, subCategory: dto.category && dto.category !== 'NonFunctional' ? null : dto.subCategory === undefined ? before.subCategory : dto.subCategory },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'UPDATE', entityType: 'RequirementItem', entityId: itemId, before: { category: before.category, subCategory: before.subCategory }, after: { category: after.category, subCategory: after.subCategory } });
    return after;
  }

  // ───────────────────────────── Coverage ─────────────────────────────

  /**
   * Recompute coverage for current items: an item is Covered when linked to a scenario or test case
   * (directly, or through its parent table row; a row is covered when all of its cells are).
   * Manual decisions (Informational / Acknowledged) are kept for items without links.
   */
  async recomputeCoverage(projectId: string) {
    const items = await this.prisma.requirementItem.findMany({
      where: { projectId, isCurrent: true },
      select: { id: true, versionId: true, reqId: true, parentReqId: true, sourceKind: true, coverageStatus: true, _count: { select: { scenarioLinks: true, testCaseLinks: true } } },
    });
    const key = (versionId: string, reqId: string) => `${versionId}|${reqId}`;
    const linked = new Set(items.filter((i) => i._count.scenarioLinks + i._count.testCaseLinks > 0).map((i) => key(i.versionId, i.reqId)));
    const cellsByRow = new Map<string, typeof items>();
    for (const i of items) if (i.parentReqId) cellsByRow.set(key(i.versionId, i.parentReqId), [...(cellsByRow.get(key(i.versionId, i.parentReqId)) ?? []), i]);

    const covered = (i: (typeof items)[number]): boolean => {
      const k = key(i.versionId, i.reqId);
      if (linked.has(k)) return true;
      if (i.parentReqId && linked.has(key(i.versionId, i.parentReqId))) return true;
      if (i.sourceKind === 'TableRow') {
        // A row is covered when every cell that carries content needing a test is linked.
        const cells = (cellsByRow.get(k) ?? []).filter((c) => c.coverageStatus !== 'Informational');
        return cells.length > 0 && cells.every((c) => linked.has(key(c.versionId, c.reqId)));
      }
      return false;
    };

    const toCovered: string[] = [];
    const toUnmapped: string[] = [];
    for (const i of items) {
      const c = covered(i);
      if (c && i.coverageStatus !== 'Covered') toCovered.push(i.id);
      if (!c && i.coverageStatus === 'Covered') toUnmapped.push(i.id);
    }
    if (toCovered.length) await this.prisma.requirementItem.updateMany({ where: { id: { in: toCovered } }, data: { coverageStatus: 'Covered' } });
    if (toUnmapped.length) await this.prisma.requirementItem.updateMany({ where: { id: { in: toUnmapped } }, data: { coverageStatus: 'Unmapped' } });
  }

  async coverageSummary(projectId: string) {
    const groups = await this.prisma.requirementItem.groupBy({ by: ['coverageStatus'], where: { projectId, isCurrent: true }, _count: true });
    const c = Object.fromEntries(groups.map((g) => [g.coverageStatus, g._count])) as Record<string, number>;
    const covered = c.Covered ?? 0, informational = c.Informational ?? 0, acknowledged = c.Acknowledged ?? 0, unmapped = c.Unmapped ?? 0;
    const total = covered + informational + acknowledged + unmapped;
    const byCategory = await this.prisma.requirementItem.groupBy({ by: ['category', 'coverageStatus'], where: { projectId, isCurrent: true }, _count: true });
    const unmappedItems = await this.prisma.requirementItem.findMany({
      where: { projectId, isCurrent: true, coverageStatus: 'Unmapped' },
      orderBy: { sequence: 'asc' }, take: 500,
      select: { id: true, reqId: true, text: true, category: true, sourceKind: true, section: true, page: true },
    });
    const suggestions = await this.prisma.requirementItem.count({ where: { projectId, isCurrent: true, coverageStatus: 'Unmapped', category: { in: ['Informational', 'OutOfScope'] } } });
    return {
      total, covered, informational, acknowledged, unmapped,
      coveragePercent: total ? Math.round(((total - unmapped) / total) * 1000) / 10 : 0,
      testCoveragePercent: total ? Math.round((covered / Math.max(1, total - informational)) * 1000) / 10 : 0,
      complete: total > 0 && unmapped === 0,
      suggestions,
      byCategory: byCategory.map((b) => ({ category: b.category, coverageStatus: b.coverageStatus, count: b._count })),
      unmappedItems,
    };
  }

  async setCoverage(projectId: string, itemId: string, dto: { status: 'Informational' | 'Acknowledged' | 'Unmapped'; reason?: string }, user: AuthUser) {
    const item = await this.prisma.requirementItem.findFirst({ where: { id: itemId, projectId, isCurrent: true } });
    if (!item) throw new NotFoundException('Requirement item not found');
    if (item.coverageStatus === 'Covered') throw new BadRequestException('Item is already covered by a scenario/test case');
    if (dto.status !== 'Unmapped' && !dto.reason?.trim()) throw new BadRequestException('A reason is required');
    if (dto.status === 'Acknowledged' && !roleHas(user.projectRole ?? user.role, 'coverage.acknowledge')) {
      throw new ForbiddenException('Only a QA Lead can acknowledge a coverage gap');
    }
    const after = await this.prisma.requirementItem.update({
      where: { id: itemId },
      data: {
        coverageStatus: dto.status,
        noTestReason: dto.status === 'Unmapped' ? null : dto.reason!.trim(),
        acknowledgedById: dto.status === 'Unmapped' ? null : user.id,
        acknowledgedAt: dto.status === 'Unmapped' ? null : new Date(),
      },
    });
    await this.audit.log({ userId: user.id, projectId, action: dto.status === 'Acknowledged' ? 'ACKNOWLEDGE' : 'UPDATE', entityType: 'RequirementCoverage', entityId: itemId, before: { status: item.coverageStatus, reason: item.noTestReason }, after: { status: after.coverageStatus, reason: after.noTestReason } });
    return after;
  }

  /** Accept the classifier's suggestion for every unmapped Informational / Out-of-scope item. */
  async acceptSuggestions(projectId: string, user: AuthUser) {
    const items = await this.prisma.requirementItem.findMany({
      where: { projectId, isCurrent: true, coverageStatus: 'Unmapped', category: { in: ['Informational', 'OutOfScope'] } },
      select: { id: true, category: true },
    });
    const now = new Date();
    for (const cat of ['Informational', 'OutOfScope']) {
      const ids = items.filter((i) => i.category === cat).map((i) => i.id);
      if (!ids.length) continue;
      await this.prisma.requirementItem.updateMany({
        where: { id: { in: ids } },
        data: { coverageStatus: 'Informational', noTestReason: cat === 'OutOfScope' ? 'Out of scope - no test needed (accepted classification)' : 'Informational statement - no test needed (accepted classification)', acknowledgedById: user.id, acknowledgedAt: now },
      });
    }
    await this.audit.log({ userId: user.id, projectId, action: 'BULK_UPDATE', entityType: 'RequirementCoverage', after: { acceptedSuggestions: items.length } });
    return { updated: items.length };
  }

  // ───────────────────────────── RTM ─────────────────────────────

  async rtm(projectId: string) {
    const items = await this.prisma.requirementItem.findMany({
      where: { projectId, isCurrent: true },
      orderBy: [{ version: { document: { createdAt: 'asc' } } }, { sequence: 'asc' }],
      include: {
        version: { select: { document: { select: { docKey: true } } } },
        scenarioLinks: { include: { scenario: { select: { scenarioId: true } } } },
        testCaseLinks: { include: { testCase: { select: { id: true, tcId: true, status: true } } } },
      },
    });
    const defects = await this.prisma.defect.findMany({ where: { projectId }, select: { defectId: true, testCaseId: true, requirementId: true, status: true, severity: true } });
    const defectsByTc = new Map<string, string[]>();
    for (const d of defects) if (d.testCaseId) defectsByTc.set(d.testCaseId, [...(defectsByTc.get(d.testCaseId) ?? []), d.defectId]);

    return items.map((i) => {
      const tcs = i.testCaseLinks.map((l) => l.testCase);
      const defectIds = new Set<string>(tcs.flatMap((t) => defectsByTc.get(t.id) ?? []));
      defects.filter((d) => d.requirementId?.split(/[,\s]+/).includes(i.reqId)).forEach((d) => defectIds.add(d.defectId));
      return {
        id: i.id, reqId: i.reqId, document: i.version.document.docKey, section: i.section, page: i.page, sourceKind: i.sourceKind,
        category: i.category, text: i.text, coverageStatus: i.coverageStatus, noTestReason: i.noTestReason,
        scenarioIds: i.scenarioLinks.map((l) => l.scenario.scenarioId),
        testCaseIds: tcs.map((t) => t.tcId),
        executionStatus: RequirementsService.aggregateStatus(tcs.map((t) => t.status), i.coverageStatus),
        defectIds: [...defectIds],
      };
    });
  }

  static aggregateStatus(statuses: string[], coverage: string): string {
    if (!statuses.length) return coverage === 'Informational' ? 'N/A' : 'No Tests';
    if (statuses.includes('Fail')) return 'Fail';
    if (statuses.includes('Blocked')) return 'Blocked';
    if (statuses.every((s) => s === 'Pass')) return 'Pass';
    if (statuses.every((s) => s === 'NotRun')) return 'Not Run';
    return 'In Progress';
  }

  async questions(projectId: string, status?: string) {
    return this.prisma.clarificationQuestion.findMany({
      where: { projectId, ...(status ? { status } : {}) },
      orderBy: { qId: 'asc' },
      include: { requirement: { select: { reqId: true, text: true } } },
    });
  }
}
