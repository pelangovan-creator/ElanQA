import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type as osType, release as osRelease } from 'node:os';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdService } from '../common/id.service';
import { StorageService } from '../common/storage.service';
import { AuthUser } from '../common/decorators';
import { similarity } from '../requirements/analysis/diff';
import { ageDays, CLOSED_STATES, defaultPriority, defectTypeFor, DEVELOPER_TARGETS, isOpen, LIFECYCLE } from './lifecycle';

export interface DefectInput {
  title?: string; description?: string | null; module?: string | null; requirementId?: string | null; testCaseId?: string | null;
  environment?: string | null; build?: string | null; browserDeviceOs?: string | null; preconditions?: string | null; stepsToReproduce?: string | null;
  testDataUsed?: string | null; expectedResult?: string | null; actualResult?: string | null; severity?: string; priority?: string; defectType?: string;
  assignedTo?: string | null; rootCause?: string | null; fixVersion?: string | null; targetDate?: string | null;
  jiraKey?: string | null; jiraUrl?: string | null;
}
export interface TransitionInput { to: string; comment?: string; assignedTo?: string; duplicateOfId?: string; rootCause?: string; fixVersion?: string }

const EDITABLE: (keyof DefectInput)[] = [
  'title', 'description', 'module', 'requirementId', 'environment', 'build', 'browserDeviceOs', 'preconditions', 'stepsToReproduce', 'testDataUsed',
  'expectedResult', 'actualResult', 'severity', 'priority', 'defectType', 'assignedTo', 'rootCause', 'fixVersion', 'targetDate', 'jiraKey', 'jiraUrl',
];
const ALLOWED_UPLOAD = /^(image\/(png|jpeg|gif|webp)|video\/(webm|mp4)|application\/(zip|json|pdf)|text\/plain)$/;
const SIMILAR = 0.55;

@Injectable()
export class DefectsService {
  private readonly logger = new Logger(DefectsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
    private readonly storage: StorageService,
  ) {}

  // ───────────────────────────── Queries ─────────────────────────────

  async list(projectId: string, f: Record<string, string | undefined>) {
    const where: Prisma.DefectWhereInput = {
      projectId,
      ...(f.draft === 'true' ? { isDraft: true } : f.draft === 'all' ? {} : { isDraft: false }),
      ...(f.status ? { status: { in: f.status.split(',') } } : {}),
      ...(f.severity ? { severity: { in: f.severity.split(',') } } : {}),
      ...(f.priority ? { priority: { in: f.priority.split(',') } } : {}),
      ...(f.module ? { module: f.module } : {}),
      ...(f.assignedTo ? { assignedTo: f.assignedTo } : {}),
      ...(f.defectType ? { defectType: f.defectType } : {}),
      ...(f.run ? { testRunId: f.run } : {}),
      ...(f.q ? { OR: [{ title: { contains: f.q } }, { defectId: { contains: f.q } }, { jiraKey: { contains: f.q } }] } : {}),
    };
    const rows = await this.prisma.defect.findMany({
      where, orderBy: [{ createdAt: 'desc' }],
      include: { testCase: { select: { tcId: true } }, attachments: { select: { id: true, kind: true, mimeType: true }, orderBy: { createdAt: 'asc' } } },
    });
    return rows.map((d) => this.out(d));
  }

  private out<T extends { reportedDate: Date; closedDate: Date | null; status: string; duplicateCandidates: string | null; attachments?: { id: string; kind: string; mimeType: string }[] }>(d: T) {
    const shot = d.attachments?.find((a) => a.kind === 'AnnotatedScreenshot') ?? d.attachments?.find((a) => a.mimeType.startsWith('image/'));
    return {
      ...d, ageDays: ageDays(d.reportedDate, d.closedDate), open: isOpen(d.status), thumbnailId: shot?.id ?? null,
      duplicateCandidates: d.duplicateCandidates ? JSON.parse(d.duplicateCandidates) : [],
      hasScreenshot: !!d.attachments?.some((a) => a.mimeType.startsWith('image/')),
    };
  }

