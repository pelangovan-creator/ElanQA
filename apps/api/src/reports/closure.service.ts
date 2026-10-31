import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { roleHas } from '../common/permissions';
import { ExportDoc, ExportImage, ExportSection } from '../common/export/model';
import { renderPng } from '../common/export/pdf';
import { ExportService } from '../common/export/export.service';
import { STATUS_LABEL } from '../defects/lifecycle';
import { RequirementsService } from '../requirements/requirements.service';
import { C, hbars, stackedBar } from './charts';
import { MetricsService, PRIORITIES, SEVERITIES, Snapshot } from './metrics.service';

export const TRIGGERS = ['AllDefectsClosed', 'CriticalClosed', 'ClientRequest'] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const TRIGGER_LABEL: Record<Trigger, string> = {
  AllDefectsClosed: '(a) All defects are closed',
  CriticalClosed: '(b) All Blocker, Critical and P1 defects are closed',
  ClientRequest: '(c) Closure requested by the client',
};
const LEVELS = ['High', 'Medium', 'Low'] as const;
type Level = (typeof LEVELS)[number];
export const DECISIONS = ['Go', 'ConditionalGo', 'NoGo'] as const;
const DECISION_LABEL: Record<string, string> = { Go: 'GO', ConditionalGo: 'CONDITIONAL GO', NoGo: 'NO-GO' };

/** Impact × likelihood → risk level. */
export function riskLevel(impact: Level, likelihood: Level): Level {
  const s = { High: 3, Medium: 2, Low: 1 };
  const score = s[impact] * s[likelihood];
  return score >= 6 ? 'High' : score >= 3 ? 'Medium' : 'Low';
}

export interface RiskRow {
  id: string; defectId: string; title: string; severity: string; priority: string; status: string; isDraft: boolean; module: string | null;
  businessImpact: Level; likelihood: Level; riskLevel: Level; impactDescription: string; workaround: string; mitigation: string; owner: string;
}
export interface ExitCriterion { key: string; criterion: string; met: boolean; actual: string; comment: string }
export interface SignOff { role: 'QALead' | 'PM' | 'Client'; name: string; decision: string; comment: string; signedAt: string | null; signedBy: string | null }

export interface ClosureContent {
  type: 'Closure';
  trigger: Trigger; triggerReason: string;
  header: Record<string, string>;
  narrative: Record<string, string>;
  data: Snapshot;
  extra: {
    typesPerformed: { testType: string; count: number }[]; techniquesPerformed: { technique: string; count: number }[];
    environments: { name: string; envType: string; baseUrl: string; browsers: string; viewport: string | null }[];
    rtm: { reqId: string; text: string; testCaseIds: string[]; executionStatus: string; defectIds: string[]; coverageStatus: string }[];
    deliverables: { name: string; where: string }[];
  };
  risks: RiskRow[];
  exitCriteria: ExitCriterion[];
  recommendation: { decision: (typeof DECISIONS)[number]; reason: string; conditions: string; suggested: string };
  signOff: SignOff[];
  refreshedAt: string;
}

export const HEADER_FIELDS: [string, string][] = [
  ['projectName', 'Project'], ['client', 'Client'], ['release', 'Release / version'], ['reportDate', 'Report date'], ['documentVersion', 'Document version'], ['preparedBy', 'Prepared by'], ['periodFrom', 'Testing from'], ['periodTo', 'Testing to'],
];
export const NARRATIVE_FIELDS: [string, string][] = [
  ['objectives', 'Test objectives'], ['scopeIn', 'In scope'], ['scopeOut', 'Out of scope'], ['deviations', 'Deviations from the test plan'], ['lessonsLearned', 'Lessons learned'],
  ['bestPractices', 'Best practices'], ['recommendations', 'Recommendations'], ['knownIssues', 'Known issues / limitations'],
];

/** For closure only Closed / Rejected / Duplicate / Not a Bug count as resolved (Verified and Deferred are still open). */
const RESOLVED = new Set(['Closed', 'Rejected', 'Duplicate', 'NotABug']);
export const openAtClosure = (d: { isDraft: boolean; status: string }) => d.isDraft || !RESOLVED.has(d.status);
const highImpact = (d: { severity: string; priority: string }) => d.severity === 'Blocker' || d.severity === 'Critical' || d.priority === 'P1';
const bullet = (xs: string[], empty = '—') => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : empty);

