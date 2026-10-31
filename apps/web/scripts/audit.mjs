// Accessibility (axe-core, WCAG 2.2 A/AA rules) and page-load audit of every QA Pilot screen.
//   node apps/web/scripts/audit.mjs --base http://localhost:8080 --email admin@qapilot.local --password '...' --project VOL
// Exits non-zero when a page has an axe violation or loads slower than --budget ms (default 2000).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5173');
const API = arg('api', `${BASE}/api`);
const EMAIL = arg('email', 'admin@qapilot.local');
const PASSWORD = arg('password', process.env.QAPILOT_PASSWORD);
const KEY = arg('project', 'DEMO');
const BUDGET = Number(arg('budget', 2000));
const OUT = arg('out', 'audit-results');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const login = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
if (!login.token) throw new Error(`Sign-in failed: ${JSON.stringify(login)}`);
const get = (p) => fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json());
const project = (await get('/projects')).find((p) => p.key === KEY);
if (!project) throw new Error(`Project ${KEY} not found`);
const P = `/projects/${project.id}`;
const defects = await get(`${P}/defects`);
const runs = await get(`${P}/execution/runs`);
const firstDefect = (defects.items ?? defects)[0];
const firstRun = (runs.items ?? runs)[0];

const pages = [
  ['Overview', '/'], ['Requirements & RTM', '/requirements'], ['Test Artefacts', '/artefacts'], ['Test Execution', '/execution'],
  ...(firstRun ? [['Run detail', `/execution/runs/${firstRun.id}`]] : []),
  ['Defects', '/defects'], ...(firstDefect ? [['Defect detail', `/defects/${firstDefect.id}`]] : []),
  ['Defect Monitoring', '/monitoring'], ['Reports & Dashboard', '/reports'], ['Test Closure', '/closure'], ['Audit Trail', '/audit'],
  ['Projects', '/projects'], ['Users', '/users'], ['My account', '/account'],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
for (const [vw, vh, label] of [[1366, 768, 'desktop'], [390, 844, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  await ctx.addInitScript(([t, id]) => { localStorage.setItem('qapilot.token', t); localStorage.setItem('qapilot.project', id); }, [login.token, project.id]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [name, path] of pages) {
    errors.length = 0;
    const t0 = Date.now();
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    // "Loaded" = the page heading is visible, no loading indicator remains and the network is quiet.
    await page.locator('main h1').first().waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !document.querySelector('main [role="status"][aria-busy="true"]') && !/Loading…/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => undefined);
    const ms = Date.now() - t0;
    // The app's Content-Security-Policy blocks injected <script> tags, so evaluate axe directly.
    await page.evaluate(axeSource);
    const axe = await page.evaluate(async (tags) => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
    }, TAGS);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = `${OUT}/${label}-${name.replace(/[^A-Za-z]+/g, '-')}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    results.push({ viewport: label, page: name, ms, violations: axe, horizontalOverflowPx: overflow, consoleErrors: [...errors] });
    console.log(`${label.padEnd(7)} ${name.padEnd(20)} ${String(ms).padStart(5)} ms  axe: ${axe.length ? axe.map((v) => `${v.id}(${v.nodes.length})`).join(', ') : 'none'}${overflow > 0 ? `  overflow ${overflow}px` : ''}${errors.length ? `  console errors: ${errors.length}` : ''}`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const slow = results.filter((r) => r.viewport === 'desktop' && r.ms > BUDGET);
const bad = results.filter((r) => r.violations.length || r.consoleErrors.length || (r.viewport === 'mobile' && r.horizontalOverflowPx > 0));
console.log(`\n${results.length} page views · ${bad.length} with problems · ${slow.length} over the ${BUDGET} ms budget · details in ${OUT}/results.json`);
process.exitCode = bad.length || slow.length ? 1 : 0;
