import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { ExportDoc, ExportImage, ExportSection } from '../common/export/model';
import { renderPng } from '../common/export/pdf';
import { ExportService } from '../common/export/export.service';
import { StorageService } from '../common/storage.service';
import { STATUS_LABEL } from '../defects/lifecycle';
import { C, hbars, lines, stackedBar, stackedColumns } from './charts';
import { addDays, AGE_BUCKETS, MetricsService, PRIORITIES, SEVERITIES, Snapshot } from './metrics.service';

export const REPORT_TYPES = ['DSR', 'WSR', 'DefectReport'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
const TITLE: Record<ReportType, string> = { DSR: 'Daily Status Report', WSR: 'Weekly Status Report', DefectReport: 'Defect Report' };

export interface ReportContent {
  type: ReportType;
  header: Record<string, string>;
  narrative: Record<string, string>;
  data: Snapshot;
  refreshedAt: string;
}

const HEADER_KEYS: Record<ReportType, [string, string][]> = {
  DSR: [['projectName', 'Project Name'], ['client', 'Client'], ['reportDate', 'Report Date'], ['sprint', 'Sprint / Release'], ['build', 'Build / Version'], ['environment', 'Environment'], ['preparedBy', 'Prepared By'], ['reportingPeriod', 'Reporting Period']],
  WSR: [['projectName', 'Project Name'], ['client', 'Client'], ['weekFrom', 'Week from'], ['weekTo', 'Week to'], ['sprint', 'Sprint / Release'], ['preparedBy', 'Prepared By']],
  DefectReport: [['projectName', 'Project Name'], ['client', 'Client'], ['reportDate', 'Report Date'], ['periodFrom', 'Period from'], ['periodTo', 'Period to'], ['preparedBy', 'Prepared By']],
};
export const NARRATIVE_KEYS: Record<ReportType, [string, string][]> = {
  DSR: [['tasksCompleted', 'Tasks completed today'], ['tasksPlanned', 'Tasks planned for tomorrow'], ['testerProgress', 'Tester-wise assignment & progress'], ['blockers', 'Blockers / issues / dependencies'], ['risks', 'Risks'], ['downtimeHours', 'Environment downtime (hours)'], ['comments', 'Comments / notes']],
  WSR: [['ragStatus', 'Overall status (Red / Amber / Green)'], ['ragReason', 'Reason for status'], ['plannedExecutionPct', 'Planned execution % by end of week'], ['accomplishments', 'Key accomplishments this week'], ['nextWeekPlan', 'Plan for next week'], ['milestones', 'Milestone tracker'], ['risks', 'Top risks & mitigation'], ['escalations', 'Open issues / escalations'], ['resourceUtilisation', 'Resource utilisation'], ['clientActionItems', 'Client action items'], ['comments', 'Comments']],
  DefectReport: [['uatDefects', 'Defects found in UAT (for leakage)'], ['prodDefects', 'Defects found in production (for leakage)'], ['comments', 'Comments']],
};
const bullet = (xs: string[], empty = '—') => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : empty);
const sevColor = (i: number) => C.ramp[Math.min(i, C.ramp.length - 1)];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly exporter: ExportService,
    private readonly storage: StorageService,
  ) {}

  // ───────────────────────────── Generate / edit ─────────────────────────────

  async generate(projectId: string, type: ReportType, opts: { date?: string; from?: string; to?: string }, user: AuthUser) {
    const today = await this.metrics.today(projectId);
    let from: string, to: string;
    if (type === 'DSR') { from = to = opts.date ?? today; }
    else if (type === 'WSR') { to = opts.to ?? opts.date ?? today; from = opts.from ?? addDays(to, -6); }
    else { to = opts.to ?? today; from = opts.from ?? addDays(to, -29); }
    if (from > to) throw new BadRequestException('Period start must be before its end');
    const data = await this.metrics.snapshot(projectId, from, to);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const content: ReportContent = { type, header: this.defaultHeader(type, project, data, user), narrative: this.defaultNarrative(type, data), data, refreshedAt: new Date().toISOString() };
    const r = await this.prisma.report.create({
      data: { projectId, type, title: `${TITLE[type]} – ${from === to ? from : `${from} to ${to}`}`, periodFrom: new Date(`${from}T00:00:00Z`), periodTo: new Date(`${to}T00:00:00Z`), content: JSON.stringify(content), createdById: user.id },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'GENERATE', entityType: 'Report', entityId: r.id, after: { type, from, to } });
    return this.get(projectId, r.id);
  }

  private defaultHeader(type: ReportType, p: { name: string; client: string | null }, d: Snapshot, user: AuthUser): Record<string, string> {
    const lastRun = d.runs[d.runs.length - 1];
    const base = { projectName: p.name, client: p.client ?? '', preparedBy: user.name, sprint: '' };
    if (type === 'DSR') return { ...base, reportDate: d.period.to, build: lastRun?.build ?? '', environment: lastRun?.environment ?? '', reportingPeriod: `${d.period.to} (${d.period.timeZone})` };
    if (type === 'WSR') return { ...base, weekFrom: d.period.from, weekTo: d.period.to };
    return { ...base, reportDate: d.period.to, periodFrom: d.period.from, periodTo: d.period.to };
  }

  /** Narrative pre-filled from the data; every field stays editable before the report is finalised. */
  private defaultNarrative(type: ReportType, d: Snapshot): Record<string, string> {
    const e = d.execution, df = d.defects;
    const runs = d.runs.map((r) => `${r.runId} (${r.kind}${r.environment ? `, ${r.environment}` : ''}${r.build ? `, build ${r.build}` : ''}): ${r.passed} pass, ${r.failed} fail, ${r.blocked} blocked, ${r.skipped} skipped`);
    const blockers = df.critical.filter((x) => x.severity === 'Blocker').map((x) => `${x.defectId} ${x.title} (${x.assignedTo ?? 'unassigned'}, ${x.ageDays} d)`);
    const risks = [
      ...(df.critical.length ? [`${df.critical.length} open Blocker/Critical/P1 defect(s) - mitigation: daily triage with development`] : []),
      ...(d.openQuestions.length ? [`${d.openQuestions.length} open clarification question(s) - mitigation: follow up with the client contact`] : []),
      ...(e.notRun ? [`${e.notRun} test case(s) not yet executed`] : []),
      ...(d.coverage.unmapped ? [`${d.coverage.unmapped} requirement item(s) without coverage`] : []),
    ];
    const pendingRetest = df.byStatus.ReadyForRetest ?? 0;
    if (type === 'DSR') return {
      tasksCompleted: bullet([...runs, ...(df.newInPeriod ? [`Logged ${df.newInPeriod} new defect(s)`] : []), ...(df.closedInPeriod ? [`Closed ${df.closedInPeriod} defect(s)`] : [])], '- No test execution recorded today'),
      tasksPlanned: bullet([...(pendingRetest ? [`Retest ${pendingRetest} defect(s) ready for retest`] : []), ...(e.notRun ? [`Execute the remaining ${e.notRun} test case(s)`] : []), ...(e.failed ? [`Re-run ${e.failed} failed test case(s) after fixes`] : []), ...(d.openQuestions.length ? [`Follow up ${d.openQuestions.length} open clarification question(s)`] : [])]),
      testerProgress: bullet(d.testers.map((t) => `${t.name}: ${t.executed} executed (${t.passed} pass, ${t.failed} fail, ${t.blocked} blocked)`), '- No executions today'),
      blockers: bullet(blockers, 'None'), risks: bullet(risks, 'None'), downtimeHours: '0', comments: '',
    };
    if (type === 'WSR') {
      const red = df.critical.some((x) => x.severity === 'Blocker') || (e.executed > 0 && e.passPct < 80);
      const amber = !red && (df.critical.length > 0 || d.coverage.unmapped > 0 || e.executionPct < 50);
      return {
        ragStatus: red ? 'Red' : amber ? 'Amber' : 'Green',
        ragReason: red ? `${df.critical.filter((x) => x.severity === 'Blocker').length ? 'Open Blocker defect(s)' : `Pass rate ${e.passPct}% is below 80%`}` : amber ? [df.critical.length ? `${df.critical.length} open Critical/P1 defect(s)` : '', d.coverage.unmapped ? `${d.coverage.unmapped} unmapped requirement item(s)` : '', e.executionPct < 50 ? `Execution at ${e.executionPct}%` : ''].filter(Boolean).join('; ') : 'On track: no high-impact defects open, coverage complete and execution progressing',
        plannedExecutionPct: '100',
        accomplishments: bullet([`Requirement coverage ${d.coverage.percent}%`, `Test cases: ${d.design.total} designed, ${d.design.approved} approved, ${d.design.automated} automated`, `${e.executedInPeriod} test case(s) executed this week`, ...(df.newInPeriod ? [`${df.newInPeriod} defect(s) raised, ${df.closedInPeriod} closed`] : [])]),
        nextWeekPlan: bullet([...(e.notRun ? [`Execute the remaining ${e.notRun} test case(s)`] : []), ...(pendingRetest ? [`Retest ${pendingRetest} fixed defect(s)`] : []), 'Full regression run on the next build']),
        milestones: '- Test design complete: \n- System test complete: \n- UAT start: \n- Release: ',
        risks: bullet(risks, 'None'), escalations: bullet(blockers, 'None'),
        resourceUtilisation: bullet(d.testers.map((t) => `${t.name}: ${t.executed} executions`), '-'),
        clientActionItems: bullet(d.openQuestions.map((q) => `${q.qId} (${q.priority}${q.assignedTo ? `, ${q.assignedTo}` : ''}): ${q.question}`), 'None'),
        comments: '',
      };
    }
    return { uatDefects: '', prodDefects: '', comments: '' };
  }

  async list(projectId: string, type?: string) {
    return this.prisma.report.findMany({ where: { projectId, ...(type ? { type } : {}) }, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, title: true, status: true, periodFrom: true, periodTo: true, createdAt: true, updatedAt: true } });
  }

  async get(projectId: string, id: string) {
    const r = await this.prisma.report.findFirst({ where: { id, projectId } });
    if (!r || !(REPORT_TYPES as readonly string[]).includes(r.type)) throw new NotFoundException('Report not found');
    const content = JSON.parse(r.content) as ReportContent;
    return { ...r, content, charts: this.charts(content.type, content.data), fields: { header: HEADER_KEYS[content.type], narrative: NARRATIVE_KEYS[content.type] }, derived: this.derived(content) };
  }

  /** Values computed from data + editable inputs (e.g. leakage). */
  private derived(c: ReportContent) {
    if (c.type !== 'DefectReport') return {};
    const uat = Number(c.narrative.uatDefects) || 0, prod = Number(c.narrative.prodDefects) || 0;
    const qa = c.data.defects.total;
    return { leakagePct: uat + prod ? Math.round(((uat + prod) / (qa + uat + prod)) * 1000) / 10 : null };
  }

  async update(projectId: string, id: string, dto: { header?: Record<string, string>; narrative?: Record<string, string> }, user: AuthUser) {
    const r = await this.prisma.report.findFirst({ where: { id, projectId } });
    if (!r) throw new NotFoundException('Report not found');
    if (r.status !== 'Draft') throw new BadRequestException('Only draft reports can be edited - reopen it as a draft first');
    const c = JSON.parse(r.content) as ReportContent;
    const allowedH = new Set(HEADER_KEYS[c.type].map(([k]) => k));
    const allowedN = new Set(NARRATIVE_KEYS[c.type].map(([k]) => k));
    for (const [k, v] of Object.entries(dto.header ?? {})) { if (!allowedH.has(k)) throw new BadRequestException(`Unknown header field ${k}`); c.header[k] = String(v).slice(0, 500); }
    for (const [k, v] of Object.entries(dto.narrative ?? {})) { if (!allowedN.has(k)) throw new BadRequestException(`Unknown field ${k}`); c.narrative[k] = String(v).slice(0, 20000); }
    if (c.type === 'WSR' && c.narrative.ragStatus && !['Red', 'Amber', 'Green'].includes(c.narrative.ragStatus)) throw new BadRequestException('Status must be Red, Amber or Green');
    for (const k of ['downtimeHours', 'uatDefects', 'prodDefects', 'plannedExecutionPct']) if (c.narrative[k] && !/^\d+(\.\d+)?$/.test(c.narrative[k])) throw new BadRequestException(`${k} must be a number`);
    await this.prisma.report.update({ where: { id }, data: { content: JSON.stringify(c) } });
    await this.audit.log({ userId: user.id, projectId, action: 'UPDATE', entityType: 'Report', entityId: id, after: dto });
    return this.get(projectId, id);
  }

  /** Re-pull the numbers for the same period; header and narrative edits are kept. */
  async refresh(projectId: string, id: string, user: AuthUser) {
    const r = await this.prisma.report.findFirst({ where: { id, projectId } });
    if (!r) throw new NotFoundException('Report not found');
    if (r.status !== 'Draft') throw new BadRequestException('Only draft reports can be refreshed');
    const c = JSON.parse(r.content) as ReportContent;
    c.data = await this.metrics.snapshot(projectId, c.data.period.from, c.data.period.to);
    c.refreshedAt = new Date().toISOString();
    await this.prisma.report.update({ where: { id }, data: { content: JSON.stringify(c) } });
    await this.audit.log({ userId: user.id, projectId, action: 'REFRESH', entityType: 'Report', entityId: id });
    return this.get(projectId, id);
  }

  async setStatus(projectId: string, id: string, status: 'Draft' | 'Final' | 'Sent', user: AuthUser) {
    const r = await this.prisma.report.findFirst({ where: { id, projectId } });
    if (!r) throw new NotFoundException('Report not found');
    const ok: Record<string, string[]> = { Draft: ['Final'], Final: ['Sent', 'Draft'], Sent: [] };
    if (!ok[r.status]?.includes(status)) throw new BadRequestException(`Cannot change a ${r.status} report to ${status}`);
    await this.prisma.report.update({ where: { id }, data: { status } });
    await this.audit.log({ userId: user.id, projectId, action: 'STATUS', entityType: 'Report', entityId: id, before: { status: r.status }, after: { status } });
    return this.get(projectId, id);
  }

  async remove(projectId: string, id: string, user: AuthUser) {
    const r = await this.prisma.report.findFirst({ where: { id, projectId } });
    if (!r) throw new NotFoundException('Report not found');
    if (r.status !== 'Draft') throw new BadRequestException('Only drafts can be deleted');
    await this.prisma.report.delete({ where: { id } });
    await this.audit.log({ userId: user.id, projectId, action: 'DELETE', entityType: 'Report', entityId: id, before: { title: r.title } });
    return { ok: true };
  }

  // ───────────────────────────── Charts ─────────────────────────────

  charts(type: ReportType | 'Dashboard', d: Snapshot): Record<string, string> {
    const e = d.execution, df = d.defects;
    const exec = stackedBar('Test case status', [
      { label: 'Pass', value: e.passed, color: C.status.Pass }, { label: 'Fail', value: e.failed, color: C.status.Fail }, { label: 'Blocked', value: e.blocked, color: C.status.Blocked },
      { label: 'Skipped', value: e.skipped, color: C.status.Skipped }, { label: 'Not run', value: e.notRun, color: C.status['Not run'] },
    ]);
    const sev = hbars('Open defects by severity', SEVERITIES.map((s, i) => ({ label: s, value: df.bySeverity[s] ?? 0, color: sevColor(i) })));
    const pri = hbars('Open defects by priority', PRIORITIES.map((p, i) => ({ label: p, value: df.byPriority[p] ?? 0, color: sevColor(i) })));
    const trend = lines('Defects opened vs closed per day', d.trends.daily.map((x) => x.date.slice(5)), [
      { name: 'Opened', color: C.s1, values: d.trends.daily.map((x) => x.opened) }, { name: 'Closed', color: C.s2, values: d.trends.daily.map((x) => x.closed) },
    ]);
    // Burn-down starts on the first day test cases existed, so the ideal line runs from the real starting scope to zero.
    const startIdx = Math.max(0, d.trends.burndown.findIndex((x) => x.remaining > 0 || x.openDefects > 0));
    const bd = d.trends.burndown.slice(startIdx);
    const rem = bd.map((x) => x.remaining);
    const ideal = rem.map((_, i) => Math.round(((rem[0] ?? 0) * (rem.length - 1 - i)) / Math.max(1, rem.length - 1)));
    const burndown = lines('Burn-down: test cases not yet executed', bd.map((x) => x.date.slice(5)), [
      { name: 'Remaining', color: C.s1, values: rem }, { name: 'Ideal', color: C.muted, values: ideal, dashed: true },
    ]);
    const weekly = stackedColumns('Executions per week (week ending)', d.trends.weekly.map((w) => w.week), [
      { name: 'Pass', color: C.status.Pass, values: d.trends.weekly.map((w) => w.passed) }, { name: 'Fail', color: C.status.Fail, values: d.trends.weekly.map((w) => w.failed) },
      { name: 'Blocked', color: C.status.Blocked, values: d.trends.weekly.map((w) => w.blocked) },
    ]);
    const ageing = hbars('Open defect ageing', AGE_BUCKETS.map((b, i) => ({ label: b, value: df.ageing[b] ?? 0, color: C.ramp[i + 1] })));
    const modules = hbars('Defects by module', Object.entries(df.byModule).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value })));
    const status = hbars('Defects by status', Object.entries(df.byStatus).sort((a, b) => b[1] - a[1]).map(([s, value]) => ({ label: STATUS_LABEL[s] ?? s, value })));
    const rtmOrder = ['Pass', 'Fail', 'Blocked', 'In Progress', 'Not Run', 'No Tests', 'N/A'];
    const rtm = stackedBar('Requirement (RTM) execution status', rtmOrder.filter((k) => d.rtm[k]).map((k) => ({ label: k, value: d.rtm[k], color: ({ Pass: C.status.Pass, Fail: C.status.Fail, Blocked: C.status.Blocked, 'In Progress': C.s1, 'Not Run': C.status['Not run'], 'No Tests': C.status.Skipped, 'N/A': '#e1e0d9' } as Record<string, string>)[k] })));
    if (type === 'DSR') return { exec, sev, pri };
    if (type === 'WSR') return { weekly, trend, burndown, sev, modules, ageing };
    if (type === 'DefectReport') return { sev, pri, status, modules, ageing, trend };
    return { exec, rtm, sev, pri, burndown, trend };
  }

  async dashboard(projectId: string, days = 14) {
    const to = await this.metrics.today(projectId);
    const data = await this.metrics.snapshot(projectId, addDays(to, -(Math.min(Math.max(days, 7), 90) - 1)), to);
    return { data, charts: this.charts('Dashboard', data) };
  }

  // ───────────────────────────── Export ─────────────────────────────

  private async chartImages(charts: Record<string, string>): Promise<ExportImage[]> {
    const out: ExportImage[] = [];
    for (const svg of Object.values(charts)) {
      const w = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 640), h = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 260);
      const title = /<title>([^<]*)<\/title>/.exec(svg)?.[1] ?? 'Chart';
      out.push({ caption: title.replace(/&amp;/g, '&'), data: await renderPng(`<!doctype html><html><body style="margin:0">${svg}</body></html>`, w, h, 2), mimeType: 'image/png' });
    }
    return out;
  }

  async exportDoc(projectId: string, id: string): Promise<ExportDoc> {
    const r = await this.get(projectId, id);
    const c = r.content, d = c.data, e = d.execution, df = d.defects, n = c.narrative;
    const kv = (pairs: [string, string | number][]) => pairs.map(([k, v]) => [k, String(v)] as [string, string]);
    const text = (label: string, v: string | undefined): ExportSection => ({ heading: label, paragraphs: (v || '—').split('\n').map((l) => (l.startsWith('- ') ? `• ${l.slice(2)}` : l)).filter((l) => l.trim()) });
    const defectCols = [
      { header: 'Defect ID', key: 'defectId', width: 10 }, { header: 'Title', key: 'title', width: 45 }, { header: 'Severity', key: 'severity', width: 9 }, { header: 'Priority', key: 'priority', width: 8 },
      { header: 'Status', key: 'statusLabel', width: 13 }, { header: 'Module', key: 'module', width: 12 }, { header: 'Assigned To', key: 'assignedTo', width: 14 }, { header: 'Age (days)', key: 'ageDays', width: 8 },
    ];
    const defectRows = (rows: typeof df.list) => rows.map((x) => ({ ...x, statusLabel: STATUS_LABEL[x.status] ?? x.status }));
    const red = (row: Record<string, unknown>) => (row.severity === 'Blocker' || row.severity === 'Critical' || row.priority === 'P1' ? 'red' as const : undefined);
    const images = await this.chartImages(r.charts);
    const execSummary: [string, string | number][] = [['Total test cases', e.totalTcs], ['Executed (to date)', e.executed], ['Passed', e.passed], ['Failed', e.failed], ['Blocked', e.blocked], ['Not run', e.notRun], ['Execution %', `${e.executionPct}%`], ['Pass %', `${e.passPct}%`]];
    const sevPri: [string, string | number][] = [...SEVERITIES.map((s) => [s, df.bySeverity[s] ?? 0] as [string, number]), ...PRIORITIES.map((p) => [p, df.byPriority[p] ?? 0] as [string, number])];
    const criticalSection: ExportSection = { heading: `Blocker / Critical / P1 defects (${df.critical.length})`, table: { sheetName: 'Critical', columns: defectCols, rows: defectRows(df.critical), highlight: red } };
    const header = HEADER_KEYS[c.type].map(([k, label]) => [label, c.header[k] || '—'] as [string, string]);
    const sections: ExportSection[] = [];

    if (c.type === 'DSR') {
      sections.push(
        { heading: 'Execution summary', keyValues: kv([...execSummary.slice(0, 1), ['Executed today', e.executedInPeriod], ['Passed today', e.passedInPeriod], ['Failed today', e.failedInPeriod], ['Blocked today', e.blockedInPeriod], ...execSummary.slice(1)]), images: images.slice(0, 1) },
        { heading: 'Defect summary', keyValues: kv([['New today', df.newInPeriod], ['Total open', df.open], ['Closed today', df.closedInPeriod], ['Reopened today', df.reopenedInPeriod], ...sevPri]), images: images.slice(1) },
        criticalSection,
        text('Tasks completed today', n.tasksCompleted), text('Tasks planned for tomorrow', n.tasksPlanned), text('Tester-wise task assignment & progress', n.testerProgress),
        text('Blockers / issues / dependencies', n.blockers), text('Risks', n.risks),
        { heading: `Open clarification questions (${d.openQuestions.length})`, table: { sheetName: 'Open questions', columns: [{ header: 'Q-ID', key: 'qId', width: 8 }, { header: 'Question', key: 'question', width: 70 }, { header: 'Priority', key: 'priority', width: 9 }, { header: 'Assigned to', key: 'assignedTo', width: 16 }, { header: 'Age (days)', key: 'ageDays', width: 8 }], rows: d.openQuestions } },
        { heading: 'Environment downtime', paragraphs: [`${n.downtimeHours || 0} hour(s)`] },
        text('Comments / notes', n.comments),
      );
    } else if (c.type === 'WSR') {
      const rag = n.ragStatus || 'Green';
      sections.push(
        { heading: `Overall status: ${rag.toUpperCase()}`, paragraphs: [n.ragReason || '—'] },
        { heading: 'Progress', keyValues: kv([['Planned execution %', `${n.plannedExecutionPct || '—'}%`], ['Actual execution %', `${e.executionPct}%`], ['Pass %', `${e.passPct}%`], ['Requirement coverage', `${d.coverage.percent}% (${d.coverage.unmapped} unmapped)`], ['Test cases created / reviewed / approved', `${d.design.total} / ${d.design.approved + d.design.rejected} / ${d.design.approved}`], ['Executed this week', e.executedInPeriod]]), images: images.slice(0, 1) },
        { heading: 'Defect summary', keyValues: kv([['Opened this week', df.newInPeriod], ['Closed this week', df.closedInPeriod], ['Reopened this week', df.reopenedInPeriod], ['Open', df.open], ...sevPri]), images: images.slice(1) },
        { heading: 'Defect density per module', table: { sheetName: 'Density', columns: [{ header: 'Module', key: 'module', width: 20 }, { header: 'Test cases', key: 'testCases', width: 10 }, { header: 'Defects', key: 'defects', width: 10 }, { header: 'Defects per test case', key: 'density', width: 12 }], rows: d.moduleDensity } },
        criticalSection,
        text('Top risks & mitigation', n.risks), text('Key accomplishments this week', n.accomplishments), text('Plan for next week', n.nextWeekPlan),
        text('Milestone tracker', n.milestones), text('Open issues / escalations', n.escalations), text('Resource utilisation', n.resourceUtilisation),
        text('Client action items', n.clientActionItems), text('Comments', n.comments),
      );
    } else {
      const shots: ExportImage[] = [];
      for (const x of df.list.filter((x) => x.thumbnailId).slice(0, 24)) {
        const a = await this.prisma.attachment.findUnique({ where: { id: x.thumbnailId! } });
        if (a) try { shots.push({ caption: `${x.defectId} – ${x.title.slice(0, 80)}`, data: await this.storage.get(a.storagePath), mimeType: a.mimeType }); } catch { /* missing file */ }
      }
      const der = r.derived as { leakagePct: number | null };
      sections.push(
        { heading: 'Summary', keyValues: kv([['Total defects', df.total], ['Open', df.open], ['New in period', df.newInPeriod], ['Closed in period', df.closedInPeriod], ['Reopen rate', `${df.reopenRate}%`], ['Rejection rate', `${df.rejectionRate}%`], ['Defect leakage', der.leakagePct === null ? 'Enter UAT/production defect counts' : `${der.leakagePct}%`]]) },
        { heading: 'By severity, priority, status, module, assignee and type', keyValues: kv([...sevPri, ...Object.entries(df.byStatus).map(([k, v]) => [STATUS_LABEL[k] ?? k, v] as [string, number]), ...Object.entries(df.byModule).map(([k, v]) => [`Module: ${k}`, v] as [string, number]), ...Object.entries(df.byAssignee).map(([k, v]) => [`Assignee: ${k}`, v] as [string, number]), ...Object.entries(df.byType).map(([k, v]) => [`Type: ${k}`, v] as [string, number])]), images },
        criticalSection,
        { heading: 'Defect ageing (open defects)', keyValues: kv(AGE_BUCKETS.map((b) => [b, df.ageing[b] ?? 0])) },
        { heading: `All defects (${df.list.length})`, table: { sheetName: 'All defects', columns: [...defectCols, { header: 'Type', key: 'defectType', width: 11 }, { header: 'Reported', key: 'reported', width: 11 }, { header: 'Jira', key: 'jiraKey', width: 10 }], rows: defectRows(df.list).map((x) => ({ ...x, reported: x.reportedDate.slice(0, 10) })), highlight: (row) => (row.status !== 'Closed' ? red(row) : undefined) } },
        { heading: 'Screenshots', images: shots, paragraphs: shots.length ? undefined : ['No screenshots attached to these defects.'] },
        text('Comments', n.comments),
      );
    }
    return {
      title: `${TITLE[c.type]}${c.type === 'WSR' ? ` – ${n.ragStatus?.toUpperCase() ?? ''}` : ''}`, subtitle: `${c.header.projectName}${c.header.client ? ` · ${c.header.client}` : ''}`,
      banner: r.status === 'Draft' ? 'DRAFT' : undefined, meta: header, sections,
    };
  }

  /** Email draft (.eml) with an HTML summary and the PDF attached - opened and sent from the user's own mail client. */
  async eml(projectId: string, id: string): Promise<{ data: Buffer; fileName: string }> {
    const r = await this.get(projectId, id);
    const c = r.content, d = c.data;
    const pdf = await this.exporter.render(await this.exportDoc(projectId, id), 'pdf');
    const name = `${c.type}-${c.data.period.to}`;
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#0b0b0b">
<h2 style="margin:0 0 8px">${esc(TITLE[c.type])} – ${esc(c.header.projectName)}</h2><p>Period: ${esc(d.period.from === d.period.to ? d.period.to : `${d.period.from} to ${d.period.to}`)}${c.type === 'WSR' ? ` · Overall status: <b>${esc(c.narrative.ragStatus ?? '')}</b>` : ''}</p>
<table cellpadding="6" style="border-collapse:collapse" border="1"><tr><th align="left">Executed</th><td>${d.execution.executed}/${d.execution.totalTcs} (${d.execution.executionPct}%)</td></tr><tr><th align="left">Pass rate</th><td>${d.execution.passPct}%</td></tr><tr><th align="left">Open defects</th><td>${d.defects.open}</td></tr><tr><th align="left">Coverage</th><td>${d.coverage.percent}%</td></tr></table>
${d.defects.critical.length ? `<h3 style="color:#b91c1c">Blocker / Critical / P1 (${d.defects.critical.length})</h3><ul>${d.defects.critical.map((x) => `<li style="color:#b91c1c;font-weight:bold">${esc(x.defectId)} ${esc(x.title)} – ${x.severity}/${x.priority}, ${esc(x.assignedTo ?? 'unassigned')}, ${x.ageDays} d</li>`).join('')}</ul>` : '<p>No open Blocker, Critical or P1 defects.</p>'}
<p>The full report is attached as PDF.</p><p style="color:#52514e">Prepared by ${esc(c.header.preparedBy ?? '')} with QA Pilot.</p></body></html>`;
    const b64 = (buf: Buffer) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
    const boundary = `qapilot-${id}`;
    const subject = `${TITLE[c.type]} – ${c.header.projectName} – ${d.period.to}`;
    const eml = [
      'X-Unsent: 1', 'To: ', `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(Buffer.from(html)), '',
      `--${boundary}`, `Content-Type: application/pdf; name="${name}.pdf"`, `Content-Disposition: attachment; filename="${name}.pdf"`, 'Content-Transfer-Encoding: base64', '', b64(pdf.data), '',
      `--${boundary}--`, '',
    ].join('\r\n');
    return { data: Buffer.from(eml), fileName: `${name}.eml` };
  }
}
