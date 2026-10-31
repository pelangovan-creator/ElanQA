import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';

const binary = (r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };
const at = (iso: string) => new Date(iso);

describe('Phase 8 - DSR, WSR, Defect Report, dashboard', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projectId: string;
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const R = () => `/api/projects/${projectId}/reports`;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await hashPassword('Passw0rd!');
    projectId = (await prisma.project.create({ data: { key: 'REP', name: 'Reporting', client: 'Acme' } })).id;
    for (const [k, role] of [['lead', 'QALead'], ['tester', 'Tester'], ['client', 'Client']]) {
      const u = await prisma.user.create({ data: { email: `${k}@rep.local`, name: k, role, passwordHash: hash } });
      await prisma.projectMember.create({ data: { projectId, userId: u.id, role } });
      tok[k] = (await api().post('/api/auth/login').send({ email: `${k}@rep.local`, password: 'Passw0rd!' })).body.token;
    }
    const created = at('2026-09-01T05:00:00Z');
    // 6 test cases: 3 Pass, 1 Fail, 1 Blocked, 1 Not run (Login x3, Checkout x3)
    const statuses = ['Pass', 'Pass', 'Fail', 'Pass', 'Blocked', 'NotRun'];
    for (const [i, status] of statuses.entries()) {
      const tc = await prisma.testCase.create({ data: { projectId, tcId: `TC-000${i + 1}`, module: i < 3 ? 'Login' : 'Checkout', title: `Case ${i + 1}`, steps: '[]', testType: 'Functional', technique: 'UseCase', status, reviewStatus: i < 5 ? 'Approved' : 'PendingReview', createdAt: created } });
      ids[`tc${i + 1}`] = tc.id;
    }
    const run = await prisma.testRun.create({ data: { projectId, runId: 'RUN-0001', mode: 'All', kind: 'Automated', status: 'Completed', build: '2.1.0', passed: 3, failed: 1, blocked: 1, startedAt: at('2026-09-10T04:00:00Z'), createdAt: at('2026-09-10T04:00:00Z') } });
    // Results: 10 Sep IST (incl. 00:30 IST = 9 Sep 19:00Z), and one at 00:30 IST on 11 Sep that must NOT count for the 10th
    const res = (tc: string, status: string, iso: string, by = 'Automation (lead)') => prisma.testResult.create({ data: { runId: run.id, testCaseId: ids[tc], status, executedBy: by, createdAt: at(iso) } });
    await res('tc1', 'Pass', '2026-09-09T19:00:00Z');
    await res('tc2', 'Pass', '2026-09-10T05:00:00Z');
    await res('tc3', 'Fail', '2026-09-10T05:01:00Z');
    await res('tc4', 'Pass', '2026-09-10T06:00:00Z', 'tester');
    await res('tc5', 'Blocked', '2026-09-10T18:00:00Z', 'tester');
    await res('tc4', 'Pass', '2026-09-10T19:00:00Z'); // 11 Sep 00:30 IST
    const def = async (defectId: string, data: Record<string, unknown>) => (await prisma.defect.create({ data: { projectId, defectId, defectType: 'Functional', module: 'Login', ...data } as never })).id;
    ids.d1 = await def('DEF-0001', { title: 'Lockout broken', severity: 'Blocker', priority: 'P1', status: 'Assigned', assignedTo: 'dev', testCaseId: ids.tc3, reportedDate: at('2026-09-02T05:00:00Z'), createdAt: at('2026-09-02T05:00:00Z') });
    ids.d2 = await def('DEF-0002', { title: 'Total wrong', module: 'Checkout', severity: 'Major', priority: 'P3', status: 'Closed', reportedDate: at('2026-09-03T05:00:00Z'), closedDate: at('2026-09-10T08:00:00Z'), createdAt: at('2026-09-03T05:00:00Z') });
    ids.d3 = await def('DEF-0003', { title: 'Label typo', severity: 'Trivial', priority: 'P4', status: 'Rejected', reportedDate: at('2026-09-04T05:00:00Z'), closedDate: at('2026-09-05T05:00:00Z'), createdAt: at('2026-09-04T05:00:00Z') });
    ids.d4 = await def('DEF-0004', { title: 'Crash on pay', module: 'Checkout', severity: 'Critical', priority: 'P2', status: 'Reopened', reportedDate: at('2026-09-10T03:00:00Z'), createdAt: at('2026-09-10T03:00:00Z') });
    const hist = (defectId: string, fromValue: string | null, toValue: string, iso: string) => prisma.defectHistory.create({ data: { defectId, kind: 'StatusChange', fromValue, toValue, createdAt: at(iso) } });
    await hist(ids.d2, 'Verified', 'Closed', '2026-09-10T08:00:00Z');
    await hist(ids.d4, 'Retest', 'Reopened', '2026-09-10T09:00:00Z');
    await prisma.clarificationQuestion.create({ data: { projectId, qId: 'Q-001', question: 'What is the session timeout?', category: 'MissingInfo', priority: 'High', assignedTo: 'Client PM', raisedDate: at('2026-09-05T05:00:00Z') } });
  }, 30_000);
  afterAll(() => app.close());

  it('only QA Lead/Admin generate reports; clients can view', async () => {
    await api().post(R()).set(as('tester')).send({ type: 'DSR', date: '2026-09-10' }).expect(403);
    await api().post(R()).set(as('lead')).send({ type: 'Nope' }).expect(400);
    await api().get(R()).set(as('client')).expect(200);
  });

  let dsr: any;
  it('DSR: auto-filled from the day (IST boundaries), with narrative, highlights and charts', async () => {
    dsr = (await api().post(R()).set(as('lead')).send({ type: 'DSR', date: '2026-09-10' }).expect(201)).body;
    const c = dsr.content;
    expect(c.header).toMatchObject({ projectName: 'Reporting', client: 'Acme', reportDate: '2026-09-10', build: '2.1.0', preparedBy: 'lead' });
    expect(c.data.execution).toMatchObject({ totalTcs: 6, executed: 5, passed: 3, failed: 1, blocked: 1, notRun: 1, executionPct: 83.3, passPct: 60, executedInPeriod: 5, passedInPeriod: 3, failedInPeriod: 1, blockedInPeriod: 1 });
    expect(c.data.defects).toMatchObject({ newInPeriod: 1, closedInPeriod: 1, reopenedInPeriod: 1, open: 2 });
    expect(c.data.defects.critical.map((d: any) => d.defectId)).toEqual(['DEF-0001', 'DEF-0004']);
    expect(c.data.testers).toEqual([{ name: 'Automation (lead)', executed: 3, passed: 2, failed: 1, blocked: 0 }, { name: 'tester', executed: 2, passed: 1, failed: 0, blocked: 1 }]);
    expect(c.data.openQuestions[0]).toMatchObject({ qId: 'Q-001', assignedTo: 'Client PM' });
    expect(c.narrative.tasksCompleted).toMatch(/RUN-0001 .*3 pass, 1 fail, 1 blocked/);
    expect(c.narrative.tasksPlanned).toMatch(/Execute the remaining 1 test case/);
    expect(c.narrative.blockers).toMatch(/DEF-0001 Lockout broken \(dev/);
    expect(Object.keys(dsr.charts)).toEqual(['exec', 'sev', 'pri']);
    expect(dsr.charts.exec).toMatch(/^<svg[^>]+role="img"[^>]+aria-label="Test case status"/);
    expect(dsr.charts.exec).toContain('<title>Pass: 3 (50%)</title>');
  });

  it('editing: only known fields, numbers validated, locked once final; Draft → Final → Sent', async () => {
    await api().patch(`${R()}/${dsr.id}`).set(as('lead')).send({ narrative: { hacked: 'x' } }).expect(400);
    await api().patch(`${R()}/${dsr.id}`).set(as('lead')).send({ narrative: { downtimeHours: 'two' } }).expect(400);
    const ok = (await api().patch(`${R()}/${dsr.id}`).set(as('lead')).send({ header: { sprint: 'Sprint 14' }, narrative: { downtimeHours: '1.5', comments: 'Build 2.1.0 deployed at 10:00' } }).expect(200)).body;
    expect(ok.content.header.sprint).toBe('Sprint 14');
    await api().patch(`${R()}/${dsr.id}`).set(as('client')).send({ narrative: { comments: 'x' } }).expect(403);
    await api().post(`${R()}/${dsr.id}/status`).set(as('lead')).send({ status: 'Sent' }).expect(400);
    await api().post(`${R()}/${dsr.id}/status`).set(as('lead')).send({ status: 'Final' }).expect(201);
    await api().patch(`${R()}/${dsr.id}`).set(as('lead')).send({ narrative: { comments: 'late edit' } }).expect(400);
    await api().delete(`${R()}/${dsr.id}`).set(as('lead')).expect(400);
  });

  it('exports: PDF, Word (charts embedded), Excel (critical rows red), e-mail draft (.eml with PDF attached)', async () => {
    const pdf = await api().get(`${R()}/${dsr.id}/export?format=pdf`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const docx = await api().get(`${R()}/${dsr.id}/export?format=docx`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(Object.keys((await JSZip.loadAsync(docx.body)).files).filter((f) => f.startsWith('word/media/')).length).toBe(3);
    const x = await api().get(`${R()}/${dsr.id}/export?format=xlsx`).set(as('client')).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect((wb.getWorksheet('Critical')!.getRow(2).fill as any).fgColor.argb).toBe('FFFDE2E2');
    expect(wb.getWorksheet('Open questions')!.rowCount).toBe(2);
    const eml = (await api().get(`${R()}/${dsr.id}/export?format=eml`).set(as('client')).buffer(true).parse(binary).expect(200));
    expect(eml.headers['content-type']).toMatch(/message\/rfc822/);
    const text = eml.body.toString();
    expect(text).toMatch(/^X-Unsent: 1\r\n/);
    expect(text).toMatch(/Content-Type: multipart\/mixed/);
    expect(text).toMatch(/Content-Disposition: attachment; filename="DSR-2026-09-10\.pdf"/);
    const html = Buffer.from(/text\/html[\s\S]*?\r\n\r\n([\s\S]*?)\r\n\r\n--/.exec(text)![1].replace(/\r\n/g, ''), 'base64').toString();
    expect(html).toContain('DEF-0001 Lockout broken');
    await api().post(`${R()}/${dsr.id}/status`).set(as('lead')).send({ status: 'Sent' }).expect(201);
    await api().post(`${R()}/${dsr.id}/status`).set(as('lead')).send({ status: 'Draft' }).expect(400);
  }, 60_000);

  it('WSR: RAG suggestion with reason, density, weekly trend, client action items', async () => {
    const w = (await api().post(R()).set(as('lead')).send({ type: 'WSR', to: '2026-09-10' }).expect(201)).body;
    expect(w.content.header).toMatchObject({ weekFrom: '2026-09-04', weekTo: '2026-09-10' });
    expect(w.content.narrative).toMatchObject({ ragStatus: 'Red', ragReason: 'Open Blocker defect(s)' });
    expect(w.content.narrative.clientActionItems).toMatch(/Q-001 \(High, Client PM\)/);
    expect(w.content.data.moduleDensity).toEqual(expect.arrayContaining([{ module: 'Login', testCases: 3, defects: 1, density: 0.33 }]));
    expect(w.content.data.trends.weekly).toHaveLength(6);
    expect(w.content.data.trends.weekly[5]).toMatchObject({ week: '09-10', passed: 3, failed: 1, blocked: 1 });
    expect(Object.keys(w.charts)).toEqual(['weekly', 'trend', 'burndown', 'sev', 'modules', 'ageing']);
    await api().patch(`${R()}/${w.id}`).set(as('lead')).send({ narrative: { ragStatus: 'Purple' } }).expect(400);
    // refresh keeps edits and picks up new data
    await api().patch(`${R()}/${w.id}`).set(as('lead')).send({ narrative: { comments: 'kept' } }).expect(200);
    await prisma.defect.create({ data: { projectId, defectId: 'DEF-0005', title: 'New one', severity: 'Minor', priority: 'P3', defectType: 'UI', status: 'New', reportedDate: at('2026-09-08T05:00:00Z'), createdAt: at('2026-09-08T05:00:00Z') } });
    const fresh = (await api().post(`${R()}/${w.id}/refresh`).set(as('lead')).expect(201)).body;
    expect(fresh.content.narrative.comments).toBe('kept');
    expect(fresh.content.data.defects.newInPeriod).toBe(w.content.data.defects.newInPeriod + 1);
  });

  it('Defect Report: rates, ageing buckets, leakage from UAT/production counts, full list', async () => {
    const d = (await api().post(R()).set(as('lead')).send({ type: 'DefectReport', from: '2026-09-01', to: '2026-09-10' }).expect(201)).body;
    const df = d.content.data.defects;
    expect(df).toMatchObject({ total: 5, reopenRate: 20, rejectionRate: 20 });
    expect(df.byAssignee).toMatchObject({ dev: 1, Unassigned: 2 });
    expect(df.list.map((x: any) => x.defectId)).toEqual(['DEF-0001', 'DEF-0002', 'DEF-0003', 'DEF-0004', 'DEF-0005']);
    expect(Object.values(df.ageing).reduce((a: number, b: any) => a + b, 0)).toBe(3);
    expect(d.derived.leakagePct).toBeNull();
    const withLeak = (await api().patch(`${R()}/${d.id}`).set(as('lead')).send({ narrative: { uatDefects: '1', prodDefects: '0' } }).expect(200)).body;
    expect(withLeak.derived.leakagePct).toBe(16.7); // 1 / (5 + 1)
    const pdf = await api().get(`${R()}/${d.id}/export?format=pdf`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const list = (await api().get(`${R()}?type=DefectReport`).set(as('client'))).body;
    expect(list).toHaveLength(1);
    await api().delete(`${R()}/${d.id}`).set(as('lead')).expect(200);
  }, 60_000);

  it('dashboard: KPIs and charts for the last N days', async () => {
    const dash = (await api().get(`${R()}/dashboard?days=30`).set(as('client')).expect(200)).body;
    expect(dash.data.execution).toMatchObject({ totalTcs: 6, executionPct: 83.3, passPct: 60 });
    expect(dash.data.coverage).toHaveProperty('percent');
    expect(Object.keys(dash.charts)).toEqual(['exec', 'rtm', 'sev', 'pri', 'burndown', 'trend']);
    expect(dash.data.trends.daily).toHaveLength(30);
  });
});
