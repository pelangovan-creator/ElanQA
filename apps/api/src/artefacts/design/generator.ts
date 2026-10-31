/**
 * Deterministic test design generator. Applies ISTQB techniques to each requirement item:
 * EP, BVA, decision table, state transition, use case, error guessing, checklist, pairwise, exploratory.
 * Used when no AI key is configured and as the safety net that guarantees every testable item is covered.
 */
import { syntheticData, DataDraft, detectField } from './test-data';

export interface DesignItem {
  id: string;
  reqId: string;
  text: string;
  category: string;
  subCategory?: string | null;
  sourceKind: string;
  module: string;
  /** For table rows: column header → cell value. */
  columns?: Record<string, string>;
  ambiguousTerms?: string[];
  openQuestions?: string[];
}

export interface StepDraft { no: number; action: string; expected: string }
export interface ScenarioDraft { key: string; module: string; description: string; scenarioType: 'Positive' | 'Negative' | 'Edge' | 'EndToEnd'; priority: 'High' | 'Medium' | 'Low'; preconditions?: string; itemIds: string[] }
export interface CaseDraft {
  scenarioKey: string; module: string; title: string; description: string; preconditions?: string; steps: StepDraft[];
  priority: 'High' | 'Medium' | 'Low'; testType: string; technique: string; automationCandidate: boolean; suites: string[];
  itemIds: string[]; dataKey?: string; comments?: string;
}
export interface DesignOutput { scenarios: ScenarioDraft[]; cases: CaseDraft[]; data: DataDraft[] }

const quote = (s: string) => `“${s.replace(/[.\s]+$/, '')}”`;

export function priorityFor(item: DesignItem): 'High' | 'Medium' | 'Low' {
  if (item.subCategory === 'security' || item.category === 'BusinessRule') return 'High';
  if (/\b(must|shall|required|mandatory)\b/i.test(item.text) && ['Functional', 'Validation', 'Integration', 'Data'].includes(item.category)) return 'High';
  if (item.category === 'UIUX' || item.subCategory === 'usability' || item.category === 'Constraint') return 'Low';
  return 'Medium';
}

interface Numbers { min?: number; max?: number; unit?: string; threshold?: number; thresholdDir?: 'above' | 'below'; attempts?: number; seconds?: number }

export function extractNumbers(text: string): Numbers {
  const n: Numbers = {};
  const range = /(\d+)\s*(?:to|-|–|and)\s*(\d+)\s*(characters?|chars?|digits?|items?|years?|days?|letters?)?/i.exec(text);
  if (range && Number(range[1]) < Number(range[2])) { n.min = Number(range[1]); n.max = Number(range[2]); n.unit = range[3]; }
  const exact = /\b(\d+)\s*(digits?|characters?)\b/i.exec(text);
  if (!range && exact && !/at least|minimum|maximum|at most|up to/i.test(text)) { n.min = n.max = Number(exact[1]); n.unit = exact[2]; }
  const atLeast = /\b(?:at least|minimum(?: of)?|min\.?)\s*(\d+)/i.exec(text);
  if (atLeast && n.min === undefined) n.min = Number(atLeast[1]);
  const atMost = /\b(?:at most|maximum(?: of)?|max\.?|up to|no more than)\s*(\d+)/i.exec(text);
  if (atMost && n.max === undefined) n.max = Number(atMost[1]);
  const th = /\b(above|over|more than|greater than|exceeding|below|under|less than)\s*(?:rs\.?|inr|usd|\$|€|₹)?\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  if (th) { n.threshold = Number(th[2].replace(/,/g, '')); n.thresholdDir = /below|under|less/i.test(th[1]) ? 'below' : 'above'; }
  const att = /\b(\d+)\s*(?:consecutive\s+)?(?:failed|unsuccessful|invalid|wrong)?\s*(?:login\s+)?attempts?\b/i.exec(text);
  if (att) n.attempts = Number(att[1]);
  const sec = /\bwithin\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|minutes?)/i.exec(text);
  if (sec) n.seconds = Number(sec[1]) * (/^ms|milli/i.test(sec[2]) ? 0.001 : /min/i.test(sec[2]) ? 60 : 1);
  return n;
}

