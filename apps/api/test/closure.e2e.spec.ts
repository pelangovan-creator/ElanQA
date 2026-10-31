import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';
import { riskLevel } from '../src/reports/closure.service';

const binary = (r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };

describe('Phase 9 - Test Closure Report', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let p1: string; // open defects
  let p2: string; // only a minor open defect
  let p3: string; // everything closed
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const CL = (p: string) => `/api/projects/${p}/closure`;
  const ids: Record<string, string> = {};

  async function seedProject(key: string, defects: Record<string, unknown>[], statuses = ['Pass', 'Pass', 'Fail', 'NotRun']) {
    const projectId = (await prisma.project.create({ data: { key, name: `Shop ${key}`, client: 'Acme', status: 'Active' } })).id;
    for (const [k, role] of [['lead', 'QALead'], ['tester', 'Tester'], ['client', 'Client']]) await prisma.projectMember.create({ data: { projectId, userId: ids[k], role } });
    for (const [i, status] of statuses.entries()) await prisma.testCase.create({ data: { projectId, tcId: `TC-000${i + 1}`, module: 'Checkout', title: `Case ${i + 1}`, steps: '[]', testType: i % 2 ? 'Security' : 'Functional', technique: i % 2 ? 'ErrorGuessing' : 'BoundaryValueAnalysis', status } });
    for (const [i, d] of defects.entries()) ids[`${key}-d${i + 1}`] = (await prisma.defect.create({ data: { projectId, defectId: `DEF-000${i + 1}`, title: `Defect ${i + 1}`, defectType: 'Functional', module: 'Checkout', severity: 'Major', priority: 'P3', status: 'Open', ...d } as never })).id;
    return projectId;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await hashPassword('Passw0rd!');
    for (const [k, role] of [['lead', 'QALead'], ['tester', 'Tester'], ['client', 'Client']]) {
      ids[k] = (await prisma.user.create({ data: { email: `${k}@cl.local`, name: `${k} user`, role, passwordHash: hash } })).id;
      tok[k] = (await api().post('/api/auth/login').send({ email: `${k}@cl.local`, password: 'Passw0rd!' })).body.token;
    }
    p1 = await seedProject('CLA', [
      { title: 'Payment declined for valid card', severity: 'Blocker', priority: 'P1', status: 'Assigned', assignedTo: 'dev' },
      { title: 'Discount rounding', severity: 'Major', priority: 'P3', status: 'Verified' },
      { title: 'Old crash', severity: 'Critical', priority: 'P1', status: 'Closed' },
      { title: 'Draft from run', severity: 'Minor', priority: 'P3', status: 'New', isDraft: true },
    ]);
    await prisma.artefact.create({ data: { projectId: p1, type: 'TestPlan', title: 'Test Plan', content: JSON.stringify({ sections: [{ key: 'intro', body: 'Verify checkout end to end.' }, { key: 'scope', body: 'In scope:\n- Checkout\n- Login\nOut of scope:\n- Social login' }] }) } });
    p2 = await seedProject('CLB', [{ severity: 'Minor', priority: 'P4', status: 'Deferred' }, { severity: 'Critical', priority: 'P1', status: 'Closed' }]);
    p3 = await seedProject('CLC', [{ status: 'Closed' }, { status: 'Rejected' }], ['Pass', 'Pass', 'Pass']);
  }, 30_000);
  afterAll(() => app.close());

  it('risk matrix', () => {
    expect(riskLevel('High', 'High')).toBe('High');
    expect(riskLevel('High', 'Medium')).toBe('High');
    expect(riskLevel('High', 'Low')).toBe('Medium');
    expect(riskLevel('Medium', 'Medium')).toBe('Medium');
    expect(riskLevel('Low', 'Medium')).toBe('Low');
  });

  it('eligibility: drafts, deferred and verified-but-not-closed defects count as open', async () => {
    const e = (await api().get(`${CL(p1)}/eligibility`).set(as('client')).expect(200)).body;
    expect(e).toMatchObject({ open: 3, openCritical: 1, drafts: 1 });
    expect(e.triggers.AllDefectsClosed.met).toBe(false);
    expect(e.triggers.CriticalClosed).toMatchObject({ met: false, detail: 'Still open: DEF-0001' });
    expect(e.triggers.ClientRequest.met).toBe(true);
    expect((await api().get(`${CL(p2)}/eligibility`).set(as('client'))).body.triggers.CriticalClosed.met).toBe(true);
    expect((await api().get(`${CL(p3)}/eligibility`).set(as('client'))).body.triggers.AllDefectsClosed.met).toBe(true);
  });

  let rep: any;
  it('(c) client request: conditions enforced, every open defect gets a risk row, NO-GO suggested for the Blocker', async () => {
    await api().post(CL(p1)).set(as('lead')).send({ trigger: 'AllDefectsClosed' }).expect(400);
    await api().post(CL(p1)).set(as('lead')).send({ trigger: 'CriticalClosed' }).expect(400);
    await api().post(CL(p1)).set(as('lead')).send({ trigger: 'ClientRequest', reason: 'short' }).expect(400);
    await api().post(CL(p1)).set(as('tester')).send({ trigger: 'ClientRequest', reason: 'Client wants to go live on Friday' }).expect(403);
    rep = (await api().post(CL(p1)).set(as('lead')).send({ trigger: 'ClientRequest', reason: 'Client wants to go live on Friday', release: '3.0.0' }).expect(201)).body;
    const c = rep.content;
    expect(rep.triggerLabel).toBe('(c) Closure requested by the client');
    expect(c.header).toMatchObject({ projectName: 'Shop CLA', release: '3.0.0', preparedBy: 'lead user' });
    expect(c.risks.map((r: any) => [r.defectId, r.businessImpact, r.likelihood, r.riskLevel, r.owner])).toEqual([
      ['DEF-0001', 'High', 'High', 'High', 'dev'], ['DEF-0002', 'Medium', 'Medium', 'Medium', 'QA Lead'], ['DEF-0004', 'Low', 'Medium', 'Low', 'QA Lead'],
    ]);
    expect(c.risks[2].isDraft).toBe(true);
    expect(c.recommendation).toMatchObject({ decision: 'NoGo', suggested: 'NoGo' });
    expect(c.recommendation.reason).toMatch(/1 open Blocker defect\(s\): DEF-0001/);
    expect(c.exitCriteria.map((x: any) => [x.key, x.met])).toEqual([['executed', false], ['passRate', false], ['noCritical', false], ['riskAssessed', false], ['rtm', true], ['questions', true]]);
    expect(c.narrative.scopeIn).toMatch(/Checkout/);
    expect(c.narrative.scopeOut).toMatch(/Social login/);
    expect(c.narrative.objectives).toBe('Verify checkout end to end.');
    expect(c.narrative.deviations).toMatch(/closed early at the client's request: Client wants to go live on Friday/);
    expect(c.extra.techniquesPerformed).toEqual(expect.arrayContaining([{ technique: 'BoundaryValueAnalysis', count: 2 }]));
    expect(c.signOff.map((s: any) => s.role)).toEqual(['QALead', 'PM', 'Client']);
  });

  it('risk assessment edits recompute risk levels, exit criteria and the suggestion; GO is refused while a High risk is open', async () => {
    const U = `${CL(p1)}/${rep.id}`;
    await api().patch(U).set(as('lead')).send({ risks: [{ id: ids['CLA-d1'], likelihood: 'Extreme' }] }).expect(400);
    await api().patch(U).set(as('lead')).send({ recommendation: { decision: 'Go' } }).expect(400);
    await api().post(`${U}/status`).set(as('lead')).send({ status: 'Final' }).expect(400); // workarounds missing
    const r = (await api().patch(U).set(as('lead')).send({
      risks: [
        { id: ids['CLA-d1'], workaround: 'Use the saved-card flow', likelihood: 'Low' },
        { id: ids['CLA-d2'], workaround: 'Prices rounded manually at invoicing' },
        { id: ids['CLA-d4'], workaround: 'Not reproducible manually', owner: 'tester user' },
      ],
      recommendation: { decision: 'ConditionalGo', reason: 'Client accepts the listed risks for go-live', conditions: '- Hot-fix DEF-0001 in week 1' },
      exitComments: { passRate: 'Agreed with client' },
    }).expect(200)).body;
    expect(r.content.risks[0].riskLevel).toBe('Medium'); // High impact × Low likelihood
    expect(r.content.exitCriteria.find((x: any) => x.key === 'riskAssessed').met).toBe(true);
    expect(r.content.exitCriteria.find((x: any) => x.key === 'passRate').comment).toBe('Agreed with client');
    expect(r.content.recommendation).toMatchObject({ decision: 'ConditionalGo', suggested: 'NoGo' }); // a Blocker is still open
  });

  it('refresh keeps edits, adds newly opened defects and drops closed ones', async () => {
    const U = `${CL(p1)}/${rep.id}`;
    await prisma.defect.update({ where: { id: ids['CLA-d2'] }, data: { status: 'Closed' } });
    await prisma.defect.create({ data: { projectId: p1, defectId: 'DEF-0005', title: 'New issue', severity: 'Minor', priority: 'P4', defectType: 'UI', status: 'New' } });
    const r = (await api().post(`${U}/refresh`).set(as('lead')).expect(201)).body;
    expect(r.content.risks.map((x: any) => x.defectId)).toEqual(['DEF-0001', 'DEF-0004', 'DEF-0005']);
    expect(r.content.risks[0].workaround).toBe('Use the saved-card flow');
    await api().post(`${U}/status`).set(as('lead')).send({ status: 'Final' }).expect(400); // DEF-0005 needs a workaround
    await api().patch(U).set(as('lead')).send({ risks: [{ id: r.content.risks[2].id, workaround: 'Cosmetic only' }] }).expect(200);
    await api().post(`${U}/status`).set(as('lead')).send({ status: 'Final' }).expect(201);
    await api().patch(U).set(as('lead')).send({ narrative: { lessonsLearned: 'late' } }).expect(400);
  });

  it('exports highlight the open-defect risk and carry the recommendation (PDF, Word, Excel, e-mail)', async () => {
    const U = `${CL(p1)}/${rep.id}`;
    const x = await api().get(`${U}/export?format=xlsx`).set(as('client')).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.getWorksheet('Risk assessment')!.rowCount).toBe(4);
    const ex = wb.getWorksheet('Exit criteria')!;
    const fills = [2, 3, 4].map((i) => (ex.getRow(i).fill as any)?.fgColor?.argb);
    expect(fills).toEqual(['FFFDE2E2', 'FFFDE2E2', 'FFFDE2E2']); // executed, pass rate, no critical: not met
    const summary = wb.getWorksheet('Summary')!.getSheetValues().flat().map(String).join('\n');
    expect(summary).toMatch(/Recommendation: CONDITIONAL GO · 3 defect\(s\) remain OPEN/);
    expect(summary).toMatch(/Closed on client request/);
    const pdf = await api().get(`${U}/export?format=pdf`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const docx = await api().get(`${U}/export?format=docx`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(docx.body.subarray(0, 2).toString()).toBe('PK');
    const eml = (await api().get(`${U}/export?format=eml`).set(as('client')).buffer(true).parse(binary).expect(200)).body.toString();
    const subject = Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(eml)![1], 'base64').toString();
    expect(subject).toBe('Test Closure Report – Shop CLA – CONDITIONAL GO');
  }, 60_000);

  it('sign-off: only on a final report; Client signs their own section; all three → Signed Off and project Closed', async () => {
    const U = `${CL(p1)}/${rep.id}`;
    await api().post(`${U}/sign`).set(as('client')).send({ role: 'PM', decision: 'Approved' }).expect(403);
    await api().post(`${U}/sign`).set(as('tester')).send({ role: 'QALead', decision: 'Approved' }).expect(403);
    await api().post(`${U}/sign`).set(as('client')).send({ role: 'Client', name: 'Someone Else', decision: 'Maybe' }).expect(400);
    const c1 = (await api().post(`${U}/sign`).set(as('client')).send({ role: 'Client', name: 'Someone Else', decision: 'ApprovedWithConditions', comment: 'Hot-fix in week 1' }).expect(201)).body;
    expect(c1.content.signOff[2]).toMatchObject({ name: 'client user', decision: 'ApprovedWithConditions' }); // clients sign as themselves
    await api().post(`${U}/sign`).set(as('client')).send({ role: 'Client', decision: 'Approved' }).expect(400); // already signed
    await api().post(`${U}/sign`).set(as('lead')).send({ role: 'QALead', decision: 'Approved' }).expect(201);
    const done = (await api().post(`${U}/sign`).set(as('lead')).send({ role: 'PM', name: 'Pat PM', decision: 'Approved' }).expect(201)).body;
    expect(done.status).toBe('SignedOff');
    expect(done.content.signOff.map((s: any) => s.name)).toEqual(['lead user', 'Pat PM', 'client user']);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p1 } })).status).toBe('Closed');
    await api().post(`${U}/status`).set(as('lead')).send({ status: 'Draft' }).expect(400);
    await api().delete(U).set(as('lead')).expect(400);
  });

  it('(b) all critical closed → Conditional Go for the remaining minor defect; (a) all closed → GO', async () => {
    const b = (await api().post(CL(p2)).set(as('lead')).send({ trigger: 'CriticalClosed' }).expect(201)).body;
    expect(b.content.risks.map((r: any) => r.defectId)).toEqual(['DEF-0001']);
    expect(b.content.recommendation.decision).toBe('ConditionalGo');
    const a = (await api().post(CL(p3)).set(as('lead')).send({ trigger: 'AllDefectsClosed' }).expect(201)).body;
    expect(a.content.risks).toEqual([]);
    expect(a.content.exitCriteria.every((x: any) => x.met)).toBe(true);
    expect(a.content.recommendation).toMatchObject({ decision: 'Go', reason: 'All exit criteria are met and no defects remain open.' });
    expect((await api().get(CL(p3)).set(as('client'))).body).toHaveLength(1);
  });
});
