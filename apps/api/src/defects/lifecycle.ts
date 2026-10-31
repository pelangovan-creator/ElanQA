/**
 * Defect life cycle (section 5.2). Transitions are validated server-side; Developers may only move
 * their work forward (In Progress → Fixed → Ready for Retest), testers/leads own triage and verification.
 */
export const LIFECYCLE: Record<string, string[]> = {
  New: ['Open', 'Assigned', 'Rejected', 'Duplicate', 'NotABug', 'Deferred'],
  Open: ['Assigned', 'InProgress', 'Rejected', 'Duplicate', 'NotABug', 'Deferred'],
  Assigned: ['InProgress', 'Open', 'Deferred', 'Rejected', 'NotABug'],
  InProgress: ['Fixed', 'Assigned', 'Deferred'],
  Fixed: ['ReadyForRetest', 'InProgress'],
  ReadyForRetest: ['Retest', 'Reopened'],
  Retest: ['Verified', 'Reopened'],
  Reopened: ['Assigned', 'InProgress'],
  Verified: ['Closed', 'Reopened'],
  Closed: ['Reopened'],
  Deferred: ['Open', 'Assigned', 'Closed'],
  Rejected: ['Open', 'Closed'],
  Duplicate: ['Open', 'Closed'],
  NotABug: ['Open', 'Closed'],
};

export const DEVELOPER_TARGETS = new Set(['InProgress', 'Fixed', 'ReadyForRetest']);
export const CLOSED_STATES = new Set(['Closed', 'Rejected', 'Duplicate', 'NotABug']);
/** Open = still needs work by someone (used for duplicate detection, alerts, reports). */
export const isOpen = (status: string) => !CLOSED_STATES.has(status) && status !== 'Verified' && status !== 'Deferred';

export const STATUS_LABEL: Record<string, string> = {
  New: 'New', Open: 'Open', Assigned: 'Assigned', InProgress: 'In Progress', Fixed: 'Fixed', ReadyForRetest: 'Ready for Retest', Retest: 'Retest',
  Reopened: 'Reopened', Verified: 'Verified', Closed: 'Closed', Deferred: 'Deferred', Rejected: 'Rejected', Duplicate: 'Duplicate', NotABug: 'Not a Bug',
};

export const SEVERITY_DEFINITIONS: Record<string, string> = {
  Blocker: 'Testing or a core business flow cannot proceed; no workaround.',
  Critical: 'Major function broken, data loss/corruption, or a security issue; workaround is hard or none.',
  Major: 'Function not working as specified; a workaround exists.',
  Minor: 'Small functional/UI issue with low impact.',
  Trivial: 'Cosmetic (typo, alignment).',
};
export const PRIORITY_DEFINITIONS: Record<string, string> = {
  P1: 'Fix immediately / within the current day.',
  P2: 'Fix in the current sprint/build.',
  P3: 'Fix when possible.',
  P4: 'Low / backlog.',
};

/** Default priority from severity and the test case priority. */
export function defaultPriority(severity: string, tcPriority?: string): string {
  if (severity === 'Blocker') return 'P1';
  if (severity === 'Critical') return tcPriority === 'High' ? 'P1' : 'P2';
  if (severity === 'Major') return tcPriority === 'High' ? 'P2' : 'P3';
  if (severity === 'Minor') return 'P3';
  return 'P4';
}

export function defectTypeFor(testType: string, category?: string, subCategory?: string | null): string {
  if (testType === 'Security' || subCategory === 'security') return 'Security';
  if (['Performance', 'Load', 'Stress'].includes(testType) || subCategory === 'performance') return 'Performance';
  if (['UI', 'Responsive'].includes(testType) || category === 'UIUX') return 'UI';
  if (['Usability', 'Accessibility'].includes(testType) || subCategory === 'usability' || subCategory === 'accessibility') return 'Usability';
  if (testType === 'Compatibility' || subCategory === 'compatibility') return 'Compatibility';
  if (['Database', 'CRUD', 'DataMigration'].includes(testType) || category === 'Data') return 'Data';
  return 'Functional';
}

export function ageDays(reported: Date, closed?: Date | null): number {
  return Math.max(0, Math.floor(((closed ?? new Date()).getTime() - reported.getTime()) / 86_400_000));
}
