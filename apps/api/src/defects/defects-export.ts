import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage.service';
import { ExportDoc, ExportImage } from '../common/export/model';
import { ageDays, PRIORITY_DEFINITIONS, SEVERITY_DEFINITIONS, STATUS_LABEL } from './lifecycle';

const IMAGE_ORDER = ['AnnotatedScreenshot', 'FailureScreenshot', 'FullPageScreenshot', 'Manual'];
const KIND_LABEL: Record<string, string> = { FailureScreenshot: 'Screenshot at the point of failure', FullPageScreenshot: 'Full-page screenshot', AnnotatedScreenshot: 'Annotated screenshot (failing element highlighted)', Manual: 'Screenshot' };

@Injectable()
export class DefectsExportService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  /** Full defect report (section 5.2 fields) with screenshots embedded. */
  async single(projectId: string, id: string): Promise<ExportDoc> {
    const d = await this.prisma.defect.findFirstOrThrow({ where: { id, projectId }, include: { testCase: { select: { tcId: true } }, attachments: true, history: { orderBy: { createdAt: 'asc' } }, project: true } });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: d.history.map((h) => h.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const images: ExportImage[] = [];
    for (const kind of IMAGE_ORDER) {
      for (const a of d.attachments.filter((x) => x.kind === kind && x.mimeType.startsWith('image/')).slice(0, 3)) {
        try {
          const data = await this.storage.get(a.storagePath);
          // A short page gives identical viewport and full-page screenshots - show each picture once.
          if (images.some((im) => im.data.equals(data))) continue;
          images.push({ caption: KIND_LABEL[kind] ?? a.fileName, data, mimeType: a.mimeType });
        } catch { /* file missing - still listed under Attachments */ }
      }
    }
    const dup = d.duplicateOfId ? await this.prisma.defect.findUnique({ where: { id: d.duplicateOfId }, select: { defectId: true } }) : null;
    const date = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');
    const critical = ['Blocker', 'Critical'].includes(d.severity) || d.priority === 'P1';
    return {
      title: `${d.defectId}: ${d.title}`, subtitle: `${d.project.name}${d.project.client ? ` · ${d.project.client}` : ''}`,
      banner: d.isDraft ? 'DRAFT – created automatically from a failed test, pending review' : critical ? `${d.severity} / ${d.priority} – high-impact defect` : undefined,
      meta: [['Status', STATUS_LABEL[d.status] ?? d.status], ['Severity', `${d.severity} – ${SEVERITY_DEFINITIONS[d.severity] ?? ''}`], ['Priority', `${d.priority} – ${PRIORITY_DEFINITIONS[d.priority] ?? ''}`], ['Age (days)', String(ageDays(d.reportedDate, d.closedDate))]],
      sections: [
        { heading: 'Defect details', keyValues: [
          ['Defect ID', d.defectId], ['Title / Summary', d.title], ['Description', d.description ?? '—'], ['Module / Feature', d.module ?? '—'],
          ['Requirement ID', d.requirementId ?? '—'], ['Test Case ID', d.testCase?.tcId ?? '—'], ['Test Run ID', d.testRunId ?? '—'], ['Environment', d.environment ?? '—'],
          ['Build / Version', d.build ?? '—'], ['Browser / Device / OS', d.browserDeviceOs ?? '—'], ['Defect Type', d.defectType],
          ['Reported By', d.reportedBy ?? '—'], ['Reported Date', date(d.reportedDate)], ['Assigned To', d.assignedTo ?? '—'], ['Root Cause', d.rootCause ?? '—'],
          ['Fix Version', d.fixVersion ?? '—'], ['Target Date', date(d.targetDate)], ['Retest Result', d.retestResult ?? '—'], ['Closed Date', date(d.closedDate)],
          ['Duplicate of', dup?.defectId ?? '—'], ['Jira', d.jiraKey ? `${d.jiraKey}${d.jiraUrl ? ` – ${d.jiraUrl}` : ''}` : '—'],
        ] },
        { heading: 'Pre-conditions', paragraphs: [d.preconditions ?? '—'] },
        { heading: 'Steps to reproduce', paragraphs: (d.stepsToReproduce ?? '—').split('\n') },
        { heading: 'Test data used', paragraphs: [d.testDataUsed ?? '—'] },
        { heading: 'Expected result', paragraphs: [d.expectedResult ?? '—'] },
        { heading: 'Actual result', paragraphs: (d.actualResult ?? '—').split('\n') },
        { heading: 'Screenshots', images, paragraphs: images.length ? undefined : ['No screenshots attached.'] },
        { heading: 'Attachments', table: { columns: [{ header: 'Type', key: 'kind', width: 22 }, { header: 'File', key: 'fileName', width: 40 }, { header: 'Size (KB)', key: 'kb', width: 10 }], rows: d.attachments.map((a) => ({ ...a, kb: Math.ceil(a.sizeBytes / 1024) })) } },
        { heading: 'Comments / history', table: { columns: [{ header: 'When', key: 'when', width: 18 }, { header: 'Who', key: 'who', width: 16 }, { header: 'Change', key: 'change', width: 30 }, { header: 'Comment', key: 'comment', width: 50 }],
          rows: d.history.map((h) => ({ when: h.createdAt.toISOString().slice(0, 16).replace('T', ' '), who: h.userId ? users.get(h.userId) ?? '' : 'QA Pilot', change: h.kind === 'Comment' ? 'Comment' : `${h.field ?? h.kind}: ${h.fromValue ?? '—'} → ${h.toValue ?? '—'}`, comment: h.comment ?? '' })) } },
      ],
    };
  }

  /** All defects with every section 5.2 field; Blocker/Critical/P1 rows highlighted red. */
  async list(projectId: string): Promise<ExportDoc> {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const rows = await this.prisma.defect.findMany({ where: { projectId, isDraft: false }, orderBy: { defectId: 'asc' }, include: { testCase: { select: { tcId: true } }, attachments: { select: { kind: true } } } });
    const open = rows.filter((d) => !['Closed', 'Rejected', 'Duplicate', 'NotABug', 'Verified'].includes(d.status));
    return {
      title: 'Defect List', subtitle: `${p.name}${p.client ? ` · ${p.client}` : ''}`, landscape: true,
      meta: [['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')], ['Total', String(rows.length)], ['Open', String(open.length)],
        ['Open Blocker/Critical/P1', String(open.filter((d) => ['Blocker', 'Critical'].includes(d.severity) || d.priority === 'P1').length)]],
      sections: [{ heading: 'Defects', table: {
        sheetName: 'Defects',
        columns: [
          { header: 'Defect ID', key: 'defectId', width: 10 }, { header: 'Title', key: 'title', width: 40 }, { header: 'Severity', key: 'severity', width: 9 }, { header: 'Priority', key: 'priority', width: 7 },
          { header: 'Status', key: 'statusLabel', width: 12 }, { header: 'Module', key: 'module', width: 12 }, { header: 'Requirement', key: 'requirementId', width: 12 }, { header: 'Test Case', key: 'tc', width: 9 },
          { header: 'Test Run', key: 'testRunId', width: 9 }, { header: 'Environment', key: 'environment', width: 18 }, { header: 'Build', key: 'build', width: 8 }, { header: 'Browser/Device/OS', key: 'browserDeviceOs', width: 18 },
          { header: 'Pre-conditions', key: 'preconditions', width: 20 }, { header: 'Steps to Reproduce', key: 'stepsToReproduce', width: 35 }, { header: 'Test Data', key: 'testDataUsed', width: 16 },
          { header: 'Expected', key: 'expectedResult', width: 25 }, { header: 'Actual', key: 'actualResult', width: 25 }, { header: 'Type', key: 'defectType', width: 11 },
          { header: 'Reported By', key: 'reportedBy', width: 14 }, { header: 'Reported', key: 'reportedDate', width: 10 }, { header: 'Assigned To', key: 'assignedTo', width: 14 },
          { header: 'Root Cause', key: 'rootCause', width: 18 }, { header: 'Fix Version', key: 'fixVersion', width: 9 }, { header: 'Target Date', key: 'targetDate', width: 10 },
          { header: 'Retest', key: 'retestResult', width: 7 }, { header: 'Closed', key: 'closedDate', width: 10 }, { header: 'Age (days)', key: 'age', width: 7 },
          { header: 'Jira', key: 'jiraKey', width: 10 }, { header: 'Attachments', key: 'att', width: 20 },
        ],
        rows: rows.map((d) => ({ ...d, statusLabel: STATUS_LABEL[d.status] ?? d.status, tc: d.testCase?.tcId ?? '', age: ageDays(d.reportedDate, d.closedDate), att: [...new Set(d.attachments.map((a) => a.kind))].join(', ') })),
        highlight: (r) => (['Blocker', 'Critical'].includes(String(r.severity)) || r.priority === 'P1' ? (['Closed', 'Verified', 'Rejected', 'Duplicate', 'NotABug'].includes(String(r.status)) ? undefined : 'red') : undefined),
      } }],
    };
  }
}