/** Builds the scenarios, cases and test data for one requirement item. */
export function designForItem(item: DesignItem, seq: () => string): DesignOutput {
  const out: DesignOutput = { scenarios: [], cases: [], data: [] };
  const prio = priorityFor(item);
  const ref = item.reqId;
  const req = quote(item.text);
  const nav = `Open the application and navigate to the ${item.module} area`;
  const pre = item.module.toLowerCase().includes('login') ? 'A registered test account exists (see test data accounts)' : 'User is signed in with a role permitted to use this feature (see test data accounts)';
  const notes = [
    item.ambiguousTerms?.length ? `Ambiguous wording (${item.ambiguousTerms.join(', ')}) - expected results to be confirmed` : '',
    item.openQuestions?.length ? `Open clarification(s): ${item.openQuestions.join(', ')}` : '',
  ].filter(Boolean).join('. ') || undefined;

  const scenario = (type: ScenarioDraft['scenarioType'], description: string, p = prio): string => {
    const key = seq();
    out.scenarios.push({ key, module: item.module, description, scenarioType: type, priority: p, preconditions: pre, itemIds: [item.id] });
    return key;
  };
  const tc = (scenarioKey: string, c: Omit<CaseDraft, 'scenarioKey' | 'module' | 'itemIds' | 'priority' | 'suites' | 'preconditions' | 'comments'> & { priority?: CaseDraft['priority']; suites?: string[]; preconditions?: string }) =>
    out.cases.push({ scenarioKey, module: item.module, itemIds: [item.id], priority: c.priority ?? prio, suites: c.suites ?? ['Regression'], preconditions: c.preconditions ?? pre, comments: notes, ...c });
  const steps = (...s: [string, string][]): StepDraft[] => s.map(([action, expected], i) => ({ no: i + 1, action, expected }));

  const nums = extractNumbers(item.text);
  const subject = item.columns ? Object.values(item.columns)[0] : undefined;
  const field = detectField(item.text, subject);

  switch (item.category) {
    case 'Validation': {
      const data = syntheticData(field, nums, item);
      out.data.push(data);
      const pos = scenario('Positive', `Valid input is accepted for ${field.name} (${ref})`);
      const neg = scenario('Negative', `Invalid input is rejected for ${field.name} (${ref})`);
      tc(pos, {
        title: `${field.name}: accept a valid value (valid partition)`, description: `Equivalence partitioning - valid class for ${req}.`, technique: 'EquivalencePartitioning', testType: 'Functional', automationCandidate: true, dataKey: data.key, suites: ['Smoke', 'Regression'],
        steps: steps([nav, `${item.module} page is displayed`], [`Enter a valid ${field.name} from test data (valid values)`, 'Value is accepted without a validation error'], ['Submit the form', 'Submission succeeds and the next step/confirmation is shown']),
      });
      tc(neg, {
        title: `${field.name}: reject values from each invalid partition`, description: `Equivalence partitioning - invalid classes for ${req}.`, technique: 'EquivalencePartitioning', testType: 'Negative', automationCandidate: true, dataKey: data.key,
        steps: steps([nav, `${item.module} page is displayed`], [`Enter each invalid ${field.name} from test data (invalid values), one at a time`, 'A clear validation error is shown for each value and submission is blocked'], ['Leave the field empty and submit', /mandatory|required/i.test(item.text) ? 'A "required" error is shown and submission is blocked' : 'Behaviour for an empty value matches the specification'], ['Enter special characters / script payloads from test data', 'Input is rejected or safely encoded; no script executes']),
      });
      if (nums.min !== undefined || nums.max !== undefined) {
        const edge = scenario('Edge', `Boundaries of ${field.name}: ${[nums.min, nums.max].filter((x) => x !== undefined).join(' to ')}${nums.unit ? ` ${nums.unit}` : ''} (${ref})`);
        tc(edge, {
          title: `${field.name}: boundary values are accepted (min, min+1, max-1, max)`, description: `Boundary value analysis on ${req}.`, technique: 'BoundaryValueAnalysis', testType: 'Functional', automationCandidate: true, dataKey: data.key,
          steps: steps([nav, `${item.module} page is displayed`], [`Enter the "min" and "min+1" boundary values from test data`, 'Both values are accepted'], [`Enter the "max-1" and "max" boundary values from test data`, 'Both values are accepted']),
        });
        tc(edge, {
          title: `${field.name}: values just outside the boundaries are rejected (min-1, max+1)`, description: `Boundary value analysis (invalid boundaries) on ${req}.`, technique: 'BoundaryValueAnalysis', testType: 'Negative', automationCandidate: true, dataKey: data.key,
          steps: steps([nav, `${item.module} page is displayed`], [`Enter the "min-1" boundary value from test data`, 'Value is rejected with a validation error'], [`Enter the "max+1" boundary value from test data`, 'Value is rejected (or input is limited to max) with a validation error']),
        });
      }
      break;
    }
    case 'BusinessRule': {
      if (nums.threshold !== undefined) {
        const t = nums.threshold;
        const data = syntheticData({ name: 'Threshold amount', type: 'Decimal' }, nums, item);
        out.data.push(data);
        const edge = scenario('Edge', `Rule threshold at ${t} (${ref})`);
        const inside = nums.thresholdDir === 'above' ? t + 1 : t - 1;
        tc(edge, {
          title: `Rule applies just ${nums.thresholdDir} the threshold (${inside})`, description: `Boundary value analysis on ${req}.`, technique: 'BoundaryValueAnalysis', testType: 'Functional', automationCandidate: true, dataKey: data.key, suites: ['Smoke', 'Regression'],
          steps: steps([nav, `${item.module} is displayed`], [`Create the transaction with value ${inside}`, `The rule is applied: ${req}`]),
        });
        tc(edge, {
          title: `Rule does not apply at the threshold (${t}) and on the other side (${nums.thresholdDir === 'above' ? t - 1 : t + 1})`, description: `Boundary value analysis on ${req} - "${nums.thresholdDir}" is exclusive unless clarified.`, technique: 'BoundaryValueAnalysis', testType: 'Negative', automationCandidate: true, dataKey: data.key,
          steps: steps([nav, `${item.module} is displayed`], [`Create the transaction with value ${t}`, 'The rule is NOT applied (confirm whether the boundary is inclusive)'], [`Create the transaction with value ${nums.thresholdDir === 'above' ? t - 1 : t + 1}`, 'The rule is NOT applied']),
        });
      }
      const conditions = (item.text.match(/\b(if|when|and|or|unless|only if|except)\b/gi) ?? []).length;
      const pos = scenario('Positive', `Business rule applied correctly (${ref})`);
      tc(pos, {
        title: conditions >= 2 ? `Decision table: all condition combinations for ${ref}` : `Business rule is applied when its condition is met`,
        description: conditions >= 2 ? `Decision table - list every combination of the conditions in ${req} and the expected action for each.` : `Use case - main flow for ${req}.`,
        technique: conditions >= 2 ? 'DecisionTable' : 'UseCase', testType: 'Functional', automationCandidate: true,
        steps: conditions >= 2
          ? steps(['Build the decision table: one column per condition (true/false), rows for each combination', 'Every combination has a defined expected action'], [nav, `${item.module} is displayed`], ['Execute each rule column of the table', `Actual outcome matches the table for every combination (${req})`])
          : steps([nav, `${item.module} is displayed`], ['Perform the action with data that meets the rule condition', `Result: ${req}`]),
      });
      const neg = scenario('Negative', `Business rule not applied when its condition is not met (${ref})`);
      tc(neg, {
        title: 'Business rule is not applied when the condition is not met', description: `Equivalence partitioning (non-qualifying class) for ${req}.`, technique: 'EquivalencePartitioning', testType: 'Negative', automationCandidate: true,
        steps: steps([nav, `${item.module} is displayed`], ['Perform the action with data that does not meet the rule condition', 'The rule is not applied and totals/state are unchanged']),
      });
      break;
    }
    case 'Integration': {
      const pos = scenario('Positive', `Integration works end to end (${ref})`);
      tc(pos, {
        title: 'Successful call to the integrated system', description: `API/integration contract test for ${req}.`, technique: 'UseCase', testType: 'API', automationCandidate: true, suites: ['Smoke', 'Regression'],
        steps: steps(['Trigger the operation that calls the external system with valid data', 'Request is sent with the agreed contract (endpoint, headers, payload)'], ['Inspect the response and the application state', `Successful response is handled: ${req}`]),
      });
      const neg = scenario('Negative', `Integration failures are handled (${ref})`);
      tc(neg, {
        title: 'External system errors, timeouts and invalid responses are handled', description: `Error guessing for ${req}.`, technique: 'ErrorGuessing', testType: 'Integration', automationCandidate: true,
        steps: steps(['Simulate a timeout from the external system', 'User sees a friendly error; no duplicate transaction; retry is possible'], ['Simulate HTTP 4xx and 5xx responses', 'Errors are logged and shown appropriately; data stays consistent'], ['Simulate a malformed/partial response', 'Response is rejected safely; no crash or corrupted data']),
      });
      break;
    }
    case 'Data': {
      const pos = scenario('Positive', `Data is stored and retrieved correctly (${ref})`);
      tc(pos, {
        title: 'Create, read, update and delete the data described', description: `CRUD verification for ${req}.`, technique: 'UseCase', testType: 'CRUD', automationCandidate: true,
        steps: steps([nav, `${item.module} is displayed`], ['Create a record with valid test data', 'Record is saved and appears in the list/database'], ['Update the record and reload', 'Changes are persisted'], ['Delete the record (if allowed)', 'Record is removed / archived as specified'], ['Verify data retention / audit as described', `Behaviour matches ${req}`]),
      });
      tc(pos, {
        title: 'Database state matches what the UI shows', description: `Database test for ${req}.`, technique: 'ChecklistBased', testType: 'Database', automationCandidate: false,
        steps: steps(['Perform the action that writes the data', 'UI confirms success'], ['Query the database for the record', 'Stored values, types and timestamps are correct; no duplicates']),
      });
      break;
    }
    case 'UIUX': {
      const pos = scenario('Positive', `UI element/behaviour as specified (${ref})`, 'Low');
      tc(pos, {
        title: 'UI matches the specification', description: `Checklist-based UI test for ${req}.`, technique: 'ChecklistBased', testType: 'UI', automationCandidate: true,
        steps: steps([nav, `${item.module} is displayed`], ['Check the element/behaviour described', `Matches: ${req}`], ['Check labels, alignment, spelling and states (hover, focus, disabled)', 'Consistent with the style guide']),
      });
      tc(pos, {
        title: 'Layout adapts to mobile, tablet and desktop widths', description: `Responsive check for ${req}.`, technique: 'ChecklistBased', testType: 'Responsive', automationCandidate: true, priority: 'Low',
        steps: steps(['View the page at 360px, 768px and 1366px widths', 'No overlap, truncation or horizontal scrolling; element remains usable']),
      });
      break;
    }
    case 'NonFunctional': {
      const sub = item.subCategory ?? 'other';
      if (sub === 'performance') {
        const s = scenario('Edge', `Performance target (${ref})`);
        const target = nums.seconds ? `${nums.seconds}s` : 'the agreed target (clarify)';
        tc(s, { title: `Response time within ${target} under expected load`, description: `Load test for ${req}.`, technique: 'BoundaryValueAnalysis', testType: 'Load', automationCandidate: false, steps: steps(['Configure a load profile with the expected concurrent users', 'Load generator ready; monitoring enabled'], ['Run the scenario for at least 15 minutes', `95th percentile response time ≤ ${target}; error rate < 1%`]) });
        tc(s, { title: 'Behaviour beyond expected load (stress)', description: `Stress test for ${req}.`, technique: 'ErrorGuessing', testType: 'Stress', automationCandidate: false, priority: 'Low', steps: steps(['Increase load to 2× expected until failure', 'System degrades gracefully, no data loss, recovers when load drops']) });
      } else if (sub === 'security') {
        const s = scenario('Negative', `Security requirement enforced (${ref})`, 'High');
        tc(s, { title: 'Security control works as specified', description: `Security test for ${req}.`, technique: 'ChecklistBased', testType: 'Security', automationCandidate: true, steps: steps([nav, `${item.module} is displayed`], ['Verify the control described', `Matches: ${req}`]) });
        tc(s, { title: 'Common attacks are blocked (OWASP Top 10 checks)', description: `Error guessing - injection, XSS, broken access control, session handling for ${req}.`, technique: 'ErrorGuessing', testType: 'Security', automationCandidate: false, steps: steps(['Attempt SQL injection and XSS payloads from test data in related inputs', 'Payloads are rejected/encoded; no data exposure'], ['Access the feature with a lower-privileged role and by direct URL', 'Access is denied (403/redirect)'], ['Reuse a session token after logout', 'Token is invalid']) });
      } else if (sub === 'accessibility') {
        const s = scenario('Positive', `Accessibility (WCAG 2.2 AA) (${ref})`);
        tc(s, { title: 'WCAG 2.2 AA checks', description: `Accessibility checklist for ${req}.`, technique: 'ChecklistBased', testType: 'Accessibility', automationCandidate: true, steps: steps(['Navigate the feature using only the keyboard', 'All controls reachable, visible focus, logical order, no traps'], ['Use a screen reader (NVDA/VoiceOver)', 'Controls have names/roles; errors are announced'], ['Check contrast and zoom to 200%/400% reflow', 'Contrast ≥ 4.5:1; content reflows without loss'], ['Run an automated axe scan', 'No serious/critical violations']) });
      } else if (sub === 'compatibility') {
        const s = scenario('Positive', `Compatibility matrix (${ref})`);
        tc(s, { title: 'Works on every browser/OS/device combination (pairwise)', description: `Pairwise testing for ${req}: cover each pair of browser × OS × viewport at least once.`, technique: 'Pairwise', testType: 'Compatibility', automationCandidate: true, steps: steps(['Run the core flow on: Chrome/Windows/desktop, Firefox/macOS/desktop, Safari/iOS/mobile, Chrome/Android/mobile, Edge/Windows/tablet', `Functionality and layout are correct on each (${req})`]) });
      } else if (sub === 'localization') {
        const s = scenario('Positive', `Localization (${ref})`);
        tc(s, { title: 'Language, currency, date and number formats', description: `Localization checklist for ${req}.`, technique: 'ChecklistBased', testType: 'Localization', automationCandidate: false, steps: steps(['Switch to each supported locale', 'All text translated; no truncation; correct currency/date/number formats'], ['Enter non-ASCII text (from test data)', 'Saved and displayed correctly']) });
      } else if (sub === 'usability') {
        const s = scenario('Positive', `Usability (${ref})`, 'Low');
        tc(s, { title: 'Exploratory usability session', description: `Exploratory charter: explore ${item.module} with typical users' goals to discover usability issues related to ${req}. Time-box 60 minutes.`, technique: 'Exploratory', testType: 'Usability', automationCandidate: false, steps: steps(['Run the 60-minute charter with 2-3 representative tasks', 'Findings logged; tasks complete without help']) });
      } else {
        const s = scenario('Positive', `Quality attribute (${ref})`);
        tc(s, { title: `${sub[0].toUpperCase()}${sub.slice(1)} requirement verified`, description: `Checklist for ${req}.`, technique: 'ChecklistBased', testType: 'System', automationCandidate: false, steps: steps(['Prepare the environment for this check', 'Ready'], ['Verify the requirement', `Matches: ${req}`]) });
      }
      break;
    }
    case 'Constraint': {
      const s = scenario('Positive', `Constraint respected (${ref})`, 'Low');
      tc(s, { title: 'Compliance with the stated constraint', description: `Checklist-based verification of ${req}.`, technique: 'ChecklistBased', testType: 'System', automationCandidate: false, steps: steps(['Review the build/configuration against the constraint', `Constraint satisfied: ${req}`]) });
      break;
    }
    default: {
      // Functional (and any other testable category)
      if (nums.attempts !== undefined) {
        const n = nums.attempts;
        const s = scenario('Edge', `State change after ${n} attempts (${ref})`);
        tc(s, {
          title: `Account/state changes after ${n} failed attempts; not after ${n - 1}`, description: `State transition + BVA for ${req}: Active → (failure × ${n}) → Locked.`, technique: 'StateTransition', testType: 'Functional', automationCandidate: true,
          steps: steps([nav, `${item.module} is displayed`], [`Perform ${n - 1} consecutive failed attempts`, 'State is still Active; a warning may be shown'], ['Perform one more failed attempt', `State becomes Locked as per ${req}`], ['Attempt with valid credentials/data while locked', 'Access is still denied while locked'], ['Perform the unlock/reset path (if defined)', 'State returns to Active']),
        });
      }
      const pos = scenario('Positive', `${item.text.replace(/[.\s]+$/, '').slice(0, 140)} (${ref})`);
      tc(pos, {
        title: `Main flow works as specified`, description: `Use case / user story test - main success scenario for ${req}.`, technique: 'UseCase', testType: 'Functional', automationCandidate: true, suites: ['Smoke', 'Sanity', 'Regression'],
        steps: steps([nav, `${item.module} is displayed`], ['Perform the action described with valid data', `Outcome: ${req}`], ['Refresh / re-open the screen', 'Result is persisted and consistent']),
      });
      const neg = scenario('Negative', `Invalid use is handled (${ref})`);
      tc(neg, {
        title: 'Invalid input, unauthorised role and interrupted flow are handled', description: `Error guessing for ${req}.`, technique: 'ErrorGuessing', testType: 'Negative', automationCandidate: true,
        steps: steps(['Attempt the action with missing/invalid data', 'Clear error message; no partial save'], ['Attempt the action with a role that is not permitted', 'Action is not available or is denied'], ['Interrupt the flow (back button, double click, network loss)', 'No duplicate or inconsistent records']),
      });
    }
  }
  return out;
}

