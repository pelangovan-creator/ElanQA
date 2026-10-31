/**
 * Creates a project with a realistic, large data volume for performance checks:
 *   npm run seed:volume --workspace apps/api              (key VOL, default sizes)
 *   VOLUME_KEY=BIG VOLUME_SCALE=2 npm run seed:volume ... (double everything)
 * Default: 1,000 requirements, 200 scenarios, 3,000 test cases, 20 runs x 150 results,
 * 600 defects with history. All rows are synthetic; the project is marked "(volume test)".
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KEY = (process.env.VOLUME_KEY ?? 'VOL').toUpperCase();
const S = Number(process.env.VOLUME_SCALE ?? 1);
const N = { reqs: 1000 * S, scenarios: 200 * S, tcs: 3000 * S, runs: 20, results: 150 * S, defects: 600 * S };
const MODULES = ['Login', 'Search', 'Cart', 'Checkout', 'Payments', 'Orders', 'Profile', 'Admin', 'Reports', 'Notifications'];
const pick = <T>(a: readonly T[], i: number) => a[i % a.length];
const pad = (n: number, w = 4) => String(n).padStart(w, '0');
const day = 86_400_000;

async function chunked<T>(rows: T[], fn: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 500) await fn(rows.slice(i, i + 500));
}

async function main() {
  if (await prisma.project.findUnique({ where: { key: KEY } })) throw new Error(`Project ${KEY} already exists - delete it or set VOLUME_KEY`);
  const admin = await prisma.user.findFirst({ where: { role: 'Admin' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('Seed the first Admin first (npm run db:seed)');
  const t0 = Date.now();
  const start = new Date(Date.now() - 30 * day);
  const project = await prisma.project.create({ data: { key: KEY, name: `Volume test ${KEY}`, client: 'Synthetic Retail (volume test)', description: 'Synthetic data for performance checks', startDate: start, createdById: admin.id } });
  const projectId = project.id;
  await prisma.projectMember.create({ data: { projectId, userId: admin.id, role: 'Admin' } });

  const doc = await prisma.requirementDocument.create({ data: { projectId, docKey: 'DOC-001', title: 'Synthetic SRS', docType: 'SRS' } });
  const ver = await prisma.documentVersion.create({ data: { documentId: doc.id, version: 1, fileName: 'synthetic.md', mimeType: 'text/markdown', storagePath: 'none', sha256: '0', sizeBytes: 0, itemCount: N.reqs, parseStatus: 'Parsed', uploadedById: admin.id } });
  const cats = ['Functional', 'Functional', 'Functional', 'Validation', 'BusinessRule', 'NonFunctional', 'UIUX', 'Informational'];
  await chunked(Array.from({ length: N.reqs }, (_, i) => ({
    projectId, versionId: ver.id, reqId: `REQ-${pad(Math.floor(i / 10) + 1, 3)}.${pad((i % 10) + 1, 2)}`, sequence: i + 1,
    section: `${Math.floor(i / 10) + 1}`, sectionTitle: `${pick(MODULES, Math.floor(i / 10))} requirements`, sourceKind: 'Sentence',
    text: `The system shall let a user ${pick(['view', 'create', 'update', 'delete', 'search', 'export'], i)} ${pick(MODULES, i).toLowerCase()} records with validation rule ${i + 1}.`,
    category: pick(cats, i), coverageStatus: pick(cats, i) === 'Informational' ? 'Informational' : 'Covered',
  })), (b) => prisma.requirementItem.createMany({ data: b }));
  const reqs = await prisma.requirementItem.findMany({ where: { projectId }, select: { id: true, category: true }, orderBy: { sequence: 'asc' } });
  const testable = reqs.filter((r) => r.category !== 'Informational');

  await chunked(Array.from({ length: N.scenarios }, (_, i) => ({
    projectId, scenarioId: `TS-${pad(i + 1, 3)}`, module: pick(MODULES, i), description: `Verify ${pick(MODULES, i)} flow ${i + 1}`,
    scenarioType: pick(['Positive', 'Negative', 'Edge', 'EndToEnd'], i), priority: pick(['High', 'Medium', 'Low'], i), reviewStatus: 'Approved',
  })), (b) => prisma.testScenario.createMany({ data: b }));
  const scen = await prisma.testScenario.findMany({ where: { projectId }, select: { id: true }, orderBy: { scenarioId: 'asc' } });

  const statuses = ['Pass', 'Pass', 'Pass', 'Pass', 'Fail', 'Blocked', 'NotRun'];
  await chunked(Array.from({ length: N.tcs }, (_, i) => ({
    projectId, tcId: `TC-${pad(i + 1)}`, scenarioId: scen[i % scen.length].id, module: pick(MODULES, i),
    title: `${pick(MODULES, i)}: ${pick(['valid input accepted', 'invalid input rejected', 'boundary value', 'permission check', 'end-to-end flow'], i)} #${i + 1}`,
    steps: JSON.stringify([{ no: 1, action: 'Open the page', expected: 'Page is shown' }, { no: 2, action: 'Enter the test data and submit', expected: 'Result matches the rule' }]),
    status: pick(statuses, i), priority: pick(['High', 'Medium', 'Low'], i), testType: pick(['Functional', 'Smoke', 'Regression', 'Security'], i),
    technique: pick(['EquivalencePartitioning', 'BVA', 'DecisionTable', 'StateTransition', 'ErrorGuessing'], i), reviewStatus: 'Approved', aiGenerated: i % 3 === 0,
  })), (b) => prisma.testCase.createMany({ data: b }));
  const tcs = await prisma.testCase.findMany({ where: { projectId }, select: { id: true, tcId: true, module: true }, orderBy: { tcId: 'asc' } });
  await chunked(tcs.flatMap((t, i) => [{ testCaseId: t.id, requirementId: testable[i % testable.length].id }, ...(i % 2 && (i * 7 + 3) % testable.length !== i % testable.length ? [{ testCaseId: t.id, requirementId: testable[(i * 7 + 3) % testable.length].id }] : [])]),
    (b) => prisma.testCaseRequirement.createMany({ data: b }));
  await chunked(scen.map((s, i) => ({ scenarioId: s.id, requirementId: testable[(i * 5) % testable.length].id })), (b) => prisma.scenarioRequirement.createMany({ data: b }));

  for (let r = 0; r < N.runs; r++) {
    const when = new Date(start.getTime() + (r + 1) * 1.4 * day);
    const results = Array.from({ length: N.results }, (_, i) => pick(['Pass', 'Pass', 'Pass', 'Fail', 'Blocked', 'Pass'], i + r));
    const run = await prisma.testRun.create({ data: {
      projectId, runId: `RUN-${pad(r + 1)}`, mode: 'All', status: 'Completed', build: `1.${Math.floor(r / 5)}.${r % 5}`, total: results.length,
      passed: results.filter((s) => s === 'Pass').length, failed: results.filter((s) => s === 'Fail').length, blocked: results.filter((s) => s === 'Blocked').length,
      executedById: admin.id, startedAt: when, finishedAt: new Date(when.getTime() + 600_000), createdAt: when,
    } });
    await prisma.testResult.createMany({ data: results.map((status, i) => ({ runId: run.id, testCaseId: tcs[(r * N.results + i) % tcs.length].id, status, browser: 'chromium', durationMs: 800 + (i % 50) * 40, error: status === 'Fail' ? 'Expected "Order placed" but saw "Payment failed"' : null, createdAt: when })) });
  }

  const dStatus = ['New', 'Assigned', 'Open', 'InProgress', 'Fixed', 'ReadyForRetest', 'Reopened', 'Closed', 'Closed', 'Closed', 'Rejected', 'Deferred'];
  await chunked(Array.from({ length: N.defects }, (_, i) => {
    const reported = new Date(start.getTime() + (i / N.defects) * 29 * day);
    const status = pick(dStatus, i);
    return {
      projectId, defectId: `DEF-${pad(i + 1)}`, title: `${pick(MODULES, i)}: ${pick(['wrong total', 'button not clickable', 'error message missing', 'slow response', 'data not saved'], i)} (${i + 1})`,
      module: pick(MODULES, i), testCaseId: tcs[(i * 5) % tcs.length].id, environment: 'QA', build: '1.2.0',
      stepsToReproduce: '1. Open the page\n2. Enter the data\n3. Submit', expectedResult: 'Saved', actualResult: 'Error shown',
      severity: pick(['Blocker', 'Critical', 'Major', 'Major', 'Minor', 'Minor', 'Trivial'], i), priority: pick(['P1', 'P2', 'P2', 'P3', 'P3', 'P4'], i),
      defectType: pick(['Functional', 'UI', 'Performance', 'Data', 'Usability'], i), status, reportedBy: admin.id, reportedDate: reported,
      assignedTo: status === 'New' ? null : admin.id, closedDate: status === 'Closed' ? new Date(reported.getTime() + 2 * day) : null, createdAt: reported,
    };
  }), (b) => prisma.defect.createMany({ data: b }));
  const defects = await prisma.defect.findMany({ where: { projectId }, select: { id: true, status: true, reportedDate: true } });
  await chunked(defects.flatMap((d) => [
    { defectId: d.id, userId: admin.id, kind: 'StatusChange', field: 'status', fromValue: null, toValue: 'New', createdAt: d.reportedDate },
    ...(d.status !== 'New' ? [{ defectId: d.id, userId: admin.id, kind: 'StatusChange', field: 'status', fromValue: 'New', toValue: d.status, createdAt: new Date(d.reportedDate.getTime() + day) }] : []),
  ]), (b) => prisma.defectHistory.createMany({ data: b }));

  await prisma.idCounter.createMany({ data: [
    { projectId, prefix: 'DEF', value: N.defects }, { projectId, prefix: 'RUN', value: N.runs }, { projectId, prefix: 'TC', value: N.tcs }, { projectId, prefix: 'TS', value: N.scenarios }, { projectId, prefix: 'DOC', value: 1 },
  ] });
  console.log(`Created ${KEY}: ${N.reqs} requirements, ${N.scenarios} scenarios, ${N.tcs} test cases, ${N.runs} runs x ${N.results} results, ${N.defects} defects in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