  async get(projectId: string, id: string, user?: AuthUser) {
    const d = await this.prisma.defect.findFirst({
      where: { id, projectId },
      include: {
        testCase: { select: { id: true, tcId: true, title: true } },
        attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!d) throw new NotFoundException('Defect not found');
    const userIds = [...new Set(d.history.map((h) => h.userId).filter((x): x is string => !!x))];
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const duplicateOf = d.duplicateOfId ? await this.prisma.defect.findUnique({ where: { id: d.duplicateOfId }, select: { id: true, defectId: true, title: true } }) : null;
    return {
      ...this.out(d), duplicateOf,
      history: d.history.map((h) => ({ ...h, userName: h.userId ? names.get(h.userId) ?? 'Unknown' : 'QA Pilot' })),
      allowedTransitions: d.isDraft ? [] : this.allowed(d.status, user?.projectRole ?? user?.role),
    };
  }

  allowed(from: string, role?: string): string[] {
    const next = LIFECYCLE[from] ?? [];
    if (role === 'Developer') return next.filter((s) => DEVELOPER_TARGETS.has(s));
    if (role === 'Client') return [];
    return next;
  }

  // ───────────────────────────── Create / update ─────────────────────────────

  private clean(dto: DefectInput) {
    const data: Record<string, unknown> = {};
    for (const k of EDITABLE) if (dto[k] !== undefined) data[k] = k === 'targetDate' ? (dto[k] ? new Date(dto[k] as string) : null) : dto[k];
    return data;
  }

  async create(projectId: string, dto: DefectInput, user: AuthUser) {
    if (!dto.title?.trim()) throw new BadRequestException('title is required');
    if (dto.testCaseId && !(await this.prisma.testCase.findFirst({ where: { id: dto.testCaseId, projectId } }))) throw new BadRequestException('Unknown test case');
    const severity = dto.severity ?? 'Major';
    const d = await this.prisma.defect.create({
      data: {
        ...(this.clean(dto) as Prisma.DefectUncheckedCreateInput), projectId, defectId: await this.ids.next(projectId, 'DEF', 4), title: dto.title.trim(),
        testCaseId: dto.testCaseId ?? null, severity, priority: dto.priority ?? defaultPriority(severity), defectType: dto.defectType ?? 'Functional',
        status: dto.assignedTo ? 'Assigned' : 'New', reportedBy: user.name,
        history: { create: { userId: user.id, kind: 'StatusChange', toValue: dto.assignedTo ? 'Assigned' : 'New', comment: 'Defect reported' } },
      },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'CREATE', entityType: 'Defect', entityId: d.id, after: d });
    return this.get(projectId, d.id, user);
  }

  async update(projectId: string, id: string, dto: DefectInput, user: AuthUser) {
    const before = await this.prisma.defect.findFirst({ where: { id, projectId } });
    if (!before) throw new NotFoundException('Defect not found');
    const role = user.projectRole ?? user.role;
    const data = this.clean(dto);
    // Developers record their findings; triage fields stay with QA.
    if (role === 'Developer') for (const k of Object.keys(data)) if (!['rootCause', 'fixVersion', 'targetDate'].includes(k)) throw new ForbiddenException(`Developers can update root cause, fix version and target date only (not ${k})`);
    const changes = Object.entries(data).filter(([k, v]) => String((before as Record<string, unknown>)[k] ?? '') !== String(v ?? ''));
    if (!changes.length) return this.get(projectId, id, user);
    await this.prisma.$transaction([
      this.prisma.defect.update({ where: { id }, data }),
      this.prisma.defectHistory.createMany({ data: changes.map(([k, v]) => ({ defectId: id, userId: user.id, kind: 'FieldChange', field: k, fromValue: fmt((before as Record<string, unknown>)[k]), toValue: fmt(v) })) }),
    ]);
    await this.audit.log({ userId: user.id, projectId, action: 'UPDATE', entityType: 'Defect', entityId: id, before: Object.fromEntries(changes.map(([k]) => [k, (before as Record<string, unknown>)[k]])), after: Object.fromEntries(changes) });
    return this.get(projectId, id, user);
  }

  async transition(projectId: string, id: string, t: TransitionInput, user: AuthUser) {
    const d = await this.prisma.defect.findFirst({ where: { id, projectId } });
    if (!d) throw new NotFoundException('Defect not found');
    if (d.isDraft) throw new BadRequestException('Confirm the draft defect first');
    const role = user.projectRole ?? user.role;
    if (!(LIFECYCLE[d.status] ?? []).includes(t.to)) throw new BadRequestException(`Cannot move from ${d.status} to ${t.to}`);
    if (!this.allowed(d.status, role).includes(t.to)) throw new ForbiddenException(`${role} cannot move a defect to ${t.to}`);
    const assignedTo = t.assignedTo ?? d.assignedTo;
    if (t.to === 'Assigned' && !assignedTo) throw new BadRequestException('Choose an assignee');
    if (['Rejected', 'NotABug', 'Deferred', 'Reopened'].includes(t.to) && !t.comment?.trim()) throw new BadRequestException(`A comment is required to set ${t.to}`);
    if (t.to === 'Fixed' && !(t.rootCause ?? d.rootCause)) throw new BadRequestException('Record the root cause when marking a defect Fixed');
    let duplicateOfId: string | undefined;
    if (t.to === 'Duplicate') {
      const target = t.duplicateOfId ? await this.prisma.defect.findFirst({ where: { projectId, OR: [{ id: t.duplicateOfId }, { defectId: t.duplicateOfId }] } }) : null;
      if (!target || target.id === d.id) throw new BadRequestException('Choose the original defect this duplicates');
      duplicateOfId = target.id;
    }
    await this.prisma.$transaction([
      this.prisma.defect.update({
        where: { id },
        data: {
          status: t.to, assignedTo, rootCause: t.rootCause ?? undefined, fixVersion: t.fixVersion ?? undefined, duplicateOfId,
          closedDate: CLOSED_STATES.has(t.to) ? new Date() : t.to === 'Reopened' || t.to === 'Open' ? null : undefined,
          retestResult: t.to === 'Verified' ? 'Pass' : t.to === 'Reopened' && ['Retest', 'ReadyForRetest', 'Verified', 'Closed'].includes(d.status) ? 'Fail' : undefined,
        },
      }),
      this.prisma.defectHistory.create({ data: { defectId: id, userId: user.id, kind: 'StatusChange', field: 'status', fromValue: d.status, toValue: t.to, comment: t.comment?.trim() || null } }),
    ]);
    await this.audit.log({ userId: user.id, projectId, action: 'TRANSITION', entityType: 'Defect', entityId: id, before: { status: d.status }, after: { status: t.to, comment: t.comment } });
    return this.get(projectId, id, user);
  }

  async comment(projectId: string, id: string, text: string, user: AuthUser) {
    const d = await this.prisma.defect.findFirst({ where: { id, projectId } });
    if (!d) throw new NotFoundException('Defect not found');
    if (!text.trim()) throw new BadRequestException('Comment is empty');
    await this.prisma.defectHistory.create({ data: { defectId: id, userId: user.id, kind: 'Comment', comment: text.trim() } });
    await this.audit.log({ userId: user.id, projectId, action: 'COMMENT', entityType: 'Defect', entityId: id });
    return this.get(projectId, id, user);
  }

  async addAttachment(projectId: string, id: string, file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined, user: AuthUser) {
    if (!file?.buffer?.length) throw new BadRequestException('A file is required');
    if (!ALLOWED_UPLOAD.test(file.mimetype)) throw new BadRequestException('Allowed: PNG, JPEG, GIF, WebP, WebM/MP4 video, ZIP (trace), JSON, PDF, plain text');
    const d = await this.prisma.defect.findFirst({ where: { id, projectId } });
    if (!d) throw new NotFoundException('Defect not found');
    const rel = await this.storage.put(['projects', projectId, 'defects', id], file.originalname, file.buffer);
    const kind = file.mimetype.startsWith('image/') ? 'Manual' : file.mimetype.startsWith('video/') ? 'Video' : file.mimetype === 'application/zip' ? 'Trace' : 'Manual';
    await this.prisma.attachment.create({ data: { defectId: id, kind, fileName: rel.split('/').pop()!, mimeType: file.mimetype, storagePath: rel, sizeBytes: file.size } });
    await this.prisma.defectHistory.create({ data: { defectId: id, userId: user.id, kind: 'Comment', comment: `Attached ${file.originalname}` } });
    await this.audit.log({ userId: user.id, projectId, action: 'UPLOAD', entityType: 'Defect', entityId: id, after: { fileName: file.originalname } });
    return this.get(projectId, id, user);
  }

  // ───────────────────────────── Drafts ─────────────────────────────

  /** A draft becomes a real defect only with at least one screenshot (mandatory evidence). */
  async confirmDraft(projectId: string, id: string, user: AuthUser) {
    const d = await this.prisma.defect.findFirst({ where: { id, projectId }, include: { attachments: true } });
    if (!d) throw new NotFoundException('Defect not found');
    if (!d.isDraft) throw new BadRequestException('Defect is not a draft');
    if (!d.attachments.some((a) => a.mimeType.startsWith('image/'))) throw new BadRequestException('A screenshot is mandatory - attach one before confirming');
    await this.prisma.$transaction([
      this.prisma.defect.update({ where: { id }, data: { isDraft: false, status: d.assignedTo ? 'Assigned' : 'New', reportedBy: d.reportedBy?.startsWith('QA Pilot') ? `${user.name} (from ${d.testRunId ?? 'test run'})` : d.reportedBy } }),
      this.prisma.defectHistory.create({ data: { defectId: id, userId: user.id, kind: 'StatusChange', fromValue: 'Draft', toValue: d.assignedTo ? 'Assigned' : 'New', comment: 'Draft reviewed and confirmed' } }),
    ]);
    await this.audit.log({ userId: user.id, projectId, action: 'CONFIRM', entityType: 'Defect', entityId: id });
    return this.get(projectId, id, user);
  }

  async discardDraft(projectId: string, id: string, user: AuthUser) {
    const d = await this.prisma.defect.findFirst({ where: { id, projectId } });
    if (!d) throw new NotFoundException('Defect not found');
    if (!d.isDraft) throw new BadRequestException('Only drafts can be discarded; reject or close a confirmed defect instead');
    await this.prisma.defect.delete({ where: { id } });
    await this.audit.log({ userId: user.id, projectId, action: 'DELETE', entityType: 'Defect', entityId: id, before: { defectId: d.defectId, title: d.title } });
    return { ok: true };
  }

  /** Link a draft to an existing defect instead of creating a new one: evidence moves over, draft is kept as Duplicate. */
  async linkDraft(projectId: string, id: string, targetId: string, user: AuthUser) {
    const draft = await this.prisma.defect.findFirst({ where: { id, projectId }, include: { attachments: true } });
    const target = await this.prisma.defect.findFirst({ where: { projectId, OR: [{ id: targetId }, { defectId: targetId }] } });
    if (!draft || !target) throw new NotFoundException('Defect not found');
    if (!draft.isDraft) throw new BadRequestException('Only drafts can be linked');
    if (target.id === draft.id) throw new BadRequestException('Cannot link a defect to itself');
    await this.prisma.$transaction([
      ...draft.attachments.map((a) => this.prisma.attachment.create({ data: { defectId: target.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, storagePath: a.storagePath, sizeBytes: a.sizeBytes } })),
      this.prisma.defectHistory.create({ data: { defectId: target.id, userId: user.id, kind: 'Comment', comment: `Reproduced in ${draft.testRunId ?? 'a test run'} (${draft.browserDeviceOs ?? ''}); evidence from ${draft.defectId} attached.` } }),
      this.prisma.defect.update({ where: { id: draft.id }, data: { isDraft: false, status: 'Duplicate', duplicateOfId: target.id, closedDate: new Date() } }),
      this.prisma.defectHistory.create({ data: { defectId: draft.id, userId: user.id, kind: 'StatusChange', fromValue: 'Draft', toValue: 'Duplicate', comment: `Linked to ${target.defectId}` } }),
    ]);
    await this.audit.log({ userId: user.id, projectId, action: 'LINK', entityType: 'Defect', entityId: draft.id, after: { duplicateOf: target.defectId } });
    return this.get(projectId, target.id, user);
  }

  // ───────────────────────────── Automatic creation from runs ─────────────────────────────

  /**
   * After a run: one draft defect per failed test case (all browsers combined) with the run's evidence attached.
   * - If an open defect already tracks the same test case, the failure is added to it instead (no new draft);
   *   a defect waiting for retest is Reopened.
   * - Passing results verify defects that were Ready for Retest / in Retest.
   * - Other similar defects are suggested on the draft so the tester can link instead of duplicating.
   */
  async processRun(projectId: string, runDbId: string, user: AuthUser) {
    const setting = await this.prisma.projectSetting.findUnique({ where: { projectId_key: { projectId, key: 'defects.autoCreate' } } });
    if (setting?.value === 'false') return { created: 0, reproduced: 0, reopened: 0, verified: 0, skipped: 'disabled' };
    const run = await this.prisma.testRun.findFirstOrThrow({
      where: { id: runDbId, projectId },
      include: {
        environment: true,
        results: {
          include: {
            attachments: true,
            testCase: { include: { requirements: { include: { requirement: { select: { reqId: true, text: true, category: true, subCategory: true } } } } } },
          },
        },
      },
    });
    const byTc = new Map<string, typeof run.results>();
    for (const r of run.results) byTc.set(r.testCaseId, [...(byTc.get(r.testCaseId) ?? []), r]);
    const stats = { created: 0, reproduced: 0, reopened: 0, verified: 0 };
    const existing = await this.prisma.defect.findMany({ where: { projectId }, select: { id: true, defectId: true, title: true, actualResult: true, module: true, status: true, testCaseId: true, isDraft: true } });

    for (const [tcId, results] of byTc) {
      const tc = results[0].testCase;
      const failed = results.filter((r) => r.status === 'Fail');
      const tracking = existing.filter((d) => d.testCaseId === tcId && (d.isDraft || isOpen(d.status)));

      if (!failed.length) {
        // Retest passed on every browser → verify defects awaiting retest.
        if (results.every((r) => r.status === 'Pass')) {
          for (const d of tracking.filter((x) => ['ReadyForRetest', 'Retest'].includes(x.status))) {
            await this.prisma.$transaction([
              this.prisma.defect.update({ where: { id: d.id }, data: { status: 'Verified', retestResult: 'Pass' } }),
              this.prisma.defectHistory.create({ data: { defectId: d.id, userId: user.id, kind: 'StatusChange', field: 'status', fromValue: d.status, toValue: 'Verified', comment: `Retest passed in ${run.runId}${run.build ? ` (build ${run.build})` : ''}` } }),
            ]);
            stats.verified++;
          }
        }
        continue;
      }

      const first = failed[0];
      const evidence = failed.flatMap((r) => r.attachments);
      if (tracking.length) {
        const d = tracking[0];
        const reopen = ['ReadyForRetest', 'Retest', 'Fixed'].includes(d.status);
        await this.prisma.$transaction([
          ...evidence.map((a) => this.prisma.attachment.create({ data: { defectId: d.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, storagePath: a.storagePath, sizeBytes: a.sizeBytes } })),
          this.prisma.defect.update({ where: { id: d.id }, data: reopen ? { status: 'Reopened', retestResult: 'Fail', closedDate: null } : {} }),
          this.prisma.defectHistory.create({
            data: { defectId: d.id, userId: user.id, kind: reopen ? 'StatusChange' : 'Comment', field: reopen ? 'status' : null, fromValue: reopen ? d.status : null, toValue: reopen ? 'Reopened' : null,
              comment: `${reopen ? 'Retest failed' : 'Failed again'} in ${run.runId}${run.build ? ` (build ${run.build})` : ''} on ${failed.map((r) => r.browser).join(', ')}: ${firstLine(first.error)}` },
          }),
        ]);
        stats[reopen ? 'reopened' : 'reproduced']++;
        continue;
      }

      const draft = this.draftFrom(run, tc, failed);
      const candidates = existing
        .filter((d) => !d.isDraft || d.testCaseId !== tcId)
        .map((d) => {
          const score = Math.max(similarity(d.title, draft.title), d.actualResult ? similarity(d.actualResult, draft.actualResult) : 0);
          const sameTc = d.testCaseId === tcId;
          return { id: d.id, defectId: d.defectId, title: d.title, status: d.status, score: sameTc ? Math.max(score, 0.9) : Math.round(score * 100) / 100, reason: sameTc ? 'Same test case (previously closed)' : 'Similar title / actual result' };
        })
        .filter((c) => c.score >= SIMILAR && (c.reason.startsWith('Same') || existing.find((e) => e.id === c.id)?.module === draft.module))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const created = await this.prisma.defect.create({
        data: {
          ...draft, projectId, defectId: await this.ids.next(projectId, 'DEF', 4), isDraft: true, status: 'New',
          duplicateCandidates: candidates.length ? JSON.stringify(candidates) : null, testResultId: first.id,
          attachments: { create: evidence.map((a) => ({ kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, storagePath: a.storagePath, sizeBytes: a.sizeBytes })) },
          history: { create: { userId: user.id, kind: 'StatusChange', toValue: 'Draft', comment: `Draft created automatically from ${run.runId}` } },
        },
      });
      existing.push({ id: created.id, defectId: created.defectId, title: created.title, actualResult: created.actualResult, module: created.module, status: created.status, testCaseId: tcId, isDraft: true });
      stats.created++;
    }
    await this.audit.log({ userId: user.id, projectId, action: 'AUTO_DEFECTS', entityType: 'TestRun', entityId: run.id, after: stats });
    return stats;
  }

  private draftFrom(run: { runId: string; build: string | null; kind: string; environment: { name: string; envType: string; baseUrl: string; viewport: string | null } | null },
    tc: { id: string; tcId: string; title: string; module: string; preconditions: string | null; steps: string; priority: string; severityIfFailed: string | null; testType: string; testDataRef: string | null; requirements: { requirement: { reqId: string; text: string; category: string; subCategory: string | null } }[] },
    failed: { status: string; browser: string | null; error: string | null; stepResults: string | null }[]) {
    const first = failed[0];
    const steps = JSON.parse(tc.steps) as { no: number; action: string; expected: string }[];
    const stepResults = (first.stepResults ? JSON.parse(first.stepResults) : []) as { title?: string; no?: number; status?: string; actual?: string; error?: string }[];
    const failingAuto = stepResults.find((s) => s.error && s.title && !/^(Before|After) Hooks$/.test(s.title));
    const failingManual = stepResults.find((s) => s.status === 'Fail' || s.status === 'Blocked');
    const failingStep = failingManual?.no ? steps.find((s) => s.no === failingManual.no) : undefined;
    const reqs = tc.requirements.map((r) => r.requirement);
    const severity = tc.severityIfFailed ?? 'Major';
    const where = failingAuto?.title ?? (failingStep ? `step ${failingStep.no}` : '');
    const browsers = [...new Set(failed.map((r) => r.browser).filter(Boolean))].join(', ');
    return {
      title: `[${tc.module}] ${tc.title}${where ? ` – fails at: ${where}` : ''}`.slice(0, 250),
      description: `Found by ${run.kind === 'Manual' ? 'manual' : 'automated'} execution of ${tc.tcId} in ${run.runId}.${reqs.length ? `\nRequirement(s): ${reqs.map((r) => `${r.reqId} – ${r.text}`).join('\n')}` : ''}`,
      module: tc.module,
      requirementId: reqs.map((r) => r.reqId).join(', ') || null,
      testCaseId: tc.id,
      testRunId: run.runId,
      environment: run.environment ? `${run.environment.name} (${run.environment.envType}) – ${run.environment.baseUrl}` : null,
      build: run.build,
      browserDeviceOs: run.kind === 'Manual' ? 'Manual execution' : `${browsers} · ${run.environment?.viewport ?? '1366x768'} · ${osType()} ${osRelease().split('-')[0]} (test runner)`,
      preconditions: tc.preconditions,
      stepsToReproduce: steps.map((s) => `${s.no}. ${s.action}`).join('\n') + (failingAuto ? `\nFailing check: ${failingAuto.title}` : ''),
      testDataUsed: [tc.testDataRef ? `Test Data Sheet ${tc.testDataRef}` : null, failingAuto?.title?.match(/"([^"]*)"|\(([^)]*)\)/)?.[0] ?? null].filter(Boolean).join(' · ') || null,
      expectedResult: failingStep?.expected ?? (reqs[0] ? `As specified in ${reqs[0].reqId}: ${reqs[0].text}` : steps[steps.length - 1]?.expected ?? null),
      actualResult: (failingManual?.actual ? `Step ${failingManual.no}: ${failingManual.actual}` : cleanError(first.error)) || 'Test failed',
      severity, priority: defaultPriority(severity, tc.priority), defectType: defectTypeFor(tc.testType, reqs[0]?.category, reqs[0]?.subCategory),
      reportedBy: 'QA Pilot (auto)',
    };
  }
}

const fmt = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const firstLine = (s: string | null) => (s ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 300) ?? '';
/** Turn a Playwright error into a sentence a developer can read in the defect. */
export function cleanError(s: string | null): string {
  if (!s) return '';
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0].replace(/^Error:\s*/, '');
  const get = (label: string) => lines.find((l) => l.startsWith(label))?.slice(label.length).trim();
  const shown = (v: string | undefined) => (v ?? '').replace(/^"|"$/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  // Built-in assertions: "expect(locator).toContainText(expected) failed" + Expected/Received lines.
  const m = /^expect\((?:locator|page|received)\)\.(not\.)?(\w+)\(/.exec(first);
  if (m) {
    const negated = !!m[1] || /\.not\./.test(first);
    const expected = get('Expected pattern:') ?? get('Expected string:') ?? get('Expected:');
    const received = get('Received string:') ?? get('Received:');
    if (/toContainText|toHaveText/.test(m[2])) return `Expected the page ${negated ? 'NOT ' : ''}to show text matching ${expected} - it showed: "${shown(received)}"`;
    if (m[2] === 'toBeVisible') return `Expected ${get('Locator:') ?? 'the element'} to be visible - it was not`;
    if (m[2] === 'toHaveCount') return `Expected ${get('Locator:') ?? 'elements'} to have count ${expected} - found ${received}`;
    return `${first}${expected ? `\nExpected: ${expected}` : ''}${received ? `\nReceived: ${shown(received)}` : ''}`;
  }
  // Our own assertion messages ('"Password" should be rejected ...') already read well.
  if (/^(TimeoutError|locator\.)/.test(first)) return `${first}${get('- waiting for') ? ` (waiting for ${get('- waiting for')})` : ''}`.slice(0, 1000);
  return first.slice(0, 1000);
}