/** Module name from section title: "2 Login" → "Login"; "Payment › Field" → "Payment". */
export function moduleName(sectionTitle: string | null | undefined, fallback: string): string {
  const t = (sectionTitle ?? '').split('›')[0].replace(/^\s*((?:\d+\.)*\d+\.?|[A-Z]\.\d+(?:\.\d+)*|appendix\s+\w+)\s+/i, '').trim();
  return t || fallback;
}

/** One end-to-end scenario per document chaining each module's main positive flow. */
export function endToEnd(cases: CaseDraft[], scenarios: ScenarioDraft[], seq: () => string): DesignOutput {
  const mains = cases.filter((c) => c.technique === 'UseCase' && c.suites.includes('Smoke'));
  const modules = [...new Set(mains.map((c) => c.module))];
  if (modules.length < 2) return { scenarios: [], cases: [], data: [] };
  const key = seq();
  const firstPerModule = modules.map((m) => mains.find((c) => c.module === m)!);
  const itemIds = [...new Set(firstPerModule.flatMap((c) => c.itemIds))];
  void scenarios;
  return {
    scenarios: [{ key, module: 'End-to-end', description: `Happy path across ${modules.join(' → ')}`, scenarioType: 'EndToEnd', priority: 'High', preconditions: 'Test accounts and master data are available', itemIds }],
    cases: [{
      scenarioKey: key, module: 'End-to-end', title: `End-to-end: ${modules.join(' → ')}`, description: 'System/end-to-end test chaining the main flow of each module in business order.',
      steps: firstPerModule.map((c, i) => ({ no: i + 1, action: `${c.module}: perform the main flow`, expected: c.steps.find((s) => s.expected.startsWith('Outcome'))?.expected ?? 'Step succeeds' })),
      priority: 'High', testType: 'EndToEnd', technique: 'UseCase', automationCandidate: true, suites: ['Regression'], itemIds, preconditions: 'Test accounts and master data are available',
    }],
    data: [],
  };
}
