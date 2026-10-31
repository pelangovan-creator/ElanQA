/**
 * Turns a designed test case into a Playwright spec. Each template implements the technique the case
 * was designed with (EP, BVA, state transition, rule thresholds, error guessing, UI/a11y checklists).
 * Anything that cannot be automated generically becomes `test.fixme` with the manual steps as a to-do,
 * so it is reported as Skipped - never as a false Pass.
 */
import { extractNumbers } from '../../artefacts/design/generator';

export interface TemplateInput {
  tcId: string;
  title: string;
  module: string;
  pageClass: string;
  technique: string;
  testType: string;
  steps: { no: number; action: string; expected: string }[];
  requirements: { reqId: string; text: string; category: string }[];
  data?: { dataId: string; fieldName: string; dataType: string; boundaries: Record<string, string> | null } | null;
  /** Labels discovered on the module page by the probe (undefined = page not probed). */
  pageLabels?: string[];
  /** Set when the probe could not open the module page (e.g. "HTTP 404"). */
  pageUnreachable?: string;
}

export interface TemplateOutput { body: string; kind: 'automated' | 'todo'; reason?: string }

const q = (s: string) => JSON.stringify(s);
const lengthOf = (v: string) => Number(/\((\d+) (?:chars?|digits?|characters?)\)/.exec(v)?.[1] ?? NaN);

/** Pick the page label that best matches a field name ("Order amount (Rs.)" for "Threshold amount"). */
export function matchLabel(field: string, labels: string[] | undefined, fallbackRe?: RegExp): string | undefined {
  if (!labels) return field;
  const f = field.toLowerCase();
  const exact = labels.find((l) => l.toLowerCase().includes(f) || f.includes(l.toLowerCase()));
  if (exact) return exact.replace(/\s*\*$/, '').trim();
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const overlap = labels.find((l) => words(l).some((w) => words(field).includes(w)));
  if (overlap) return overlap.trim();
  return fallbackRe ? labels.find((l) => fallbackRe.test(l))?.trim() : undefined;
}

const RULE_KEYWORD = /\b(discount|cashback|surcharge|fee|charge|tax|commission|interest|reward|points|free shipping|shipping)\b/i;

