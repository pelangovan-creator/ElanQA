export type Role = 'Admin' | 'QALead' | 'Tester' | 'Developer' | 'Client';
export const ROLES: Role[] = ['Admin', 'QALead', 'Tester', 'Developer', 'Client'];
export const ROLE_LABEL: Record<Role, string> = { Admin: 'Admin', QALead: 'QA Lead', Tester: 'Tester', Developer: 'Developer', Client: 'Client (view-only)' };

export interface User { id: string; email: string; name: string; role: Role; active?: boolean; lastLoginAt?: string | null }
export interface ProjectSummary {
  id: string; key: string; name: string; client?: string | null; description?: string | null; status: string;
  startDate?: string | null; endDate?: string | null; myRole?: Role; memberCount?: number;
}
export interface ProjectDetail extends ProjectSummary {
  members: { id: string; role: Role; user: User }[];
  permissions: string[];
}
export interface AuditItem {
  id: string; action: string; entityType: string; entityId?: string | null; before?: string | null; after?: string | null;
  createdAt: string; user?: { name: string; email: string } | null;
}

export const CATEGORIES = ['Functional', 'NonFunctional', 'BusinessRule', 'Validation', 'UIUX', 'Data', 'Integration', 'Constraint', 'Assumption', 'OutOfScope', 'Informational'] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  Functional: 'Functional', NonFunctional: 'Non-functional', BusinessRule: 'Business rule', Validation: 'Validation rule', UIUX: 'UI/UX', Data: 'Data',
  Integration: 'Integration', Constraint: 'Constraint', Assumption: 'Assumption', OutOfScope: 'Out of scope', Informational: 'Informational',
};
export const SOURCE_KINDS = ['Sentence', 'Bullet', 'TableRow', 'TableCell', 'Header', 'Footnote', 'Note', 'Caption', 'Appendix'] as const;
export const DOC_TYPES = ['BRD', 'FRD', 'SRS', 'UserStory', 'Wireframe', 'Email', 'ChangeRequest', 'Other'] as const;

export interface VersionSummary {
  id: string; version: number; fileName: string; sizeBytes: number; parseStatus: string; parseError?: string | null; itemCount: number;
  wordCountOriginal?: number | null; wordCountExtracted?: number | null; reverseCheckOk?: boolean | null; ocrUsed: boolean; createdAt: string;
}
export interface RequirementDocument { id: string; docKey: string; title: string; docType: string; versions: VersionSummary[] }
export interface VersionDetail extends VersionSummary {
  document: { docKey: string; title: string };
  warnings: string[];
  reverseCheck: { originalWords: number; extractedWords: number; missing: { word: string; count: number }[]; extra: { word: string; count: number }[]; ok: boolean } | null;
  diff: {
    unchanged: number; added: { reqId: string; text: string }[]; removed: { reqId: string; text: string }[];
    modified: { reqId: string; oldText: string; newText: string; similarity: number }[]; impactedTestCases: string[];
  } | null;
}
export interface RequirementItem {
  id: string; reqId: string; parentReqId?: string | null; sourceKind: string; section?: string | null; sectionTitle?: string | null; page?: number | null;
  text: string; category: string; subCategory?: string | null; ambiguousTerms: string[]; coverageStatus: string; noTestReason?: string | null;
  changeType?: string | null; previousText?: string | null; aiGenerated: boolean;
  version: { version: number; document: { docKey: string; title: string } };
  _count: { questions: number; scenarioLinks: number; testCaseLinks: number };
}
export interface CoverageSummary {
  total: number; covered: number; informational: number; acknowledged: number; unmapped: number; coveragePercent: number; testCoveragePercent: number;
  complete: boolean; suggestions: number; unmappedItems: { id: string; reqId: string; text: string; category: string; sourceKind: string; section?: string; page?: number }[];
}
export interface RtmRow {
  id: string; reqId: string; document: string; section?: string | null; page?: number | null; sourceKind: string; category: string; text: string;
  coverageStatus: string; noTestReason?: string | null; scenarioIds: string[]; testCaseIds: string[]; executionStatus: string; defectIds: string[];
}
export interface Question {
  id: string; qId: string; question: string; category: string; priority: string; status: string; sectionPage?: string | null;
  raisedBy?: string | null; raisedDate: string; aiGenerated: boolean; reviewStatus: string; requirement?: { reqId: string; text: string } | null;
}