@Injectable()
export class ClosureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly reqs: RequirementsService,
    private readonly exporter: ExportService,
  ) {}

  /** Live check of the trigger conditions. Draft defects are unreviewed failures, so they count as open. */
  async eligibility(projectId: string) {
    const defects = await this.prisma.defect.findMany({ where: { projectId }, select: { id: true, defectId: true, title: true, severity: true, priority: true, status: true, isDraft: true } });
    const open = defects.filter(openAtClosure);
    const openCritical = open.filter(highImpact);
    return {
      open: open.length, openCritical: openCritical.length, drafts: defects.filter((d) => d.isDraft).length,
      triggers: {
        AllDefectsClosed: { met: open.length === 0, label: TRIGGER_LABEL.AllDefectsClosed, detail: open.length ? `${open.length} defect(s) not closed yet (drafts, deferred and verified-but-not-closed count)` : 'Every defect is closed' },
        CriticalClosed: { met: openCritical.length === 0, label: TRIGGER_LABEL.CriticalClosed, detail: openCritical.length ? `Still open: ${openCritical.map((d) => d.defectId).join(', ')}` : 'No Blocker, Critical or P1 defect is open' },
        ClientRequest: { met: true, label: TRIGGER_LABEL.ClientRequest, detail: 'QA Lead can close on the client\'s request with a reason; every open defect then gets a risk assessment' },
      },
    };
  }

  // ───────────────────────────── Generate ─────────────────────────────

  async generate(projectId: string, dto: { trigger: Trigger; reason?: string; release?: string }, user: AuthUser) {
    const el = await this.eligibility(projectId);
    if (!el.triggers[dto.trigger]?.met) throw new BadRequestException(`Closure condition not met: ${el.triggers[dto.trigger]?.detail ?? 'unknown trigger'}`);
    if (dto.trigger === 'ClientRequest' && (dto.reason ?? '').trim().length < 10) throw new BadRequestException('Give the reason for the client\'s closure request (at least 10 characters)');
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const firstTc = await this.prisma.testCase.findFirst({ where: { projectId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    const tz = await this.metrics.timeZone(projectId);
    const today = await this.metrics.today(projectId);
    const from = (project.startDate ?? firstTc?.createdAt ?? new Date()).toISOString().slice(0, 10);
    const data = await this.metrics.snapshot(projectId, from <= today ? from : today, today);
    const extra = await this.extra(projectId);
    const plan = await this.prisma.artefact.findFirst({ where: { projectId, type: 'TestPlan' }, orderBy: { version: 'desc' } });
    const planSection = (key: string) => (plan ? (JSON.parse(plan.content).sections as { key: string; body: string }[]).find((s) => s.key === key)?.body : undefined);
    const scope = planSection('scope') ?? '';
    const [scopeIn, scopeOut] = scope.includes('Out of scope:') ? scope.split('Out of scope:') : [scope, ''];
    const risks = await this.riskRows(projectId, []);
    const exitCriteria = this.exitCriteria(data, risks, []);
    const suggested = this.suggest(dto.trigger, data, risks, exitCriteria);
    const content: ClosureContent = {
      type: 'Closure', trigger: dto.trigger, triggerReason: dto.reason?.trim() ?? '',
      header: { projectName: project.name, client: project.client ?? '', release: dto.release ?? data.runs[data.runs.length - 1]?.build ?? '', reportDate: today, documentVersion: '1.0', preparedBy: user.name, periodFrom: data.period.from, periodTo: data.period.to },
      narrative: {
        objectives: planSection('intro') ?? 'Verify that every requirement in the baseline is implemented as specified, report defects with evidence, and give an objective basis for the release decision.',
        scopeIn: (scopeIn.replace(/^In scope:\s*/, '').trim() || bullet([...new Set(data.moduleDensity.map((m) => m.module))])),
        scopeOut: scopeOut.trim() || 'None identified.',
        deviations: bullet([
          ...(dto.trigger === 'ClientRequest' ? [`Testing closed early at the client's request: ${dto.reason?.trim()}`] : []),
          ...(data.execution.notRun ? [`${data.execution.notRun} planned test case(s) were not executed`] : []),
          ...(data.coverage.unmapped ? [`${data.coverage.unmapped} requirement item(s) were not covered`] : []),
        ], 'No deviations from the test plan.'),
        lessonsLearned: bullet([
          ...(data.defects.reopenRate > 0 ? [`${data.defects.reopenRate}% of defects were reopened - strengthen fix verification before handing back to QA`] : []),
          ...(data.openQuestions.length ? [`${data.openQuestions.length} clarification question(s) stayed open - agree answer times with the client at the start`] : []),
          'Early requirement analysis (zero-miss extraction and clarification log) surfaced ambiguities before test design',
        ]),
        bestPractices: bullet(['Traceability from every requirement item to test cases, results and defects (RTM)', 'Automated evidence (screenshots, video, trace, logs) attached to every failure', 'Twice-daily defect monitoring with SLA tracking']),
        recommendations: bullet([
          ...(risks.length ? ['Track the open defects listed in the risk assessment to closure in the next release'] : []),
          ...(data.execution.notRun ? ['Execute the remaining test cases before or immediately after release'] : []),
          'Keep the automated regression suite in the release pipeline',
        ]),
        knownIssues: bullet(risks.map((r) => `${r.defectId} ${r.title} (${r.severity}/${r.priority})${r.workaround ? ` - workaround: ${r.workaround}` : ''}`), 'None.'),
      },
      data, extra, risks, exitCriteria,
      recommendation: { decision: suggested.decision, reason: suggested.reason, conditions: suggested.conditions, suggested: suggested.decision },
      signOff: (['QALead', 'PM', 'Client'] as const).map((role) => ({ role, name: '', decision: '', comment: '', signedAt: null, signedBy: null })),
      refreshedAt: new Date().toISOString(),
    };
    void tz;
    const r = await this.prisma.report.create({
      data: { projectId, type: 'Closure', title: `Test Closure Report – ${content.header.release || today}`, periodFrom: new Date(`${data.period.from}T00:00:00Z`), periodTo: new Date(`${data.period.to}T00:00:00Z`), content: JSON.stringify(content), createdById: user.id },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'GENERATE', entityType: 'ClosureReport', entityId: r.id, after: { trigger: dto.trigger, reason: dto.reason, open: risks.length, decision: suggested.decision } });
    return this.get(projectId, r.id);
  }

  private async extra(projectId: string): Promise<ClosureContent['extra']> {
    const [tcs, envs, rtm, docs, scripts] = await Promise.all([
      this.prisma.testCase.findMany({ where: { projectId }, select: { testType: true, technique: true } }),
      this.prisma.testEnvironment.findMany({ where: { projectId } }),
      this.reqs.rtm(projectId),
      this.prisma.artefact.findMany({ where: { projectId }, select: { type: true, version: true } }),
      this.prisma.automationScript.count({ where: { projectId } }),
    ]);
    const tally = (xs: string[]) => Object.entries(xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
    return {
      typesPerformed: tally(tcs.map((t) => t.testType)).map(([testType, count]) => ({ testType, count })),
      techniquesPerformed: tally(tcs.map((t) => t.technique)).map(([technique, count]) => ({ technique, count })),
      environments: envs.map((e) => ({ name: e.name, envType: e.envType, baseUrl: e.baseUrl, browsers: (JSON.parse(e.browsers) as string[]).join(', '), viewport: e.viewport })),
      rtm: rtm.filter((r) => r.sourceKind !== 'Header' && r.sourceKind !== 'TableRow').map((r) => ({ reqId: r.reqId, text: r.text, testCaseIds: r.testCaseIds, executionStatus: r.executionStatus, defectIds: r.defectIds, coverageStatus: r.coverageStatus })),
      deliverables: [
        { name: 'Requirement Traceability Matrix', where: 'Requirements & RTM → Export' },
        { name: 'Clarification Log', where: 'Test Artefacts → Clarification Log → Export' },
        { name: 'Test Scenarios and Test Cases', where: 'Test Artefacts → Export' },
        { name: 'Test Data Sheet', where: 'Test Artefacts → Test Data → Export' },
        ...docs.map((d) => ({ name: `${d.type === 'TestPlan' ? 'Test Plan' : 'Test Techniques Document'} v${d.version}`, where: 'Test Artefacts → Export' })),
        ...(scripts ? [{ name: `Automation scripts (${scripts} files)`, where: 'Test Execution → Scripts' }] : []),
        { name: 'Defect Report and defect list', where: 'Reports / Defects → Export' },
        { name: 'Daily and Weekly Status Reports', where: 'Reports & Dashboard' },
      ],
    };
  }

  /** One risk row per open defect (drafts and deferred included); existing edits are kept by defect. */
  private async riskRows(projectId: string, previous: RiskRow[]): Promise<RiskRow[]> {
    const defects = await this.prisma.defect.findMany({ where: { projectId }, orderBy: { defectId: 'asc' } });
    const prev = new Map(previous.map((r) => [r.id, r]));
    return defects.filter(openAtClosure).map((d) => {
      const p = prev.get(d.id);
      const impact: Level = p?.businessImpact ?? (d.severity === 'Blocker' || d.severity === 'Critical' ? 'High' : d.severity === 'Major' ? 'Medium' : 'Low');
      const likelihood: Level = p?.likelihood ?? (d.priority === 'P1' ? 'High' : d.priority === 'P4' ? 'Low' : 'Medium');
      return {
        id: d.id, defectId: d.defectId, title: d.title, severity: d.severity, priority: d.priority, status: d.status, isDraft: d.isDraft, module: d.module,
        businessImpact: impact, likelihood, riskLevel: riskLevel(impact, likelihood),
        impactDescription: p?.impactDescription ?? (d.module ? `Users of ${d.module} may be affected: ${d.actualResult?.split('\n')[0]?.slice(0, 160) ?? d.title}` : d.title),
        workaround: p?.workaround ?? '', mitigation: p?.mitigation ?? (impact === 'High' ? 'Fix before go-live or hot-fix within the first release week; monitor in production' : 'Schedule the fix for the next release'),
        owner: p?.owner ?? d.assignedTo ?? 'QA Lead',
      };
    });
  }

  /** Exit criteria from the Test Plan, evaluated against the data. */
  private exitCriteria(d: Snapshot, risks: RiskRow[], previous: ExitCriterion[]): ExitCriterion[] {
    const e = d.execution;
    const openCritical = risks.filter(highImpact).length;
    const rtmGaps = (d.rtm['No Tests'] ?? 0) + (d.rtm['Not Run'] ?? 0);
    const c = (key: string, criterion: string, met: boolean, actual: string): ExitCriterion => ({ key, criterion, met, actual, comment: previous.find((p) => p.key === key)?.comment ?? '' });
    return [
      c('executed', '100% of planned test cases executed', e.notRun === 0 && e.totalTcs > 0, `${e.executed} of ${e.totalTcs} executed (${e.executionPct}%)`),
      c('passRate', 'Pass rate ≥ 95%', e.passPct >= 95, `${e.passPct}%`),
      c('noCritical', 'No open Blocker or Critical defects; all P1 defects closed', openCritical === 0, openCritical ? `${openCritical} open: ${risks.filter(highImpact).map((r) => r.defectId).join(', ')}` : 'None open'),
      c('riskAssessed', 'Every remaining open defect has an agreed risk assessment and workaround', risks.every((r) => r.workaround.trim().length > 0), risks.length ? `${risks.filter((r) => r.workaround.trim()).length} of ${risks.length} have a workaround` : 'No open defects'),
      c('rtm', 'Every requirement covered and executed (RTM)', d.coverage.unmapped === 0 && rtmGaps === 0, `Coverage ${d.coverage.percent}%, ${rtmGaps} requirement item(s) without executed tests`),
      c('questions', 'All clarification questions answered', d.openQuestions.length === 0, `${d.openQuestions.length} open`),
    ];
  }

  private suggest(trigger: Trigger, d: Snapshot, risks: RiskRow[], exit: ExitCriterion[]) {
    const blockers = risks.filter((r) => r.severity === 'Blocker');
    const highNoWorkaround = risks.filter((r) => r.riskLevel === 'High' && !r.workaround.trim());
    const unmet = exit.filter((x) => !x.met);
    if (blockers.length || highNoWorkaround.length) {
      return {
        decision: 'NoGo' as const,
        reason: [blockers.length ? `${blockers.length} open Blocker defect(s): ${blockers.map((r) => r.defectId).join(', ')}` : '', highNoWorkaround.length ? `${highNoWorkaround.length} High-risk defect(s) without a workaround: ${highNoWorkaround.map((r) => r.defectId).join(', ')}` : ''].filter(Boolean).join('; '),
        conditions: 'Re-assess once the listed defects are fixed or have an agreed workaround.',
      };
    }
    if (risks.length || unmet.length) {
      return {
        decision: 'ConditionalGo' as const,
        reason: [risks.length ? `${risks.length} defect(s) remain open with an accepted risk` : '', unmet.length ? `Exit criteria not met: ${unmet.map((x) => x.criterion).join('; ')}` : '', trigger === 'ClientRequest' ? 'Closure requested by the client' : ''].filter(Boolean).join('. '),
        conditions: bullet([...risks.map((r) => `${r.defectId}: ${r.mitigation} (owner ${r.owner})`), ...unmet.map((x) => `Close the gap: ${x.criterion}`)]),
      };
    }
    void d;
    return { decision: 'Go' as const, reason: 'All exit criteria are met and no defects remain open.', conditions: '' };
  }

  // ───────────────────────────── Read / edit ─────────────────────────────

  async list(projectId: string) {
    return this.prisma.report.findMany({ where: { projectId, type: 'Closure' }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, status: true, createdAt: true, updatedAt: true } });
  }

  private async load(projectId: string, id: string) {
    const r = await this.prisma.report.findFirst({ where: { id, projectId, type: 'Closure' } });
    if (!r) throw new NotFoundException('Closure report not found');
    return { r, c: JSON.parse(r.content) as ClosureContent };
  }

  async get(projectId: string, id: string) {
    const { r, c } = await this.load(projectId, id);
    return { ...r, content: c, charts: this.charts(c.data), fields: { header: HEADER_FIELDS, narrative: NARRATIVE_FIELDS }, triggerLabel: TRIGGER_LABEL[c.trigger] };
  }

  async update(projectId: string, id: string, dto: { header?: Record<string, string>; narrative?: Record<string, string>; risks?: Partial<RiskRow>[]; recommendation?: { decision?: string; reason?: string; conditions?: string }; exitComments?: Record<string, string> }, user: AuthUser) {
    const { r, c } = await this.load(projectId, id);
    if (r.status !== 'Draft') throw new BadRequestException('Only a draft closure report can be edited');
    const hk = new Set(HEADER_FIELDS.map(([k]) => k)), nk = new Set(NARRATIVE_FIELDS.map(([k]) => k));
    for (const [k, v] of Object.entries(dto.header ?? {})) { if (!hk.has(k)) throw new BadRequestException(`Unknown field ${k}`); c.header[k] = String(v).slice(0, 500); }
    for (const [k, v] of Object.entries(dto.narrative ?? {})) { if (!nk.has(k)) throw new BadRequestException(`Unknown field ${k}`); c.narrative[k] = String(v).slice(0, 20000); }
    for (const upd of dto.risks ?? []) {
      const row = c.risks.find((x) => x.id === upd.id);
      if (!row) throw new BadRequestException('Unknown defect in risk assessment');
      for (const k of ['businessImpact', 'likelihood'] as const) if (upd[k] !== undefined) { if (!LEVELS.includes(upd[k] as Level)) throw new BadRequestException(`${k} must be High, Medium or Low`); row[k] = upd[k] as Level; }
      for (const k of ['impactDescription', 'workaround', 'mitigation', 'owner'] as const) if (upd[k] !== undefined) row[k] = String(upd[k]).slice(0, 2000);
      row.riskLevel = riskLevel(row.businessImpact, row.likelihood);
    }
    for (const [k, v] of Object.entries(dto.exitComments ?? {})) { const x = c.exitCriteria.find((e) => e.key === k); if (!x) throw new BadRequestException(`Unknown criterion ${k}`); x.comment = String(v).slice(0, 2000); }
    // Workarounds affect the "risk assessed" criterion and the suggestion.
    c.exitCriteria = this.exitCriteria(c.data, c.risks, c.exitCriteria);
    const s = this.suggest(c.trigger, c.data, c.risks, c.exitCriteria);
    c.recommendation.suggested = s.decision;
    if (dto.recommendation) {
      if (dto.recommendation.decision !== undefined) { if (!(DECISIONS as readonly string[]).includes(dto.recommendation.decision)) throw new BadRequestException('Decision must be Go, ConditionalGo or NoGo'); c.recommendation.decision = dto.recommendation.decision as ClosureContent['recommendation']['decision']; }
      if (dto.recommendation.reason !== undefined) c.recommendation.reason = String(dto.recommendation.reason).slice(0, 5000);
      if (dto.recommendation.conditions !== undefined) c.recommendation.conditions = String(dto.recommendation.conditions).slice(0, 5000);
    }
    if (c.recommendation.decision === 'Go' && c.risks.some((x) => x.riskLevel === 'High')) throw new BadRequestException('A GO recommendation is not allowed while High-risk defects are open - use Conditional Go or No-Go');
    await this.prisma.report.update({ where: { id }, data: { content: JSON.stringify(c) } });
    await this.audit.log({ userId: user.id, projectId, action: 'UPDATE', entityType: 'ClosureReport', entityId: id, after: dto });
    return this.get(projectId, id);
  }

  /** Re-pull data; risk rows keep their edits, closed defects drop out, new open ones are added. */
  async refresh(projectId: string, id: string, user: AuthUser) {
    const { r, c } = await this.load(projectId, id);
    if (r.status !== 'Draft') throw new BadRequestException('Only a draft can be refreshed');
    c.data = await this.metrics.snapshot(projectId, c.data.period.from, await this.metrics.today(projectId));
    c.header.periodTo = c.data.period.to;
    c.extra = await this.extra(projectId);
    c.risks = await this.riskRows(projectId, c.risks);
    c.exitCriteria = this.exitCriteria(c.data, c.risks, c.exitCriteria);
    c.recommendation.suggested = this.suggest(c.trigger, c.data, c.risks, c.exitCriteria).decision;
    c.refreshedAt = new Date().toISOString();
    await this.prisma.report.update({ where: { id }, data: { content: JSON.stringify(c) } });
    await this.audit.log({ userId: user.id, projectId, action: 'REFRESH', entityType: 'ClosureReport', entityId: id });
    return this.get(projectId, id);
  }

  async setStatus(projectId: string, id: string, status: 'Draft' | 'Final', user: AuthUser) {
    const { r, c } = await this.load(projectId, id);
    const ok: Record<string, string[]> = { Draft: ['Final'], Final: ['Draft'], SignedOff: [] };
    if (!ok[r.status]?.includes(status)) throw new BadRequestException(`Cannot change a ${r.status} report to ${status}`);
    if (status === 'Final') {
      const missing = c.risks.filter((x) => !x.workaround.trim() || !x.owner.trim());
      if (missing.length) throw new BadRequestException(`Complete the risk assessment first (workaround and owner): ${missing.map((x) => x.defectId).join(', ')}`);
      if (!c.recommendation.reason.trim()) throw new BadRequestException('Give the reason for the recommendation');
    }
    if (status === 'Draft') c.signOff = c.signOff.map((s) => ({ ...s, signedAt: null, signedBy: null, decision: '', name: s.name })); // edits void earlier signatures
    await this.prisma.report.update({ where: { id }, data: { status, content: JSON.stringify(c) } });
    await this.audit.log({ userId: user.id, projectId, action: 'STATUS', entityType: 'ClosureReport', entityId: id, before: { status: r.status }, after: { status } });
    return this.get(projectId, id);
  }

  /** Sign-off on a FINAL report. QA Lead/Admin record any role; a Client user signs the Client section for themselves. */
  async sign(projectId: string, id: string, dto: { role: SignOff['role']; name?: string; decision: string; comment?: string }, user: AuthUser) {
    const { r, c } = await this.load(projectId, id);
    if (r.status !== 'Final') throw new BadRequestException('Sign-off is only possible on a final report');
    const role = user.projectRole ?? user.role;
    const canRecord = roleHas(role, 'closure.trigger');
    if (!canRecord && !(role === 'Client' && dto.role === 'Client')) throw new ForbiddenException('You cannot sign this section');
    if (!['Approved', 'ApprovedWithConditions', 'Rejected'].includes(dto.decision)) throw new BadRequestException('Decision must be Approved, ApprovedWithConditions or Rejected');
    const slot = c.signOff.find((s) => s.role === dto.role);
    if (!slot) throw new BadRequestException('Unknown sign-off role');
    if (slot.signedAt) throw new BadRequestException(`The ${dto.role} section is already signed`);
    const name = (role === 'Client' && !canRecord ? user.name : dto.name?.trim() || user.name).slice(0, 200);
    Object.assign(slot, { name, decision: dto.decision, comment: (dto.comment ?? '').slice(0, 2000), signedAt: new Date().toISOString(), signedBy: user.id });
    const all = c.signOff.every((s) => s.signedAt);
    await this.prisma.report.update({ where: { id }, data: { content: JSON.stringify(c), status: all ? 'SignedOff' : r.status } });
    if (all && !c.signOff.some((s) => s.decision === 'Rejected')) await this.prisma.project.update({ where: { id: projectId }, data: { status: 'Closed', endDate: new Date() } });
    await this.audit.log({ userId: user.id, projectId, action: 'SIGN', entityType: 'ClosureReport', entityId: id, after: { role: dto.role, name, decision: dto.decision } });
    return this.get(projectId, id);
  }

  async remove(projectId: string, id: string, user: AuthUser) {
    const { r } = await this.load(projectId, id);
    if (r.status !== 'Draft') throw new BadRequestException('Only drafts can be deleted');
    await this.prisma.report.delete({ where: { id } });
    await this.audit.log({ userId: user.id, projectId, action: 'DELETE', entityType: 'ClosureReport', entityId: id });
    return { ok: true };
  }

  // ───────────────────────────── Charts & export ─────────────────────────────

  charts(d: Snapshot) {
    const e = d.execution;
    return {
      exec: stackedBar('Final test case status', [
        { label: 'Pass', value: e.passed, color: C.status.Pass }, { label: 'Fail', value: e.failed, color: C.status.Fail }, { label: 'Blocked', value: e.blocked, color: C.status.Blocked },
        { label: 'Skipped', value: e.skipped, color: C.status.Skipped }, { label: 'Not run', value: e.notRun, color: C.status['Not run'] },
      ]),
      sev: hbars('Open defects by severity at closure', SEVERITIES.map((s, i) => ({ label: s, value: d.defects.bySeverity[s] ?? 0, color: C.ramp[i] }))),
    };
  }

  async exportDoc(projectId: string, id: string): Promise<ExportDoc> {
    const r = await this.get(projectId, id);
    const c = r.content, d = c.data, e = d.execution, df = d.defects, n = c.narrative;
    const text = (heading: string, v: string | undefined, level?: 2): ExportSection => ({ heading, level, paragraphs: (v || '—').split('\n').filter((l) => l.trim()).map((l) => (l.startsWith('- ') ? `• ${l.slice(2)}` : l)) });
    const images: ExportImage[] = [];
    for (const svg of Object.values(r.charts)) {
      const w = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 640), h = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 260);
      images.push({ caption: /<title>([^<]*)<\/title>/.exec(svg)?.[1] ?? 'Chart', data: await renderPng(`<!doctype html><html><body style="margin:0">${svg}</body></html>`, w, h, 2), mimeType: 'image/png' });
    }
    const early = c.risks.length > 0;
    const banner = [
      `Recommendation: ${DECISION_LABEL[c.recommendation.decision]}`,
      early ? `${c.risks.length} defect(s) remain OPEN – see the risk assessment (${c.risks.filter((x) => x.riskLevel === 'High').length} High risk)` : 'No open defects',
      c.trigger === 'ClientRequest' ? 'Closed on client request' : '',
      r.status === 'Draft' ? 'DRAFT' : '',
    ].filter(Boolean).join(' · ');
    const sections: ExportSection[] = [
      { heading: 'Recommendation', paragraphs: [`${DECISION_LABEL[c.recommendation.decision]}${c.recommendation.decision !== c.recommendation.suggested ? ` (QA Pilot suggested ${DECISION_LABEL[c.recommendation.suggested]})` : ''}`, c.recommendation.reason, ...(c.recommendation.conditions ? ['Conditions:', ...c.recommendation.conditions.split('\n').map((l) => (l.startsWith('- ') ? `• ${l.slice(2)}` : l))] : [])] },
      ...(early ? [{
        heading: `Open defects & risk assessment (${c.risks.length})`,
        paragraphs: ['These defects are open at closure. Each one carries the business risk below until it is fixed.'],
        table: {
          sheetName: 'Risk assessment',
          columns: [
            { header: 'Defect ID', key: 'defectId', width: 10 }, { header: 'Title', key: 'title', width: 32 }, { header: 'Severity', key: 'severity', width: 9 }, { header: 'Priority', key: 'priority', width: 8 },
            { header: 'Status', key: 'statusLabel', width: 11 }, { header: 'Business impact', key: 'impact', width: 28 }, { header: 'Likelihood', key: 'likelihood', width: 9 }, { header: 'Risk level', key: 'riskLevel', width: 9 },
            { header: 'Workaround', key: 'workaround', width: 25 }, { header: 'Mitigation / recommendation', key: 'mitigation', width: 28 }, { header: 'Owner', key: 'owner', width: 12 },
          ],
          rows: c.risks.map((x) => ({ ...x, statusLabel: x.isDraft ? 'Draft (unreviewed)' : STATUS_LABEL[x.status] ?? x.status, impact: `${x.businessImpact}: ${x.impactDescription}` })),
          highlight: (row: Record<string, unknown>) => (row.riskLevel === 'High' ? 'red' as const : row.riskLevel === 'Medium' ? 'amber' as const : undefined),
        },
      }] : [{ heading: 'Open defects & risk assessment', paragraphs: ['No defects are open at closure.'] }]),
      { heading: 'Test objectives & scope' }, text('Objectives', n.objectives, 2), text('In scope', n.scopeIn, 2), text('Out of scope', n.scopeOut, 2),
      { heading: 'Test summary', keyValues: [['Planned (designed) test cases', String(e.totalTcs)], ['Executed', `${e.executed} (${e.executionPct}%)`], ['Passed', String(e.passed)], ['Failed', String(e.failed)], ['Blocked', String(e.blocked)], ['Skipped', String(e.skipped)], ['Not run', String(e.notRun)], ['Pass rate', `${e.passPct}%`], ['Automated test cases', String(d.design.automated)]], images: images.slice(0, 1) },
      { heading: `Requirement coverage & final RTM (coverage ${d.coverage.percent}%)`, table: { sheetName: 'Final RTM', columns: [{ header: 'Requirement', key: 'reqId', width: 14 }, { header: 'Text', key: 'text', width: 50 }, { header: 'Test cases', key: 'testCaseIds', width: 18 }, { header: 'Execution', key: 'executionStatus', width: 11 }, { header: 'Defects', key: 'defectIds', width: 14 }, { header: 'Coverage', key: 'coverageStatus', width: 12 }], rows: c.extra.rtm, highlight: (row: Record<string, unknown>) => (row.executionStatus === 'Fail' ? 'red' as const : ['No Tests', 'Not Run'].includes(String(row.executionStatus)) ? 'amber' as const : undefined) } },
      { heading: 'Test types and techniques performed', keyValues: [...c.extra.typesPerformed.map((t) => [`Type: ${t.testType}`, `${t.count} test case(s)`] as [string, string]), ...c.extra.techniquesPerformed.map((t) => [`Technique: ${t.technique}`, `${t.count} test case(s)`] as [string, string])] },
      { heading: 'Environment details', table: { columns: [{ header: 'Name', key: 'name', width: 12 }, { header: 'Type', key: 'envType', width: 9 }, { header: 'URL', key: 'baseUrl', width: 35 }, { header: 'Browsers', key: 'browsers', width: 20 }, { header: 'Viewport', key: 'viewport', width: 11 }], rows: c.extra.environments } },
      { heading: 'Defect summary', keyValues: [['Total defects', String(df.total)], ['Open at closure', String(c.risks.length)], ['Reopen rate', `${df.reopenRate}%`], ['Rejection rate', `${df.rejectionRate}%`], ...SEVERITIES.map((s) => [`Open ${s}`, String(df.bySeverity[s] ?? 0)] as [string, string]), ...PRIORITIES.map((p) => [`Open ${p}`, String(df.byPriority[p] ?? 0)] as [string, string]), ...Object.entries(df.byStatus).map(([k, v]) => [`Status ${STATUS_LABEL[k] ?? k}`, String(v)] as [string, string]), ...d.moduleDensity.map((m) => [`Density ${m.module}`, `${m.defects} defects / ${m.testCases} test cases = ${m.density}`] as [string, string])], images: images.slice(1) },
      text('Deviations from the test plan', n.deviations),
      { heading: 'Exit criteria check', table: { sheetName: 'Exit criteria', columns: [{ header: 'Criterion', key: 'criterion', width: 45 }, { header: 'Met', key: 'metLabel', width: 9 }, { header: 'Actual', key: 'actual', width: 35 }, { header: 'Comment', key: 'comment', width: 30 }], rows: c.exitCriteria.map((x) => ({ ...x, metLabel: x.met ? 'MET' : 'NOT MET' })), highlight: (row: Record<string, unknown>) => (row.met ? 'green' as const : 'red' as const) } },
      text('Lessons learned', n.lessonsLearned), text('Best practices', n.bestPractices), text('Recommendations', n.recommendations), text('Known issues / limitations', n.knownIssues),
      { heading: 'Deliverables', table: { columns: [{ header: 'Deliverable', key: 'name', width: 40 }, { header: 'Where', key: 'where', width: 40 }], rows: c.extra.deliverables } },
      { heading: 'Sign-off', table: { sheetName: 'Sign-off', columns: [{ header: 'Role', key: 'roleLabel', width: 12 }, { header: 'Name', key: 'name', width: 20 }, { header: 'Decision', key: 'decision', width: 22 }, { header: 'Date', key: 'date', width: 18 }, { header: 'Comment', key: 'comment', width: 35 }], rows: c.signOff.map((s) => ({ ...s, roleLabel: { QALead: 'QA Lead', PM: 'Project Manager', Client: 'Client' }[s.role], date: s.signedAt ? s.signedAt.slice(0, 16).replace('T', ' ') : '____________', name: s.name || '____________', decision: s.decision || '____________' })) } },
    ];
    return {
      title: 'Test Closure Report', subtitle: `${c.header.projectName}${c.header.client ? ` · ${c.header.client}` : ''}`,
      banner,
      meta: [...HEADER_FIELDS.map(([k, label]) => [label, c.header[k] || '—'] as [string, string]), ['Status', r.status], ['Closure trigger', TRIGGER_LABEL[c.trigger]], ...(c.triggerReason ? [['Client request reason', c.triggerReason] as [string, string]] : [])],
      sections,
    };
  }

  async eml(projectId: string, id: string) {
    const r = await this.get(projectId, id);
    const c = r.content;
    const pdf = await this.exporter.render(await this.exportDoc(projectId, id), 'pdf');
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px">
<h2>Test Closure Report – ${esc(c.header.projectName)}${c.header.release ? ` ${esc(c.header.release)}` : ''}</h2>
<p style="font-size:18px"><b>Recommendation: ${DECISION_LABEL[c.recommendation.decision]}</b></p><p>${esc(c.recommendation.reason)}</p>
${c.risks.length ? `<h3 style="color:#b91c1c">${c.risks.length} defect(s) remain open</h3><ul>${c.risks.map((x) => `<li${x.riskLevel === 'High' ? ' style="color:#b91c1c;font-weight:bold"' : ''}>${esc(x.defectId)} ${esc(x.title)} – ${x.severity}/${x.priority}, risk ${x.riskLevel}, workaround: ${esc(x.workaround || 'none')}, owner ${esc(x.owner)}</li>`).join('')}</ul>` : '<p>No defects remain open.</p>'}
<p>The full report, including the risk assessment, exit criteria and sign-off section, is attached.</p></body></html>`;
    const b64 = (buf: Buffer) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
    const name = `Test-Closure-Report-${c.header.reportDate}`;
    const boundary = `qapilot-${id}`;
    const subject = `Test Closure Report – ${c.header.projectName} – ${DECISION_LABEL[c.recommendation.decision]}`;
    const eml = ['X-Unsent: 1', 'To: ', `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(Buffer.from(html)), '',
      `--${boundary}`, `Content-Type: application/pdf; name="${name}.pdf"`, `Content-Disposition: attachment; filename="${name}.pdf"`, 'Content-Transfer-Encoding: base64', '', b64(pdf.data), '', `--${boundary}--`, ''].join('\r\n');
    return { data: Buffer.from(eml), fileName: `${name}.eml` };
  }
}
