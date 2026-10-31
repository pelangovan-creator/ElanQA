import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';

const binary = (r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };

describe('Phase 3 - test artefacts: clarifications, design, data, plan, review, exports', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projectId: string;
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const A = () => `/api/projects/${projectId}/artefacts`;
  const R = () => `/api/projects/${projectId}/requirements`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await hashPassword('Passw0rd!');
    projectId = (await prisma.project.create({ data: { key: 'ART', name: 'Artefact test', client: 'Acme' } })).id;
    for (const [k, role] of [['lead', 'QALead'], ['tester', 'Tester'], ['dev', 'Developer'], ['client', 'Client']]) {
      const u = await prisma.user.create({ data: { email: `${k}@art.local`, name: k, role, passwordHash: hash } });
      await prisma.projectMember.create({ data: { projectId, userId: u.id, role } });
      tok[k] = (await api().post('/api/auth/login').send({ email: `${k}@art.local`, password: 'Passw0rd!' })).body.token;
    }
    await api().post(`${R()}/documents`).set(as('tester')).field('title', 'SRS').attach('file', join(__dirname, 'fixtures', 'srs-v1.docx')).expect(201);
  }, 60_000);
  afterAll(() => app.close());

  it('detects gaps (and never duplicates them)', async () => {
    const r1 = (await api().post(`${A()}/clarifications/detect`).set(as('tester')).expect(201)).body;
    expect(r1.gaps).toBeGreaterThan(3);
    const qs = (await api().get(`${A()}/clarifications`).set(as('client')).expect(200)).body;
    const texts = qs.map((q: any) => q.question).join('\n');
    expect(texts).toMatch(/locked account unlocked/);
    expect(texts).toMatch(/error message/);
    expect(texts).toMatch(/user roles/);
    expect(texts).toMatch(/payment is declined/);
    const r2 = (await api().post(`${A()}/clarifications/detect`).set(as('tester')).expect(201)).body;
    expect(r2.created).toBe(0);
  });

  it('client is view-only; developer cannot edit artefacts', async () => {
    await api().post(`${A()}/clarifications`).set(as('client')).send({ question: 'Can I edit?' }).expect(403);
    await api().post(`${A()}/design/generate`).set(as('dev')).send({}).expect(403);
  });

  it('generates scenarios, test cases (tagged with techniques) and test data; coverage reaches 100%', async () => {
    const res = (await api().post(`${A()}/design/generate`).set(as('tester')).send({}).expect(201)).body;
    expect(res).toMatchObject({ ai: false });
    expect(res.testCases).toBeGreaterThan(20);
    const tcs = (await api().get(`${A()}/test-cases`).set(as('client')).expect(200)).body;
    const techniques = new Set(tcs.map((t: any) => t.technique));
    for (const t of ['EquivalencePartitioning', 'BoundaryValueAnalysis', 'StateTransition', 'UseCase', 'ErrorGuessing']) expect(techniques).toContain(t);
    expect(tcs.every((t: any) => t.steps.length > 0 && t.requirements.length > 0 && t.aiGenerated && t.reviewStatus === 'PendingReview')).toBe(true);
    expect(tcs.some((t: any) => t.testType === 'EndToEnd')).toBe(true);
    const bva = tcs.find((t: any) => t.title.includes('outside the boundaries') && t.module === 'Login');
    expect(bva.testDataRef).toMatch(/^TD-/);

    // Generating again creates nothing new: everything testable is covered.
    expect((await api().post(`${A()}/design/generate`).set(as('tester')).send({}).expect(201)).body.testCases).toBe(0);

    await api().post(`${R()}/coverage/accept-suggestions`).set(as('tester')).expect(201);
    const cov = (await api().get(`${R()}/coverage`).set(as('client')).expect(200)).body;
    expect(cov.unmappedItems).toEqual([]);
    expect(cov).toMatchObject({ unmapped: 0, complete: true, coveragePercent: 100 });

    const data = (await api().get(`${A()}/test-data`).set(as('tester')).expect(200)).body;
    const pw = data.find((d: any) => d.fieldName === 'Password' && d.boundaryValues);
    expect(pw.boundaryValues.minMinus1).toContain('(7 chars)');
    expect(data.filter((d: any) => d.dataType === 'Account')).toHaveLength(5);
    expect(JSON.stringify(data)).not.toMatch(/@(gmail|yahoo|hotmail)\./);
  });

  it('review workflow: approve, reject needs a comment, editing sends it back for review, history kept', async () => {
    const tcs = (await api().get(`${A()}/test-cases`).set(as('tester'))).body;
    const [a, b] = tcs;
    await api().post(`${A()}/review`).set(as('tester')).send({ entityType: 'TestCase', ids: [a.id], action: 'Approve' }).expect(403);
    await api().post(`${A()}/review`).set(as('lead')).send({ entityType: 'TestCase', ids: [b.id], action: 'Reject' }).expect(400);
    await api().post(`${A()}/review`).set(as('lead')).send({ entityType: 'TestCase', ids: [a.id], action: 'Approve' }).expect(201);
    await api().post(`${A()}/review`).set(as('lead')).send({ entityType: 'TestCase', ids: [b.id], action: 'Reject', comment: 'Add negative step' }).expect(201);
    let got = (await api().get(`${A()}/test-cases/${b.id}`).set(as('tester'))).body;
    expect(got).toMatchObject({ reviewStatus: 'Rejected', reviewComment: 'Add negative step' });
    const upd = (await api().patch(`${A()}/test-cases/${a.id}`).set(as('tester')).send({ steps: [...a.steps, { action: 'Log out', expected: 'Login page shown' }] }).expect(200)).body;
    expect(upd.reviewStatus).toBe('PendingReview');
    expect(upd.steps).toHaveLength(a.steps.length + 1);
    const hist = (await api().get(`${A()}/review/TestCase/${a.id}`).set(as('client')).expect(200)).body;
    expect(hist[0]).toMatchObject({ action: 'Approve', userName: 'lead' });
    await api().patch(`${A()}/test-cases/${a.id}`).set(as('tester')).send({ technique: 'MadeUp' }).expect(400);
  });

  it('answering a clarification flags linked test cases; regenerate replaces machine-generated ones', async () => {
    const qs = (await api().get(`${A()}/clarifications`).set(as('tester'))).body;
    const q = qs.find((x: any) => x.requirement?.reqId === 'REQ-005.03');
    const res = (await api().patch(`${A()}/clarifications/${q.id}`).set(as('tester')).send({ clientAnswer: 'Under 2 seconds on 4G for 200 users' }).expect(200)).body;
    expect(res.question).toMatchObject({ status: 'Answered' });
    expect(res.affectedTestCases.length).toBeGreaterThan(0);
    const flagged = (await api().get(`${A()}/test-cases?regen=true`).set(as('tester'))).body;
    expect(flagged.map((t: any) => t.tcId).sort()).toEqual([...res.affectedTestCases].sort());
    const regen = (await api().post(`${A()}/design/regenerate`).set(as('tester')).send({}).expect(201)).body;
    expect(regen.replaced).toBe(flagged.length);
    expect(regen.generated).toBeGreaterThan(0);
    expect((await api().get(`${A()}/test-cases?regen=true`).set(as('tester'))).body).toEqual([]);
    expect((await api().get(`${R()}/coverage`).set(as('client'))).body.complete).toBe(true);
  });

  it('test plan and techniques document: generate, edit section, version and review', async () => {
    const plan = (await api().post(`${A()}/docs/TestPlan/generate`).set(as('tester')).expect(201)).body;
    const keys = plan.content.sections.map((s: any) => s.heading);
    for (const h of ['Document control & version history', 'Scope (in scope / out of scope)', 'Entry criteria', 'Exit criteria', 'Suspension & resumption criteria', 'Roles & responsibilities (RACI)', 'Defect management process', 'Risks & mitigation', 'Approvals / sign-off']) expect(keys).toContain(h);
    expect(plan.content.sections.find((s: any) => s.key === 'scope').body).toContain('Social login is out of scope');
    const edited = (await api().patch(`${A()}/docs/TestPlan/sections/schedule`).set(as('tester')).send({ body: 'Cycle 1: 3–14 Nov' }).expect(200)).body;
    expect(edited.content.sections.find((s: any) => s.key === 'schedule').body).toBe('Cycle 1: 3–14 Nov');
    const v2 = (await api().post(`${A()}/docs/TestPlan/generate`).set(as('tester')).expect(201)).body;
    expect(v2.version).toBe(2);
    const tech = (await api().post(`${A()}/docs/TestTechniques/generate`).set(as('tester')).expect(201)).body;
    const bvaSection = tech.content.sections.find((s: any) => s.key === 'tech-BoundaryValueAnalysis');
    expect(bvaSection.body).toMatch(/TC-\d{4}/);
    await api().get(`${A()}/docs/Nope`).set(as('tester')).expect(400);
  });

  it.each(['clarifications', 'scenarios', 'test-cases', 'test-data', 'docs/TestPlan', 'docs/TestTechniques'])('exports %s as xlsx, pdf and docx', async (what) => {
    const x = await api().get(`${A()}/${what}/export?format=xlsx`).set(as('client')).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.worksheets.length).toBeGreaterThan(0);
    const pdf = await api().get(`${A()}/${what}/export?format=pdf`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const docx = await api().get(`${A()}/${what}/export?format=docx`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(docx.body.subarray(0, 2).toString()).toBe('PK');
    await api().get(`${A()}/${what}/export?format=exe`).set(as('client')).expect(400);
  }, 60_000);

  it('test data export has a TestData sheet with boundary columns for data-driven automation', async () => {
    const x = await api().get(`${A()}/test-data/export?format=xlsx`).set(as('client')).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const ws = wb.getWorksheet('TestData')!;
    expect((ws.getRow(1).values as string[]).filter(Boolean)).toEqual(expect.arrayContaining(['Data ID', 'Field Name', 'min-1', 'max+1', 'Expected Behaviour']));
    expect(wb.getWorksheet('Accounts')!.rowCount).toBe(6);
  });
});