export const TECHNIQUES = ['EquivalencePartitioning', 'BoundaryValueAnalysis', 'DecisionTable', 'StateTransition', 'UseCase', 'CauseEffectGraphing', 'Pairwise', 'ClassificationTree', 'ErrorGuessing', 'Exploratory', 'ChecklistBased', 'StatementCoverage', 'BranchCoverage', 'PathCoverage'] as const;
export const TECHNIQUE_LABEL: Record<string, string> = {
  EquivalencePartitioning: 'Equivalence Partitioning', BoundaryValueAnalysis: 'Boundary Value Analysis', DecisionTable: 'Decision Table', StateTransition: 'State Transition',
  UseCase: 'Use Case / User Story', CauseEffectGraphing: 'Cause-Effect Graphing', Pairwise: 'Pairwise', ClassificationTree: 'Classification Tree', ErrorGuessing: 'Error Guessing',
  Exploratory: 'Exploratory', ChecklistBased: 'Checklist-based', StatementCoverage: 'Statement coverage', BranchCoverage: 'Branch coverage', PathCoverage: 'Path coverage',
};
export const TEST_TYPES = ['Smoke', 'Sanity', 'Functional', 'Integration', 'System', 'EndToEnd', 'Regression', 'Retest', 'UAT', 'API', 'Database', 'UI', 'Usability', 'Accessibility', 'Compatibility', 'Responsive', 'Performance', 'Load', 'Stress', 'Security', 'Localization', 'DataMigration', 'Negative', 'CRUD'] as const;
export const SCENARIO_TYPES = ['Positive', 'Negative', 'Edge', 'EndToEnd'] as const;
export const PRIORITY_LEVELS = ['High', 'Medium', 'Low'] as const;
export const SEVERITIES = ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'] as const;
export const SUITES = ['Smoke', 'Sanity', 'Regression'] as const;
export const Q_CATEGORIES = ['Ambiguity', 'MissingInfo', 'Conflict', 'Assumption', 'EdgeCase'] as const;

export interface Reviewable { id: string; aiGenerated: boolean; reviewStatus: string; reviewComment?: string | null }
export interface FullQuestion extends Question { assignedTo?: string | null; clientAnswer?: string | null; answerDate?: string | null; impact?: string | null; requirementId?: string | null }
export interface Scenario extends Reviewable {
  scenarioId: string; module: string; description: string; scenarioType: string; priority: string; preconditions?: string | null;
  requirements: { id: string; reqId: string }[]; _count: { testCases: number };
}
export interface Step { no: number; action: string; expected: string }
export interface TestCase extends Reviewable {
  tcId: string; scenario?: { id: string; scenarioId: string } | null; module: string; title: string; description?: string | null; preconditions?: string | null;
  testDataRef?: string | null; steps: Step[]; status: string; priority: string; severityIfFailed?: string | null; testType: string; technique: string;
  automationCandidate: boolean; suites: string[]; comments?: string | null; needsRegeneration: boolean; requirements: { id: string; reqId: string; text?: string }[];
  defectIds: string[]; actualResult?: string | null; executedBy?: string | null; executionDate?: string | null; automatedScriptId?: string | null;
}
export interface TestData extends Reviewable {
  dataId: string; tcIds: string[]; fieldName: string; dataType: string; validValues: string[]; invalidValues: string[];
  boundaryValues: Record<string, string> | null; specialChars?: string | null; emptyNull?: string | null; expectedBehaviour?: string | null; environment?: string | null; notes?: string | null;
}
export interface DocArtefact extends Reviewable { type: string; title: string; version: number; updatedAt: string; content: { sections: { key: string; heading: string; body: string }[] } }

export const RUN_MODES = ['All', 'Selected', 'Module', 'Priority', 'Smoke', 'Sanity', 'Regression', 'RerunFailed'] as const;
export const RUN_MODE_LABEL: Record<string, string> = {
  All: 'Run all', Selected: 'Run selected', Module: 'Run by module', Priority: 'Run by priority', Smoke: 'Run smoke suite', Sanity: 'Run sanity suite', Regression: 'Run regression suite', RerunFailed: 'Re-run failed',
};
export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export interface Environment {
  id: string; name: string; envType: string; baseUrl: string; browsers: string[]; viewport?: string | null; modulePaths: Record<string, string>;
  workers: number; retries: number; timeoutMs: number; credentials: Record<string, { username: string; password: string }>;
  lastProbe: { at: string; pages: Record<string, { path: string; status: number | null; labels: string[]; error?: string }> } | null;
}
export interface ScriptSummary { id: string; testCaseId?: string | null; name: string; path: string; kind: string; aiGenerated: boolean; updatedAt: string }
export interface AttachmentMeta { id: string; kind: string; fileName: string; mimeType: string; sizeBytes: number }
export interface RunResult {
  id: string; testCaseId: string; status: string; title?: string | null; browser?: string | null; durationMs?: number | null; retries: number; error?: string | null;
  stepResults: { title?: string; no?: number; status?: string; actual?: string; error?: string; duration?: number }[]; executedBy?: string | null; createdAt: string;
  testCase: { tcId: string; title: string; module: string; priority: string; steps: Step[] }; attachments: AttachmentMeta[];
}
export interface RunSummary {
  id: string; runId: string; kind: string; mode: string; build?: string | null; status: string; total: number; passed: number; failed: number; blocked: number; skipped: number;
  startedAt?: string | null; finishedAt?: string | null; createdAt: string; environment?: { name: string; envType: string } | null;
}
export interface RunDetail extends RunSummary {
  log?: string | null; executedBy?: string | null; environment?: { name: string; envType: string; baseUrl?: string } | null;
  summary: { browsers?: string[]; notAutomated?: string[]; testCases?: string[]; testCaseIds?: string[]; environment?: string; baseUrl?: string } | null; results: RunResult[];
}

