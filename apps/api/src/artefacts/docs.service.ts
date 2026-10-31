import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { ExportDoc, ExportSection } from '../common/export/model';
import { TECHNIQUES, TEST_TYPES } from '../common/enums';
import { backToReview } from './review.service';

export type DocType = 'TestPlan' | 'TestTechniques';
export interface DocSection { key: string; heading: string; body: string }
export interface DocContent { sections: DocSection[] }

const TECHNIQUE_INFO: Record<string, { family: string; label: string; what: string }> = {
  EquivalencePartitioning: { family: 'Black-box', label: 'Equivalence Partitioning', what: 'Divides inputs into classes expected to behave the same; one value per valid and invalid class is tested.' },
  BoundaryValueAnalysis: { family: 'Black-box', label: 'Boundary Value Analysis', what: 'Tests the edges of ordered partitions: min-1, min, min+1, max-1, max, max+1.' },
  DecisionTable: { family: 'Black-box', label: 'Decision Table', what: 'Lists combinations of conditions and the resulting actions; each column (rule) becomes a test.' },
  StateTransition: { family: 'Black-box', label: 'State Transition', what: 'Models states, events and transitions (e.g. Active → Locked); tests valid and invalid transitions.' },
  UseCase: { family: 'Black-box', label: 'Use Case / User Story testing', what: 'Exercises the main success scenario and alternative flows of a use case or user story.' },
  CauseEffectGraphing: { family: 'Black-box', label: 'Cause-Effect Graphing', what: 'Maps causes (inputs) to effects (outputs) with Boolean logic, then derives a decision table.' },
  Pairwise: { family: 'Black-box', label: 'Pairwise / Orthogonal Array', what: 'Covers every pair of parameter values with a minimal set of combinations (e.g. browser × OS × device).' },
  ClassificationTree: { family: 'Black-box', label: 'Classification Tree', what: 'Breaks the input domain into classifications and classes in a tree, then combines leaves into test cases.' },
  ErrorGuessing: { family: 'Experience-based', label: 'Error Guessing', what: 'Uses experience of typical failures (empty input, double submit, timeouts, injection) to target likely defects.' },
  Exploratory: { family: 'Experience-based', label: 'Exploratory testing (charters)', what: 'Simultaneous learning, design and execution within a time-boxed charter with a stated mission.' },
  ChecklistBased: { family: 'Experience-based', label: 'Checklist-based', what: 'Uses a list of conditions to verify (UI standards, WCAG, OWASP, localization) to guide testing.' },
  StatementCoverage: { family: 'White-box', label: 'Statement coverage', what: 'Every executable statement is exercised at least once (requires code access).' },
  BranchCoverage: { family: 'White-box', label: 'Branch coverage', what: 'Every decision outcome (true/false) is exercised at least once (requires code access).' },
  PathCoverage: { family: 'White-box', label: 'Path coverage', what: 'Every independent path through a component is exercised (requires code access).' },
};

const TYPE_INFO: Record<string, string> = {
  Smoke: 'Build verification of critical paths', Sanity: 'Narrow check after a fix or small change', Functional: 'Behaviour against functional requirements',
  Integration: 'Interfaces between components/systems', System: 'Whole system against requirements', EndToEnd: 'Complete business flows across modules',
  Regression: 'Re-running tests after changes', Retest: 'Confirming a fixed defect', UAT: 'Acceptance by the client/business users', API: 'Service contracts and responses',
  Database: 'Stored data, integrity and queries', UI: 'Screens, controls and layout', Usability: 'Ease of use with representative users',
  Accessibility: 'WCAG 2.2 AA conformance', Compatibility: 'Browsers, OS and devices', Responsive: 'Layouts across screen widths', Performance: 'Response times',
  Load: 'Behaviour at expected volume', Stress: 'Behaviour beyond capacity and recovery', Security: 'OWASP Top 10, authentication, roles/permissions, session',
  Localization: 'Languages, locales, formats', DataMigration: 'Correctness of migrated data', Negative: 'Invalid inputs and misuse', CRUD: 'Create, read, update, delete operations',
};

