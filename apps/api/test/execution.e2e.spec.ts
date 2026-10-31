import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'node:http';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app: demoApp } = require('../../demo/server.js');

const binary = (r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };

describe('Phase 4 - environments, Playwright scripts, runs with evidence, manual execution', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let demo: Server;
  let demoUrl: string;
  let projectId: string;
  let envId: string;
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const X = () => `/api/projects/${projectId}/execution`;
  const A = () => `/api/projects/${projectId}/artefacts`;

  async function waitForRun(id: string, ms = 180_000) {
    const end = Date.now() + ms;
    for (;;) {
      const r = (await api().get(`${X()}/runs/${id}`).set(as('tester'))).body;
      if (['Completed', 'Aborted', 'Error'].includes(r.status)) return r;
      if (Date.now() > end) throw new Error(`run still ${r.status}`);
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  beforeAll(async () => {
    demo = demoApp.listen(0);
    demoUrl = `http://localhost:${(demo.address() as any).port}`;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await hashPassword('Passw0rd!');
    projectId = (await prisma.project.create({ data: { key: 'EXEC', name: 'ShopEasy' } })).id;
    for (const [k, role] of [['lead', 'QALead'], ['tester', 'Tester'], ['client', 'Client']]) {
      const u = await prisma.user.create({ data: { email: `${k}@exec.local`, name: k, role, passwordHash: hash } });
      await prisma.projectMember.create({ data: { projectId, userId: u.id, role } });
      tok[k] = (await api().post('/api/auth/login').send({ email: `${k}@exec.local`, password: 'Passw0rd!' })).body.token;
    }
    await api().post(`/api/projects/${projectId}/requirements/documents`).set(as('tester')).attach('file', join(__dirname, '..', '..', 'demo', 'docs', 'demo-srs.md')).expect(201);
    await api().post(`${A()}/design/generate`).set(as('tester')).send({}).expect(201);
  }, 90_000);
  afterAll(async () => { await app.close(); demo.close(); });

  it('environments: URL validated, credentials encrypted and only returned masked; client cannot configure', async () => {
    await api().post(`${X()}/environments`).set(as('tester')).send({ name: 'QA', baseUrl: 'file:///etc/passwd' }).expect(400);
    await api().post(`${X()}/environments`).set(as('client')).send({ name: 'QA', baseUrl: demoUrl }).expect(403);
    const env = (await api().post(`${X()}/environments`).set(as('tester')).send({
      name: 'QA', envType: 'QA', baseUrl: demoUrl, browsers: ['chromium'], workers: 4, credentials: { Tester: { username: 'qapilot.tester@example.com', password: 'Demo!2345' } },
    }).expect(201)).body;
    envId = env.id;
    expect(env.credentials).toEqual({ Tester: { username: 'qapilot.tester@example.com', password: '****2345' } });
    const raw = await prisma.testEnvironment.findUniqueOrThrow({ where: { id: envId } });
    expect(raw.credentialsEnc).not.toContain('Demo!2345');
    // Updating with an empty password keeps the stored one.
    await api().patch(`${X()}/environments/${envId}`).set(as('tester')).send({ credentials: { Tester: { username: 'qapilot.tester@example.com', password: '' } } }).expect(200);
    const list = (await api().get(`${X()}/environments`).set(as('client')).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain('Demo!2345');
  });

  it('scripts are generated only from approved test cases, with page objects from the probed pages', async () => {
    await api().post(`${X()}/scripts/generate`).set(as('tester')).send({ environmentId: envId }).expect(400); // nothing approved yet
    const ids = (await api().get(`${A()}/test-cases`).set(as('lead'))).body.map((t: any) => t.id);
    await api().post(`${A()}/review`).set(as('lead')).send({ entityType: 'TestCase', ids, action: 'Approve' }).expect(201);
    const gen = (await api().post(`${X()}/scripts/generate`).set(as('tester')).send({ environmentId: envId }).expect(201)).body;
    expect(gen.automated).toBeGreaterThanOrEqual(20);
    expect(gen.probe.Checkout.labels).toEqual(['Order amount (Rs.)', 'Card number']);
    const scripts = (await api().get(`${X()}/scripts`).set(as('client')).expect(200)).body;
    expect(scripts.map((s: any) => s.path)).toEqual(expect.arrayContaining(['playwright.config.ts', 'support/fixtures.ts', 'pages/RegistrationPage.ts', 'data/test-data.json']));
    const po = (await api().get(`${X()}/scripts/${scripts.find((s: any) => s.path === 'pages/CheckoutPage.ts').id}`).set(as('tester'))).body;
    expect(po.content).toContain("get orderAmount() { return this.field(\"Order amount (Rs.)\"); }");
  });

  it('Run All: executes in a real browser, finds exactly the three deliberate bugs, and attaches evidence to every failure', async () => {
    const run = (await api().post(`${X()}/runs`).set(as('tester')).send({ environmentId: envId, mode: 'All', build: '1.0.0' }).expect(201)).body;
    await api().post(`${X()}/runs`).set(as('tester')).send({ environmentId: envId, mode: 'All' }).expect(409); // one active run per project
    const done = await waitForRun(run.id);
    expect(done.status).toBe('Completed');
    const failed = done.results.filter((r: any) => r.status === 'Fail').map((r: any) => r.title);
    expect(failed).toHaveLength(5);
    expect(failed.join('\n')).toMatch(/after 3 failed attempts/);       // BUG-1 lockout
    expect(failed.join('\n')).toMatch(/Password: values just outside/); // BUG-2 BVA max+1
    expect(failed.join('\n')).toMatch(/Password: reject values/);       // BUG-2 EP too long
    expect(failed.join('\n')).toMatch(/threshold \(5000\)/);            // BUG-3 discount at 5000
    for (const r of done.results.filter((x: any) => x.status === 'Fail')) {
      expect(r.attachments.map((a: any) => a.kind)).toEqual(expect.arrayContaining(['FailureScreenshot', 'FullPageScreenshot', 'AnnotatedScreenshot', 'Video', 'Trace', 'ConsoleLog', 'NetworkLog']));
    }
    expect(done.passed + done.failed + done.skipped + done.blocked).toBe(done.total);
    expect(done.log).toMatch(/✗ TC-/);
    const shot = done.results.find((r: any) => r.status === 'Fail').attachments.find((a: any) => a.kind === 'FailureScreenshot');
    const img = await api().get(`${X()}/attachments/${shot.id}`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(img.body.subarray(1, 4).toString()).toBe('PNG');
    const lockTc = (await api().get(`${A()}/test-cases?q=after 3 failed`).set(as('tester'))).body[0];
    expect(lockTc).toMatchObject({ status: 'Fail', actualResult: expect.stringContaining('locked') });
  }, 240_000);

  it('Re-run failed only runs the failed test cases', async () => {
    const run = (await api().post(`${X()}/runs`).set(as('tester')).send({ environmentId: envId, mode: 'RerunFailed' }).expect(201)).body;
    const done = await waitForRun(run.id);
    expect(done.total).toBe(5);
    expect(done.failed).toBe(5);
  }, 120_000);

  it('edited scripts are run as saved, protected from regeneration, and never see the API secrets', async () => {
    const tc = (await api().get(`${A()}/test-cases?q=Email: accept`).set(as('tester'))).body[0];
    const script = (await api().get(`${X()}/scripts/${tc.automatedScriptId}`).set(as('tester'))).body;
    const content = script.content.replace(/async \(\{ page \}\) => \{\n/, `async ({ page }) => {\n  expect(process.env.ENCRYPTION_KEY).toBeUndefined();\n  expect(process.env.JWT_SECRET).toBeUndefined();\n  expect(process.env.DATABASE_URL).toBeUndefined();\n  expect(JSON.parse(process.env.QAPILOT_CREDENTIALS!).Tester.password).toBe('Demo!2345');\n`);
    expect(content).not.toBe(script.content);
    await api().patch(`${X()}/scripts/${script.id}`).set(as('client')).send({ content }).expect(403);
    await api().patch(`${X()}/scripts/${script.id}`).set(as('tester')).send({ content }).expect(200);
    const gen = (await api().post(`${X()}/scripts/generate`).set(as('tester')).send({ environmentId: envId }).expect(201)).body;
    expect(gen.keptEdited).toBe(1);
    const run = (await api().post(`${X()}/runs`).set(as('tester')).send({ environmentId: envId, mode: 'Selected', testCaseIds: [tc.id] }).expect(201)).body;
    const done = await waitForRun(run.id);
    expect(done.results.map((r: any) => r.status)).toEqual(['Pass']);
  }, 120_000);

  it('manual execution: step results, failing step drives the status, screenshot upload, completion', async () => {
    const tc = (await api().get(`${A()}/test-cases`).set(as('tester'))).body.find((t: any) => !t.automationCandidate);
    const run = (await api().post(`${X()}/manual-runs`).set(as('tester')).send({ testCaseIds: [tc.id], environmentId: envId, build: '1.0.0' }).expect(201)).body;
    expect(run).toMatchObject({ kind: 'Manual', status: 'Running', total: 1 });
    const steps = tc.steps.map((s: any, i: number) => ({ no: s.no, status: i === 0 ? 'Pass' : 'Fail', actual: i === 0 ? '' : 'Spinner never stops' }));
    const res = (await api().post(`${X()}/manual-runs/${run.id}/results`).set(as('tester')).send({ testCaseId: tc.id, steps }).expect(201)).body;
    expect(res.status).toBe('Fail');
    await api().post(`${X()}/manual-runs/${run.id}/results/${res.id}/attachments`).set(as('tester')).attach('file', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' }).expect(400);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await api().post(`${X()}/manual-runs/${run.id}/results/${res.id}/attachments`).set(as('tester')).attach('file', png, { filename: 'evidence.png', contentType: 'image/png' }).expect(201);
    await api().post(`${X()}/manual-runs/${run.id}/complete`).set(as('tester')).expect(201);
    const got = (await api().get(`${X()}/runs/${run.id}`).set(as('tester'))).body;
    expect(got).toMatchObject({ status: 'Completed', failed: 1 });
    expect(got.results[0].attachments[0].kind).toBe('Manual');
    const updated = (await api().get(`${A()}/test-cases/${tc.id}`).set(as('tester'))).body;
    expect(updated).toMatchObject({ status: 'Fail', actualResult: expect.stringContaining('Spinner never stops') });
  });

  it('run history lists runs newest first', async () => {
    const runs = (await api().get(`${X()}/runs`).set(as('client')).expect(200)).body;
    expect(runs.length).toBe(4);
    expect(runs[0].kind).toBe('Manual');
  });
});
