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
  defectIds: string[]; actualResult?: string | null; executedBy?: string | null; executionDate?: string | null;
}
export interface TestData extends Reviewable {
  dataId: string; tcIds: string[]; fieldName: string; dataType: string; validValues: string[]; invalidValues: string[];
  boundaryValues: Record<string, string> | null; specialChars?: string | null; emptyNull?: string | null; expectedBehaviour?: string | null; environment?: string | null; notes?: string | null;
}
export interface DocArtefact extends Reviewable { type: string; title: string; version: number; updatedAt: string; content: { sections: { key: string; heading: string; body: string }[] } }