@Injectable()
export class DocsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(projectId: string, type: DocType) {
    const a = await this.prisma.artefact.findFirst({ where: { projectId, type }, orderBy: { version: 'desc' } });
    if (!a) return null;
    return { ...a, content: JSON.parse(a.content) as DocContent };
  }

  /** (Re)build from current project data. A new version replaces the old one and goes back to review. */
  async generate(projectId: string, type: DocType, user: AuthUser) {
    const content = type === 'TestPlan' ? await this.buildPlan(projectId) : await this.buildTechniques(projectId);
    const existing = await this.prisma.artefact.findFirst({ where: { projectId, type }, orderBy: { version: 'desc' } });
    const title = type === 'TestPlan' ? 'Test Plan' : 'Test Techniques Document';
    const row = existing
      ? await this.prisma.artefact.update({ where: { id: existing.id }, data: { content: JSON.stringify(content), version: existing.version + 1, aiGenerated: true, ...backToReview } })
      : await this.prisma.artefact.create({ data: { projectId, type, title, content: JSON.stringify(content), aiGenerated: true } });
    await this.audit.log({ userId: user.id, projectId, action: 'GENERATE', entityType: 'Artefact', entityId: row.id, after: { type, version: row.version } });
    return { ...row, content };
  }

  async updateSection(projectId: string, type: DocType, key: string, body: string, user: AuthUser) {
    const a = await this.prisma.artefact.findFirst({ where: { projectId, type }, orderBy: { version: 'desc' } });
    if (!a) throw new NotFoundException('Generate the document first');
    const content = JSON.parse(a.content) as DocContent;
    const s = content.sections.find((x) => x.key === key);
    if (!s) throw new BadRequestException('Unknown section');
    const before = s.body;
    s.body = body;
    const row = await this.prisma.artefact.update({ where: { id: a.id }, data: { content: JSON.stringify(content), ...backToReview } });
    await this.audit.log({ userId: user.id, projectId, action: 'UPDATE', entityType: 'Artefact', entityId: a.id, before: { section: key, body: before }, after: { section: key, body } });
    return { ...row, content };
  }

  async exportDoc(projectId: string, type: DocType): Promise<ExportDoc> {
    const a = await this.get(projectId, type);
    if (!a) throw new NotFoundException('Generate the document first');
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    return {
      title: `${a.title} – ${p.name}`, subtitle: p.client ?? undefined,
      banner: a.aiGenerated && a.reviewStatus !== 'Approved' ? 'AI-generated – pending review' : undefined,
      meta: [['Project', `${p.key} – ${p.name}`], ['Document version', String(a.version)], ['Review status', a.reviewStatus], ['Last updated', a.updatedAt.toISOString().slice(0, 10)]],
      sections: a.content.sections.map(toExportSection),
    };
  }

  // ───────────────────────────── Builders ─────────────────────────────

  private async buildTechniques(projectId: string): Promise<DocContent> {
    const tcs = await this.prisma.testCase.findMany({ where: { projectId }, select: { tcId: true, technique: true, testType: true }, orderBy: { tcId: 'asc' } });
    const list = (ids: string[]) => (ids.length ? ids.join(', ') : 'Not used in this project yet.');
    const sections: DocSection[] = [{
      key: 'intro', heading: 'Purpose',
      body: `This document explains each test design technique and test type, how it was applied in this project and which test cases use it. ${tcs.length} test cases are currently designed.`,
    }];
    for (const fam of ['Black-box', 'Experience-based', 'White-box']) {
      for (const t of TECHNIQUES.filter((x) => TECHNIQUE_INFO[x].family === fam)) {
        const info = TECHNIQUE_INFO[t];
        const ids = tcs.filter((c) => c.technique === t).map((c) => c.tcId);
        const note = fam === 'White-box' ? '\nApplicability: white-box techniques require access to source code or API internals and are applied by developers/unit tests when that access exists.' : '';
        sections.push({ key: `tech-${t}`, heading: `${fam}: ${info.label}`, body: `${info.what}${note}\nTest cases (${ids.length}): ${list(ids)}` });
      }
    }
    sections.push({
      key: 'types', heading: 'Test types',
      body: TEST_TYPES.map((ty) => { const ids = tcs.filter((c) => c.testType === ty).map((c) => c.tcId); return `- ${ty} – ${TYPE_INFO[ty]}: ${ids.length ? ids.join(', ') : 'none yet'}`; }).join('\n'),
    });
    return { sections };
  }

  private async buildPlan(projectId: string): Promise<DocContent> {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { members: { include: { user: { select: { name: true } } } } } });
    const [items, tcs, openQs, envs, docs] = await Promise.all([
      this.prisma.requirementItem.findMany({ where: { projectId, isCurrent: true }, select: { reqId: true, text: true, category: true, sectionTitle: true, ambiguousTerms: true, coverageStatus: true } }),
      this.prisma.testCase.findMany({ where: { projectId }, select: { module: true, testType: true, technique: true, priority: true, automationCandidate: true } }),
      this.prisma.clarificationQuestion.count({ where: { projectId, status: 'Open' } }),
      this.prisma.testEnvironment.findMany({ where: { projectId } }),
      this.prisma.requirementDocument.findMany({ where: { projectId }, include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, fileName: true } } } }),
    ]);
    const modules = [...new Set(tcs.map((t) => t.module))];
    const types = [...new Set(tcs.map((t) => t.testType))];
    const techniques = [...new Set(tcs.map((t) => t.technique))].map((t) => TECHNIQUE_INFO[t]?.label ?? t);
    const outOfScope = items.filter((i) => i.category === 'OutOfScope');
    const assumptions = items.filter((i) => i.category === 'Assumption');
    const ambiguous = items.filter((i) => i.ambiguousTerms).length;
    const nfr = [...new Set(items.filter((i) => i.category === 'NonFunctional').map((i) => i.text))].length;
    const roles = (r: string) => p.members.filter((m) => m.role === r).map((m) => m.user.name).join(', ') || 'TBD';
    const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'TBD');
    const bullets = (xs: string[], empty = 'None identified.') => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : empty);

    const S = (key: string, heading: string, body: string): DocSection => ({ key, heading, body });
    return {
      sections: [
        S('control', 'Document control & version history', `Document: Test Plan for ${p.name}\nClient: ${p.client ?? 'TBD'}\nPrepared by: ${roles('QALead')}\n- v1 – generated by QA Pilot from the requirement baseline (pending review)`),
        S('intro', 'Introduction & objectives', `This plan defines the approach, resources and schedule for testing ${p.name}.\nObjectives:\n- Verify every requirement in the baseline (${items.length} atomic items) is implemented as specified\n- Find and report defects early with clear evidence\n- Provide objective data for the Go / No-Go decision`),
        S('scope', 'Scope (in scope / out of scope)', `In scope:\n${bullets(modules.map((m) => `${m}`), '- All modules in the requirement baseline')}\nOut of scope:\n${bullets(outOfScope.map((i) => `${i.reqId}: ${i.text}`))}`),
        S('items', 'Test items & features to be tested', `Requirement documents:\n${bullets(docs.map((d) => `${d.docKey} ${d.title} (v${d.versions[0]?.version ?? 1}, ${d.versions[0]?.fileName ?? ''})`))}\nFeatures (modules): ${modules.join(', ') || 'TBD'}\nNon-functional requirements: ${nfr}`),
        S('notTested', 'Features not to be tested', bullets(outOfScope.map((i) => `${i.reqId}: ${i.text} – excluded by the requirement document`), 'None beyond the out-of-scope list.')),
        S('approach', 'Test approach & strategy', `Risk-based approach: High-priority requirements (business rules, security, mandatory validations) are designed and executed first.\n- Requirements are split into atomic items and traced through the RTM to scenarios, test cases, executions and defects\n- Automation (Playwright, Page Object Model, data-driven) for ${tcs.filter((t) => t.automationCandidate).length} of ${tcs.length} test cases; the remainder executed manually with guided execution\n- Smoke suite on every build; full regression before each release`),
        S('levels', 'Test levels & types', `Levels: System testing, System integration testing, User acceptance testing (with the client).\nTest types: ${types.join(', ') || 'TBD'}`),
        S('techniques', 'Test techniques', `${techniques.join(', ') || 'TBD'}. See the Test Techniques Document for details and the test cases using each technique.`),
        S('entry', 'Entry criteria', bullets(['Requirement baseline approved; coverage 100% or gaps acknowledged by the QA Lead', 'Test cases reviewed and approved', 'Test environment and test data available; smoke test passed', `Open High-priority clarification questions answered (currently ${openQs} open questions)`])),
        S('exit', 'Exit criteria', bullets(['100% of planned test cases executed', '≥ 95% pass rate', 'No open Blocker or Critical defects; P1 defects closed', 'All remaining open defects have an agreed risk assessment and workaround', 'RTM shows every requirement covered and executed'])),
        S('suspension', 'Suspension & resumption criteria', `Suspend when: a Blocker defect stops a core flow; the environment is unavailable for more than 4 hours; more than 30% of smoke tests fail on a build.\nResume when: the blocker is fixed and verified, the environment is restored and the smoke suite passes.`),
        S('environment', 'Test environment', envs.length ? envs.map((e) => `- ${e.name}: ${e.baseUrl} (browsers ${e.browsers}, workers ${e.workers})`).join('\n') : `- QA: URL TBD\n- UAT: URL TBD\n- Browsers: Chrome, Firefox, Safari, Edge (latest)\n- Devices: desktop 1366×768, tablet 768×1024, mobile 360×800\n- Test accounts: one per role (see Test Data Sheet); passwords kept in encrypted environment credentials`),
        S('data', 'Test data strategy', 'Synthetic data only (example.com e-mails, fictional 555-01xx phone numbers, public test card numbers). Boundary, invalid, special-character and empty values are kept in the Test Data Sheet and drive the automated tests. Production data is never copied into test environments.'),
        S('raci', 'Roles & responsibilities (RACI)', `- QA Lead (${roles('QALead')}): plan, review/approve artefacts, acknowledge coverage gaps, report – Accountable\n- Testers (${roles('Tester')}): design and execute tests, log defects – Responsible\n- Developers (${roles('Developer')}): fix defects, support root-cause analysis – Consulted\n- Client (${roles('Client')}): answer clarifications, UAT, sign-off – Informed / Approver`),
        S('schedule', 'Schedule & milestones', `Project start: ${date(p.startDate)} · Project end: ${date(p.endDate)}\n- Requirement analysis & clarifications\n- Test design & review\n- Test execution cycles (smoke, functional, regression)\n- UAT support\n- Test closure`),
        S('deliverables', 'Deliverables', bullets(['Clarification Log', 'Test Scenarios', 'Test Cases', 'Test Techniques Document', 'Test Plan', 'Test Data Sheet', 'Automation scripts', 'Requirement Traceability Matrix', 'Daily and Weekly Status Reports', 'Defect Report', 'Test Closure Report'])),
        S('defects', 'Defect management process', `Life cycle: New → Open → Assigned → In Progress → Fixed → Ready for Retest → Retest → Verified → Closed (also Reopened, Deferred, Rejected, Duplicate, Not a Bug).\nSeverity:\n- Blocker: testing or a core business flow cannot proceed; no workaround\n- Critical: major function broken, data loss/corruption or a security issue; workaround hard or none\n- Major: function not working as specified; a workaround exists\n- Minor: small functional/UI issue with low impact\n- Trivial: cosmetic (typo, alignment)\nPriority & SLA:\n- P1: fix immediately / within the current day\n- P2: fix in the current sprint/build\n- P3: fix when possible\n- P4: low / backlog`),
        S('risks', 'Risks & mitigation', bullets([
          `${ambiguous} requirement items contain ambiguous wording – mitigation: clarification log, assumptions recorded in test cases`,
          `${openQs} clarification questions are open – mitigation: daily follow-up with the client; affected test cases regenerated when answered`,
          'Environment instability – mitigation: environment downtime tracked in the DSR; smoke suite after each deployment',
          'Late requirement changes – mitigation: version diff flags impacted test cases automatically',
        ])),
        S('assumptions', 'Assumptions & dependencies', bullets(assumptions.map((i) => `${i.reqId}: ${i.text}`), '- Test environment, builds and test accounts are provided on time\n- Client contacts answer clarification questions within 2 working days')),
        S('tools', 'Tools', bullets(['QA Pilot – test management, RTM, reporting', 'Playwright – UI and API automation (screenshots, video, trace)', 'Jira – defect tracking (optional integration)', 'Email / Slack / Teams – notifications'])),
        S('communication', 'Communication & reporting plan', bullets(['Daily Status Report – every working day', 'Weekly Status Report with RAG status – every week', 'Defect alert summary – 09:30 and 18:00 IST, Blocker/Critical/P1 highlighted', 'Escalation: QA Lead → Project Manager → Client sponsor'])),
        S('approvals', 'Approvals / sign-off', '- QA Lead: ____________________  Date: ________\n- Project Manager: ______________  Date: ________\n- Client: _______________________  Date: ________'),
      ],
    };
  }
}

/** Body text → export section, preserving line order ("- " lines become "• " bullets). */
export function toExportSection(s: DocSection): ExportSection {
  return { heading: s.heading, paragraphs: s.body.split('\n').filter((l) => l.trim()).map((l) => (l.startsWith('- ') ? `• ${l.slice(2)}` : l)) };
}