export function buildSpec(t: TemplateInput): TemplateOutput {
  const req = t.requirements[0];
  const text = t.requirements.map((r) => r.text).join(' ');
  const nums = extractNumbers(text);
  const todo = (reason: string): TemplateOutput => ({
    kind: 'todo', reason,
    body: `  test.fixme(true, ${q(`Not automated yet: ${reason}`)});\n${t.steps.map((s) => `  // ${s.no}. ${s.action}\n  //    Expected: ${s.expected}`).join('\n')}`,
  });

  // End-to-end flows span several pages and need business data: always written by a person (or Claude).
  if (t.testType === 'EndToEnd' || /end-to-end/i.test(t.module)) return todo('end-to-end flows span several pages - script the business flow');
  if (t.pageUnreachable) return todo(`the ${t.module} page could not be opened (${t.pageUnreachable}) - set the module path in the environment`);

  // ── Validation: equivalence partitions and boundary values on a single field
  if (req?.category === 'Validation' && t.data && ['EquivalencePartitioning', 'BoundaryValueAnalysis'].includes(t.technique)) {
    const label = matchLabel(t.data.fieldName, t.pageLabels);
    if (!label) return todo(`field "${t.data.fieldName}" was not found on the ${t.module} page`);
    const negative = t.testType === 'Negative';
    if (t.technique === 'EquivalencePartitioning') {
      const mandatory = /\b(mandatory|required)\b/i.test(text);
      return {
        kind: 'automated',
        body: negative
          ? `  const app = new ${t.pageClass}(page);
  const values = data.item(${q(t.data.dataId)}).invalid.map(raw);${mandatory ? `\n  values.push(''); // mandatory field: empty must be rejected` : ''}
  for (const value of values) {
    await test.step(\`invalid partition: "\${value}"\`, async () => {
      await app.open();
      await app.fill(${q(label)}, value);
      await app.completeForm([${q(label)}]);
      await app.submit();
      await app.expectFieldInvalid(${q(label)});
    });
  }`
          : `  const app = new ${t.pageClass}(page);
  for (const value of data.item(${q(t.data.dataId)}).valid.map(raw)) {
    await test.step(\`valid partition: "\${value}"\`, async () => {
      await app.open();
      await app.fill(${q(label)}, value);
      await app.completeForm([${q(label)}]);
      await app.submit();
      await app.expectFieldValid(${q(label)});
    });
  }`,
      };
    }
    // BVA on lengths: valid = boundary values inside [min, max], invalid = outside.
    const b = t.data.boundaries ?? {};
    const min = nums.min ?? -Infinity, max = nums.max ?? Infinity;
    const entries = Object.entries(b).filter(([, v]) => !Number.isNaN(lengthOf(v)));
    if (!entries.length) return todo('no length boundaries in the test data');
    const pick = entries.filter(([, v]) => (negative ? lengthOf(v) < min || lengthOf(v) > max : lengthOf(v) >= min && lengthOf(v) <= max)).map(([k]) => k);
    const unique = [...new Set(pick)];
    return {
      kind: 'automated',
      body: `  const app = new ${t.pageClass}(page);
  const b = data.item(${q(t.data.dataId)}).boundaries;
  for (const key of ${JSON.stringify(unique)}) {
    const value = raw(b[key]);
    await test.step(\`\${key} (\${value.length} characters) is ${negative ? 'rejected' : 'accepted'}\`, async () => {
      await app.open();
      await app.fill(${q(label)}, value);
      await app.completeForm([${q(label)}]);
      await app.submit();
      await app.${negative ? 'expectFieldInvalid' : 'expectFieldValid'}(${q(label)});
    });
  }`,
    };
  }

  // ── Business rule with a numeric threshold (BVA / EP / use case on the rule)
  if (req?.category === 'BusinessRule' && nums.threshold !== undefined) {
    const keyword = RULE_KEYWORD.exec(text)?.[1];
    const label = matchLabel('amount', t.pageLabels, /amount|value|total|price|quantity/i);
    if (!keyword) return todo('could not tell which outcome the rule produces');
    if (!label) return todo(`no amount/value field found on the ${t.module} page`);
    const th = nums.threshold;
    const above = nums.thresholdDir !== 'below';
    const inside = above ? th + 1 : th - 1;
    const outside = above ? th - 1 : th + 1;
    const cases: [number, boolean][] = t.testType === 'Negative' ? [[th, false], [outside, false]] : t.technique === 'BoundaryValueAnalysis' ? [[inside, true]] : [[inside + (above ? 99 : -99), true]];
    return {
      kind: 'automated',
      body: `  const app = new ${t.pageClass}(page);
  for (const [value, applied] of ${JSON.stringify(cases)} as [number, boolean][]) {
    await test.step(\`value \${value}: ${keyword} \${applied ? 'applied' : 'not applied'}\`, async () => {
      await app.open();
      await app.fill(${q(label)}, String(value));
      await app.completeForm([${q(label)}]);
      await app.submit();
      await app.expectNoFieldErrors();
      await app.expectRuleApplied(${q(keyword.toLowerCase())}, applied);
    });
  }`,
    };
  }

  // ── State transition: N failed attempts lock the account
  if (t.technique === 'StateTransition' && nums.attempts !== undefined) {
    const n = nums.attempts;
    return {
      kind: 'automated',
      body: `  const app = new ${t.pageClass}(page);
  const user = credentials()?.username ?? data.account('Tester')?.valid[0];
  test.skip(!user, 'No test account configured for this environment');
  for (let i = 1; i <= ${n - 1}; i++) {
    await test.step(\`failed attempt \${i} of ${n - 1}: still active\`, async () => {
      await app.open();
      await app.loginWith(user!, 'Wrong-Password-1!');
      await app.expectNoText(/locked/i);
    });
  }
  await test.step('failed attempt ${n}: account becomes locked', async () => {
    await app.open();
    await app.loginWith(user!, 'Wrong-Password-1!');
    await app.expectText(/locked/i);
  });`,
    };
  }

  // ── Main flow of a login requirement
  if (t.technique === 'UseCase' && /\blog ?in|sign ?in\b/i.test(text) && /\blog ?in|sign ?in/i.test(t.module + ' ' + text)) {
    return {
      kind: 'automated',
      body: `  const app = new ${t.pageClass}(page);
  const cred = credentials();
  test.skip(!cred, 'No test credentials configured for this environment (Test Execution → Environments)');
  await app.open();
  await app.loginWith(cred!.username, cred!.password);
  await app.expectNoText(/invalid|locked|error/i);
  await expect(page.getByRole('alert')).toHaveCount(0);`,
    };
  }

  // ── Error guessing on a form: empty submit and script injection
  if (t.technique === 'ErrorGuessing' && ['Negative', 'Security'].includes(t.testType)) {
    return {
      kind: 'automated',
      body: `  const app = new ${t.pageClass}(page);
  await test.step('submitting the empty form shows an error', async () => {
    await app.open();
    await app.submit();
    await app.expectSomeError();
  });
  await test.step('a script payload is not executed', async () => {
    let dialog = false;
    page.on('dialog', (d) => { dialog = true; void d.dismiss(); });
    await app.open();
    const first = page.locator('form input:visible').first();
    await first.fill('<script>alert(1)</script>');
    await app.submit();
    expect(dialog, 'no script dialog should open').toBe(false);
  });`,
    };
  }

  // ── UI / accessibility / responsive checklists
  if (t.testType === 'UI' || t.testType === 'Accessibility') {
    return {
      kind: 'automated',
      body: `  const app = new ${t.pageClass}(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await app.open();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const unlabeled = await page.locator('input:visible, select:visible, textarea:visible').evaluateAll((els) =>
    els.filter((e) => !(e as HTMLInputElement).labels?.length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).map((e) => e.outerHTML.slice(0, 80)));
  expect(unlabeled, 'every form control has an accessible name').toEqual([]);
  expect(await page.locator('img:not([alt])').count(), 'images have alt text').toBe(0);
  expect(await page.getAttribute('html', 'lang'), 'page language is set').toBeTruthy();
  await app.submit().catch(() => undefined);
  const invalid = page.locator('[aria-invalid=true]');
  for (let i = 0; i < (await invalid.count()); i++) {
    const describedBy = await invalid.nth(i).getAttribute('aria-describedby');
    expect(describedBy, 'each invalid field points to its error message').toBeTruthy();
    await expect(page.locator(\`#\${describedBy}\`)).toBeVisible();
  }
  expect(errors, 'no JavaScript errors').toEqual([]);`,
    };
  }
  if (t.testType === 'Responsive') {
    return {
      kind: 'automated',
      body: `  const app = new ${t.pageClass}(page);
  for (const width of [360, 768, 1366]) {
    await test.step(\`\${width}px wide\`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await app.open();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no horizontal scrolling').toBeLessThanOrEqual(1);
    });
  }`,
    };
  }

  return todo('no generic automation template matches this test case');
}

export function specFile(t: TemplateInput, out: TemplateOutput): string {
  const imports = [
    `import { test, expect } from '../../support/fixtures';`,
    `import { ${t.pageClass} } from '../../pages/${t.pageClass}';`,
    `import { data, raw, credentials } from '../../support/data';`,
  ];
  const header = [
    `// ${t.tcId} – generated by QA Pilot from the approved test case. Edit freely: QA Pilot runs this file as saved.`,
    ...t.requirements.map((r) => `// Requirement ${r.reqId}: ${r.text.replace(/\s+/g, ' ')}`),
    `// Technique: ${t.technique} · Type: ${t.testType}${t.data ? ` · Test data: ${t.data.dataId}` : ''}`,
  ];
  return `${imports.join('\n')}\n\n${header.join('\n')}\n\ntest(${q(`${t.tcId} · ${t.title}`)}, async ({ page }) => {\n${out.body}\n});\n`;
}

export function pageObjectFile(className: string, module: string, path: string, labels: string[] | undefined): string {
  const getters = (labels ?? []).map((l) => {
    const name = l.replace(/\(.*?\)/g, '').trim().replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase()) || 'field';
    return `  get ${/^\d/.test(name) ? `f${name}` : name}() { return this.field(${q(l.replace(/\s*\*$/, '').trim())}); }`;
  });
  const unique = [...new Map(getters.map((g) => [g.split('(')[0], g])).values()];
  return `import { Page } from '@playwright/test';
import { AppPage } from '../support/app';

/** Page Object for the "${module}" module (${path}). ${labels ? `Fields discovered on the page: ${labels.join(', ')}.` : 'The page was not probed - add getters as needed.'} */
export class ${className} extends AppPage {
  constructor(page: Page) {
    super(page, ${q(module)}, ${q(path)});
  }
${unique.join('\n')}
}
`;
}
