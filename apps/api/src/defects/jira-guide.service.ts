import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { ExportDoc } from '../common/export/model';
import { renderPng } from '../common/export/pdf';
import { buildGuide, GuideDefect, jiraDescription, JIRA_PRIORITY, stepHtml } from './jira-guide';
import { extFor } from '../execution/runs.service';

@Injectable()
export class JiraGuideService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly audit: AuditService) {}

  private async load(projectId: string, id: string): Promise<GuideDefect & { id: string }> {
    const d = await this.prisma.defect.findFirst({ where: { id, projectId }, include: { testCase: { select: { tcId: true } }, attachments: { select: { kind: true, fileName: true, mimeType: true }, orderBy: { createdAt: 'asc' } } } });
    if (!d) throw new NotFoundException('Defect not found');
    return { ...d, tcId: d.testCase?.tcId ?? null, attachments: this.evidenceNames(d.attachments) };
  }

  /** File names as they appear in the evidence ZIP (unique, readable). */
  private evidenceNames(atts: { kind: string; fileName: string; mimeType: string }[]) {
    const seen = new Map<string, number>();
    return atts.map((a) => {
      // Older evidence may have been stored as ".bin" - name it by its real type so Jira previews it.
      const file = a.fileName.endsWith('.bin') ? a.fileName.replace(/\.bin$/, extFor(a.mimeType)) : a.fileName;
      const base = `${a.kind}-${file}`.replace(/[^A-Za-z0-9._-]+/g, '_');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { kind: a.kind, fileName: n > 1 ? base.replace(/(\.[^.]+)?$/, `-${n}$1`) : base };
    });
  }

  async guide(projectId: string, id: string) {
    const d = await this.load(projectId, id);
    const steps = buildGuide(d);
    return { defectId: d.defectId, jiraPriority: JIRA_PRIORITY[d.priority] ?? d.priority, description: jiraDescription(d), steps, evidenceCount: d.attachments.length };
  }

  /** Rendered illustration for one step; cached on disk per defect content. */
  async image(projectId: string, id: string, no: number): Promise<Buffer> {
    const d = await this.load(projectId, id);
    const step = buildGuide(d).find((s) => s.no === no);
    if (!step) throw new NotFoundException('No such step');
    const html = stepHtml(step, d);
    const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
    const file = join(this.storage.root, 'projects', projectId, 'jira-guide', d.id, `${no}-${hash}.png`);
    try { return await readFile(file); } catch { /* not cached yet */ }
    const png = await renderPng(html);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, png);
    return png;
  }

  /** All evidence of the defect in one ZIP, ready to drag into Jira (step 9). */
  async evidenceZip(projectId: string, id: string, user: AuthUser) {
    const d = await this.prisma.defect.findFirst({ where: { id, projectId }, include: { attachments: { orderBy: { createdAt: 'asc' } } } });
    if (!d) throw new NotFoundException('Defect not found');
    const zip = new JSZip();
    const names = this.evidenceNames(d.attachments);
    for (const [i, a] of d.attachments.entries()) {
      try { zip.file(names[i].fileName, await this.storage.get(a.storagePath)); } catch { /* missing file skipped */ }
    }
    zip.file('README.txt', `Evidence for ${d.defectId}: ${d.title}\nAttach these files to the Jira ticket (step 9 of the guide).\nTraces open with "npx playwright show-trace <file>" or at trace.playwright.dev. Typed passwords are redacted.\n`);
    await this.audit.log({ userId: user.id, projectId, action: 'EXPORT', entityType: 'DefectEvidence', entityId: d.id });
    return { data: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), fileName: `${d.defectId}-evidence.zip` };
  }

  async exportDoc(projectId: string, id: string): Promise<ExportDoc> {
    const d = await this.load(projectId, id);
    const steps = buildGuide(d);
    const sections = [];
    for (const s of steps) {
      sections.push({
        heading: `Step ${s.no}: ${s.title}`,
        paragraphs: [s.instruction, ...s.values.map((v) => `${v.label}: ${v.value}`)],
        images: [{ caption: `Step ${s.no} – illustration (your Jira screen may look different)`, data: await this.image(projectId, id, s.no), mimeType: 'image/png' }],
      });
    }
    return {
      title: `Create ${d.defectId} in Jira – step by step`, subtitle: d.title,
      meta: [['Defect', d.defectId], ['Jira priority', `${JIRA_PRIORITY[d.priority] ?? d.priority} (from ${d.priority})`], ['Severity', d.severity]],
      sections,
    };
  }
}
