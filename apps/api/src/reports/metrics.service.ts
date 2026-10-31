import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequirementsService } from '../requirements/requirements.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { ageDays, isOpen } from '../defects/lifecycle';
import { zoned } from '../monitoring/clock';

export const SEVERITIES = ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'];
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const AGE_BUCKETS = ['0–2 days', '3–5 days', '6–10 days', '>10 days'];

/** UTC instant at which the local calendar day `date` (YYYY-MM-DD) starts in `tz`. */
export function startOfLocalDay(date: string, tz: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const z = zoned(new Date(guess), tz);
  const offset = Date.parse(`${z.date}T${z.time}:00Z`) - guess; // local - utc
  return new Date(guess - offset);
}
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

export interface DefectRow {
  id: string; defectId: string; title: string; severity: string; priority: string; status: string; module: string | null; assignedTo: string | null;
  defectType: string; ageDays: number; reportedDate: string; jiraKey: string | null; thumbnailId: string | null;
}

/** Everything the DSR, WSR, Defect Report and Dashboard are built from, for a local-date period. */
export interface Snapshot {
  period: { from: string; to: string; timeZone: string };
  execution: { totalTcs: number; executed: number; passed: number; failed: number; blocked: number; skipped: number; notRun: number; executionPct: number; passPct: number; executedInPeriod: number; passedInPeriod: number; failedInPeriod: number; blockedInPeriod: number };
  design: { total: number; approved: number; rejected: number; pending: number; createdInPeriod: number; automated: number };
  coverage: { percent: number; testCoveragePercent: number; unmapped: number; total: number };
  defects: {
    total: number; open: number; newInPeriod: number; closedInPeriod: number; reopenedInPeriod: number; drafts: number;
    bySeverity: Record<string, number>; byPriority: Record<string, number>; byStatus: Record<string, number>; byModule: Record<string, number>;
    byAssignee: Record<string, number>; byType: Record<string, number>; ageing: Record<string, number>;
    reopenRate: number; rejectionRate: number; critical: DefectRow[]; list: DefectRow[];
  };
  testers: { name: string; executed: number; passed: number; failed: number; blocked: number }[];
  runs: { runId: string; kind: string; status: string; passed: number; failed: number; blocked: number; skipped: number; environment: string | null; build: string | null; startedAt: string | null }[];
  openQuestions: { qId: string; question: string; priority: string; assignedTo: string | null; ageDays: number }[];
  trends: { daily: { date: string; opened: number; closed: number }[]; burndown: { date: string; remaining: number; openDefects: number }[]; weekly: { week: string; passed: number; failed: number; blocked: number }[] };
  moduleDensity: { module: string; testCases: number; defects: number; density: number }[];
  rtm: Record<string, number>;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const highImpact = (d: { severity: string; priority: string }) => d.severity === 'Blocker' || d.severity === 'Critical' || d.priority === 'P1';
const bucket = (age: number) => (age <= 2 ? AGE_BUCKETS[0] : age <= 5 ? AGE_BUCKETS[1] : age <= 10 ? AGE_BUCKETS[2] : AGE_BUCKETS[3]);
const countBy = <T>(rows: T[], key: (r: T) => string | null | undefined, order?: string[]) => {
  const m: Record<string, number> = Object.fromEntries((order ?? []).map((k) => [k, 0]));
  for (const r of rows) { const k = key(r) || 'Unassigned'; m[k] = (m[k] ?? 0) + 1; }
  return m;
};

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService, private readonly reqs: RequirementsService, private readonly monitor: MonitoringService) {}

  async timeZone(projectId: string) {
    return (await this.monitor.settings(projectId)).timeZone;
  }

  async today(projectId: string) {
    return zoned(new Date(), await this.timeZone(projectId)).date;
  }

  async snapshot(projectId: string, from: string, to: string, now = new Date()): Promise<Snapshot> {
    const tz = await this.timeZone(projectId);
    const start = startOfLocalDay(from, tz);
    const end = startOfLocalDay(addDays(to, 1), tz);
    const inPeriod = (d: Date | null | undefined) => !!d && d >= start && d < end;
    const local = (d: Date) => zoned(d, tz).date;

    const [tcs, results, defects, history, questions, runs, coverage] = await Promise.all([
      this.prisma.testCase.findMany({ where: { projectId }, select: { id: true, status: true, reviewStatus: true, module: true, createdAt: true, automatedScriptId: true, requirements: { select: { requirementId: true } } } }),
      this.prisma.testResult.findMany({ where: { run: { projectId } }, select: { testCaseId: true, status: true, executedBy: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.defect.findMany({ where: { projectId }, include: { attachments: { select: { id: true, kind: true, mimeType: true } } }, orderBy: { defectId: 'asc' } }),
      this.prisma.defectHistory.findMany({ where: { defect: { projectId }, kind: 'StatusChange' }, select: { defectId: true, fromValue: true, toValue: true, createdAt: true } }),
      this.prisma.clarificationQuestion.findMany({ where: { projectId, status: 'Open' }, orderBy: { qId: 'asc' } }),
      this.prisma.testRun.findMany({ where: { projectId }, include: { environment: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
      this.reqs.coverageSummary(projectId),
    ]);

    // ── Execution (current status of every test case) + activity in the period
    const st = countBy(tcs, (t) => t.status);
    const executed = tcs.length - (st.NotRun ?? 0);
    const periodResults = results.filter((r) => inPeriod(r.createdAt));
    const lastInPeriod = new Map<string, string>();
    for (const r of periodResults) lastInPeriod.set(r.testCaseId, r.status);
    const pv = [...lastInPeriod.values()];

    // ── Testers (who executed what in the period)
    const testers = new Map<string, { name: string; executed: number; passed: number; failed: number; blocked: number }>();
    for (const r of periodResults) {
      const name = r.executedBy ?? 'Unknown';
      const t = testers.get(name) ?? { name, executed: 0, passed: 0, failed: 0, blocked: 0 };
      t.executed++; if (r.status === 'Pass') t.passed++; if (r.status === 'Fail') t.failed++; if (r.status === 'Blocked') t.blocked++;
      testers.set(name, t);
    }

    // ── Defects
    const confirmed = defects.filter((d) => !d.isDraft);
    const open = confirmed.filter((d) => isOpen(d.status));
    const row = (d: (typeof defects)[number]): DefectRow => ({
      id: d.id, defectId: d.defectId, title: d.title, severity: d.severity, priority: d.priority, status: d.status, module: d.module, assignedTo: d.assignedTo,
      defectType: d.defectType, ageDays: ageDays(d.reportedDate, d.closedDate ?? now), reportedDate: d.reportedDate.toISOString(), jiraKey: d.jiraKey,
      thumbnailId: (d.attachments.find((a) => a.kind === 'AnnotatedScreenshot') ?? d.attachments.find((a) => a.mimeType.startsWith('image/')))?.id ?? null,
    });
    const confirmedAt = new Map<string, Date>();
    for (const h of history) if (h.fromValue === 'Draft' && !confirmedAt.has(h.defectId)) confirmedAt.set(h.defectId, h.createdAt);
    const raisedAt = (d: (typeof defects)[number]) => confirmedAt.get(d.id) ?? (d.testResultId ? null : d.createdAt);
    const transitionsIn = (to: string) => new Set(history.filter((h) => h.toValue === to && inPeriod(h.createdAt)).map((h) => h.defectId));
    const everReopened = new Set(history.filter((h) => h.toValue === 'Reopened').map((h) => h.defectId));

    // ── Trends: daily opened vs closed, burn-down of not-yet-executed test cases and open defects, weekly results
    const days = daysBetween(from, to);
    const closedOn = (d: (typeof defects)[number]) => (d.closedDate ? local(d.closedDate) : null);
    const daily = days.map((date) => ({
      date,
      opened: confirmed.filter((d) => { const r = raisedAt(d); return r && local(r) === date; }).length,
      closed: confirmed.filter((d) => closedOn(d) === date && d.status === 'Closed').length,
    }));
    const firstRun = new Map<string, string>();
    for (const r of results) if (!firstRun.has(r.testCaseId)) firstRun.set(r.testCaseId, local(r.createdAt));
    const burndown = days.map((date) => ({
      date,
      remaining: tcs.filter((t) => local(t.createdAt) <= date && !(firstRun.get(t.id) && firstRun.get(t.id)! <= date)).length,
      openDefects: confirmed.filter((d) => { const r = raisedAt(d); return r && local(r) <= date && !(closedOn(d) && closedOn(d)! <= date); }).length,
    }));
    const weeks: { week: string; passed: number; failed: number; blocked: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const wEnd = addDays(to, -7 * i), wStart = addDays(wEnd, -6);
      const rs = results.filter((r) => { const d = local(r.createdAt); return d >= wStart && d <= wEnd; });
      weeks.push({ week: wEnd.slice(5), passed: rs.filter((r) => r.status === 'Pass').length, failed: rs.filter((r) => r.status === 'Fail').length, blocked: rs.filter((r) => r.status === 'Blocked').length });
    }

    // ── Module density: defects per test case
    const modules = [...new Set([...tcs.map((t) => t.module), ...confirmed.map((d) => d.module).filter((m): m is string => !!m)])];
    const moduleDensity = modules.map((m) => {
      const n = tcs.filter((t) => t.module === m).length;
      const dn = confirmed.filter((d) => d.module === m && d.status !== 'Duplicate' && d.status !== 'NotABug' && d.status !== 'Rejected').length;
      return { module: m, testCases: n, defects: dn, density: n ? Math.round((dn / n) * 100) / 100 : dn };
    }).sort((a, b) => b.density - a.density);

    const rtm = await this.reqs.rtm(projectId);
    return {
      period: { from, to, timeZone: tz },
      execution: {
        totalTcs: tcs.length, executed, passed: st.Pass ?? 0, failed: st.Fail ?? 0, blocked: st.Blocked ?? 0, skipped: st.Skipped ?? 0, notRun: st.NotRun ?? 0,
        executionPct: pct(executed, tcs.length), passPct: pct(st.Pass ?? 0, executed),
        executedInPeriod: lastInPeriod.size, passedInPeriod: pv.filter((s) => s === 'Pass').length, failedInPeriod: pv.filter((s) => s === 'Fail').length, blockedInPeriod: pv.filter((s) => s === 'Blocked').length,
      },
      design: {
        total: tcs.length, approved: tcs.filter((t) => t.reviewStatus === 'Approved').length, rejected: tcs.filter((t) => t.reviewStatus === 'Rejected').length,
        pending: tcs.filter((t) => t.reviewStatus === 'PendingReview').length, createdInPeriod: tcs.filter((t) => inPeriod(t.createdAt)).length,
        automated: tcs.filter((t) => t.automatedScriptId).length,
      },
      coverage: { percent: coverage.coveragePercent, testCoveragePercent: coverage.testCoveragePercent, unmapped: coverage.unmapped, total: coverage.total },
      defects: {
        total: confirmed.length, open: open.length, drafts: defects.length - confirmed.length,
        newInPeriod: confirmed.filter((d) => inPeriod(raisedAt(d))).length,
        closedInPeriod: transitionsIn('Closed').size, reopenedInPeriod: transitionsIn('Reopened').size,
        bySeverity: countBy(open, (d) => d.severity, SEVERITIES), byPriority: countBy(open, (d) => d.priority, PRIORITIES),
        byStatus: countBy(confirmed, (d) => d.status), byModule: countBy(confirmed, (d) => d.module ?? 'Unspecified'),
        byAssignee: countBy(open, (d) => d.assignedTo), byType: countBy(confirmed, (d) => d.defectType),
        ageing: countBy(open, (d) => bucket(ageDays(d.reportedDate, now)), AGE_BUCKETS),
        reopenRate: pct(confirmed.filter((d) => everReopened.has(d.id)).length, confirmed.length),
        rejectionRate: pct(confirmed.filter((d) => d.status === 'Rejected' || d.status === 'NotABug').length, confirmed.length),
        critical: open.filter(highImpact).map(row), list: confirmed.map(row),
      },
      testers: [...testers.values()].sort((a, b) => b.executed - a.executed),
      runs: runs.filter((r) => inPeriod(r.startedAt ?? r.createdAt)).map((r) => ({ runId: r.runId, kind: r.kind, status: r.status, passed: r.passed, failed: r.failed, blocked: r.blocked, skipped: r.skipped, environment: r.environment?.name ?? null, build: r.build, startedAt: r.startedAt?.toISOString() ?? null })),
      openQuestions: questions.map((q) => ({ qId: q.qId, question: q.question, priority: q.priority, assignedTo: q.assignedTo, ageDays: ageDays(q.raisedDate, now) })),
      trends: { daily, burndown, weekly: weeks },
      moduleDensity,
      rtm: countBy(rtm.filter((r) => r.sourceKind !== 'Header' && r.sourceKind !== 'TableRow'), (r) => r.executionStatus),
    };
  }
}
