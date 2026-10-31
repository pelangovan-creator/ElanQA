/** Central enumerations (stored as strings in the DB so the schema is SQLite/Postgres portable). */
export const ROLES = ['Admin', 'QALead', 'Tester', 'Developer', 'Client'] as const;
export type Role = (typeof ROLES)[number];

export const PROJECT_STATUSES = ['Active', 'OnHold', 'Closed', 'Archived'] as const;

export const REQUIREMENT_CATEGORIES = [
  'Functional', 'NonFunctional', 'BusinessRule', 'Validation', 'UIUX', 'Data',
  'Integration', 'Constraint', 'Assumption', 'OutOfScope', 'Informational',
] as const;

export const REVIEW_STATUSES = ['PendingReview', 'Approved', 'Rejected'] as const;
export const TEST_STATUSES = ['NotRun', 'Pass', 'Fail', 'Blocked', 'Skipped'] as const;

export const SEVERITIES = ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const DEFECT_TYPES = ['Functional', 'UI', 'Performance', 'Security', 'Data', 'Usability', 'Compatibility'] as const;
export const DEFECT_STATUSES = [
  'New', 'Open', 'Assigned', 'InProgress', 'Fixed', 'ReadyForRetest', 'Retest', 'Reopened',
  'Verified', 'Closed', 'Deferred', 'Rejected', 'Duplicate', 'NotABug',
] as const;

export const SCENARIO_TYPES = ['Positive', 'Negative', 'Edge', 'EndToEnd'] as const;
export const PRIORITY_LEVELS = ['High', 'Medium', 'Low'] as const;
export const SUITES = ['Smoke', 'Sanity', 'Regression'] as const;

/** Test design techniques (ISTQB) used to tag every test case. */
export const TECHNIQUES = [
  'EquivalencePartitioning', 'BoundaryValueAnalysis', 'DecisionTable', 'StateTransition', 'UseCase', 'CauseEffectGraphing',
  'Pairwise', 'ClassificationTree', 'ErrorGuessing', 'Exploratory', 'ChecklistBased', 'StatementCoverage', 'BranchCoverage', 'PathCoverage',
] as const;

export const TEST_TYPES = [
  'Smoke', 'Sanity', 'Functional', 'Integration', 'System', 'EndToEnd', 'Regression', 'Retest', 'UAT', 'API', 'Database', 'UI', 'Usability',
  'Accessibility', 'Compatibility', 'Responsive', 'Performance', 'Load', 'Stress', 'Security', 'Localization', 'DataMigration', 'Negative', 'CRUD',
] as const;