export const DEFECT_STATUSES = ['New', 'Open', 'Assigned', 'InProgress', 'Fixed', 'ReadyForRetest', 'Retest', 'Reopened', 'Verified', 'Closed', 'Deferred', 'Rejected', 'Duplicate', 'NotABug'] as const;
export const DEFECT_STATUS_LABEL: Record<string, string> = {
  New: 'New', Open: 'Open', Assigned: 'Assigned', InProgress: 'In Progress', Fixed: 'Fixed', ReadyForRetest: 'Ready for Retest', Retest: 'Retest',
  Reopened: 'Reopened', Verified: 'Verified', Closed: 'Closed', Deferred: 'Deferred', Rejected: 'Rejected', Duplicate: 'Duplicate', NotABug: 'Not a Bug',
};
export const DEFECT_TYPES = ['Functional', 'UI', 'Performance', 'Security', 'Data', 'Usability', 'Compatibility'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const SEVERITY_DEF: Record<string, string> = {
  Blocker: 'Testing or a core business flow cannot proceed; no workaround.',
  Critical: 'Major function broken, data loss/corruption, or a security issue; workaround is hard or none.',
  Major: 'Function not working as specified; a workaround exists.',
  Minor: 'Small functional/UI issue with low impact.',
  Trivial: 'Cosmetic (typo, alignment).',
};
export const PRIORITY_DEF: Record<string, string> = { P1: 'Fix immediately / within the current day.', P2: 'Fix in the current sprint/build.', P3: 'Fix when possible.', P4: 'Low / backlog.' };
export const isHighImpact = (d: { severity: string; priority: string }) => d.severity === 'Blocker' || d.severity === 'Critical' || d.priority === 'P1';

export interface Defect {
  id: string; defectId: string; title: string; description?: string | null; module?: string | null; requirementId?: string | null; testCaseId?: string | null;
  testRunId?: string | null; environment?: string | null; build?: string | null; browserDeviceOs?: string | null; preconditions?: string | null;
  stepsToReproduce?: string | null; testDataUsed?: string | null; expectedResult?: string | null; actualResult?: string | null;
  severity: string; priority: string; defectType: string; status: string; isDraft: boolean; reportedBy?: string | null; reportedDate: string;
  assignedTo?: string | null; rootCause?: string | null; fixVersion?: string | null; targetDate?: string | null; retestResult?: string | null; closedDate?: string | null;
  jiraKey?: string | null; jiraUrl?: string | null; ageDays: number; open: boolean; thumbnailId: string | null; hasScreenshot: boolean;
  duplicateCandidates: { id: string; defectId: string; title: string; status: string; score: number; reason: string }[];
  testCase?: { id?: string; tcId: string; title?: string } | null;
  attachments: (AttachmentMeta & { createdAt?: string })[];
}
export interface DefectDetail extends Defect {
  duplicateOf: { id: string; defectId: string; title: string } | null;
  history: { id: string; kind: string; field?: string | null; fromValue?: string | null; toValue?: string | null; comment?: string | null; createdAt: string; userName: string }[];
  allowedTransitions: string[];
}

export interface MonitorSettings { enabled: boolean; timeZone: string; morning: string; evening: string; slaHours: Record<string, number>; agingDays: number }
export interface MonitorLine { id: string; defectId: string; title: string; severity: string; priority: string; status: string; assignedTo: string | null; ageDays: number; lastUpdated: string; slaDueAt: string; slaBreached: boolean; module: string | null }
export interface MonitorSummary {
  generatedAt: string; slot: string; timeZone: string; localTime: string; since: string; previousCheckAt: string | null;
  totals: { open: number; critical: number; breached: number; drafts: number; pendingRetest: number; aging: number };
  bySeverity: Record<string, number>; byPriority: Record<string, number>;
  critical: MonitorLine[]; newSince: MonitorLine[]; reopened: MonitorLine[]; closed: MonitorLine[]; pendingRetest: MonitorLine[]; aging: MonitorLine[];
}
export interface MonitorCheckSummary { id: string; slot: string; scheduledFor: string | null; late: boolean; criticalCount: number; breachedCount: number; createdAt: string }
export interface MonitorCheck extends MonitorCheckSummary { summary: MonitorSummary; delivered: string[] }
