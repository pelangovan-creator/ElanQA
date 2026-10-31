import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';

const fx = (f: string) => join(__dirname, 'fixtures', f);

describe('Phase 2 - requirement upload, zero-miss extraction, coverage, RTM', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projectId: string;
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const base = () => `/api/projects/${projectId}/requirements`;
  let docId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await hashPassword('Passw0rd!');
    const project = await prisma.project.create({ data: { key: 'REQT', name: 'Req test' } });
    projectId = project.id;
    for (const [k, role] of [['lead', 'QALead'], ['tester', 'Tester'], ['client', 'Client']]) {
      const u = await prisma.user.create({ data: { email: `${k}@req.local`, name: k, role, passwordHash: hash } });
      await prisma.projectMember.create({ data: { projectId, userId: u.id, role } });
      tok[k] = (await api().post('/api/auth/login').send({ email: `${k}@req.local`, password: 'Passw0rd!' })).body.token;
    }
  }, 30_000);
  afterAll(() => app.close());

  it('rejects uploads from view-only clients and unsupported/empty files', async () => {
    await api().post(`${base()}/documents`).set(as('client')).attach('file', fx('srs-v1.docx')).expect(403);
    await api().post(`${base()}/documents`).set(as('tester')).attach('file', Buffer.from('MZ'), 'virus.exe').expect(400);
    await api().post(`${base()}/documents`).set(as('tester')).field('title', 'x').expect(400);
  });

  it('uploads a DOCX SRS: every item extracted, reverse check passes, original stored unchanged', async () => {
    const res = await api().post(`${base()}/documents`).set(as('tester')).field('title', 'ShopEasy SRS').field('docType', 'SRS').attach('file', fx('srs-v1.docx')).expect(201);
    expect(res.body).toMatchObject({ version: 1, parseStatus: 'Parsed', itemCount: 31, reverseCheckOk: true, wordCountOriginal: 141, wordCountExtracted: 141 });
    expect(res.body.reverseCheck.missing).toEqual([]);
    docId = res.body.document.id;
    const orig = await api().get(`${base()}/versions/${res.body.id}/original`).set(as('client')).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const { readFileSync } = await import('node:fs');
    expect(Buffer.compare(orig.body, readFileSync(fx('srs-v1.docx')))).toBe(0);
  });

  it('lists atomic items with IDs, kinds, sections and categories', async () => {
    const res = await api().get(`${base()}/items?take=100`).set(as('client')).expect(200);
    expect(res.body.total).toBe(31);
    const byText = (t: string) => res.body.items.find((i: any) => i.text === t);
    expect(byText('The account must be locked after 3 consecutive failed login attempts.')).toMatchObject({ reqId: 'REQ-005.02', sourceKind: 'Sentence', section: '2', category: 'Functional' });
    expect(byText('16 digits, Luhn check')).toMatchObject({ sourceKind: 'TableCell', category: 'Validation', parentReqId: 'REQ-010.03' });
    expect(byText('Social login is out of scope for this release')).toMatchObject({ category: 'OutOfScope', coverageStatus: 'Unmapped' });
    expect(byText('2 Login')).toMatchObject({ sourceKind: 'Header', coverageStatus: 'Informational' });
    expect(byText('The login page should load fast on mobile devices.').ambiguousTerms).toEqual(['should', 'fast/quick']);
  });

  it('turns ambiguous words into clarification questions', async () => {
    const res = await api().get(`${base()}/questions`).set(as('tester')).expect(200);
    const qs = res.body.map((q: any) => `${q.requirement?.reqId}: ${q.question}`);
    expect(qs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^REQ-005\.03: .*"should"/),
      expect.stringMatching(/^REQ-005\.03: .*speed term/),
      expect.stringMatching(/^REQ-012\.03: .*TBD/),
    ]));
    expect(res.body[0]).toMatchObject({ qId: 'Q-001', category: 'Ambiguity', status: 'Open', aiGenerated: true, reviewStatus: 'PendingReview' });
  });

  it('coverage: unmapped list, reasons required, QA Lead-only acknowledgement, suggestions', async () => {
    let cov = (await api().get(`${base()}/coverage`).set(as('client')).expect(200)).body;
    expect(cov).toMatchObject({ total: 31, covered: 0, complete: false });
    expect(cov.unmappedItems.length).toBe(cov.unmapped);
    const item = cov.unmappedItems.find((i: any) => i.reqId === 'REQ-005.02');
    await api().post(`${base()}/items/${item.id}/coverage`).set(as('tester')).send({ status: 'Informational' }).expect(400);
    await api().post(`${base()}/items/${item.id}/coverage`).set(as('tester')).send({ status: 'Acknowledged', reason: 'later' }).expect(403);
    await api().post(`${base()}/items/${item.id}/coverage`).set(as('lead')).send({ status: 'Acknowledged', reason: 'Lockout tested in security phase' }).expect(201);
    const acc = (await api().post(`${base()}/coverage/accept-suggestions`).set(as('tester')).expect(201)).body;
    expect(acc.updated).toBeGreaterThan(0);
    cov = (await api().get(`${base()}/coverage`).set(as('client')).expect(200)).body;
    expect(cov.acknowledged).toBe(1);
    expect(cov.suggestions).toBe(0);
    expect(cov.coveragePercent).toBeGreaterThan(0);
  });

  it('item text is immutable; category can be corrected and is audited', async () => {
    const items = (await api().get(`${base()}/items?q=Razorpay`).set(as('tester'))).body.items;
    await api().patch(`${base()}/items/${items[0].id}`).set(as('tester')).send({ text: 'changed' }).expect(400);
    const r = await api().patch(`${base()}/items/${items[0].id}`).set(as('tester')).send({ category: 'Functional' }).expect(200);
    expect(r.body.category).toBe('Functional');
    expect(await prisma.auditLog.count({ where: { projectId, entityType: 'RequirementItem' } })).toBe(1);
  });

  it('new version: diff (added/modified/removed), IDs kept, links migrated, impacted test cases flagged', async () => {
    // Simulate a test case linked to the lockout requirement and one linked to the Razorpay sentence.
    const lock = await prisma.requirementItem.findFirstOrThrow({ where: { projectId, isCurrent: true, reqId: 'REQ-005.02' } });
    const pay = await prisma.requirementItem.findFirstOrThrow({ where: { projectId, isCurrent: true, text: { contains: 'Razorpay' } } });
    const tcLock = await prisma.testCase.create({ data: { projectId, tcId: 'TC-0001', module: 'Login', title: 'Lockout', steps: '[]', testType: 'Functional', technique: 'BVA', requirements: { create: { requirementId: lock.id } } } });
    const tcPay = await prisma.testCase.create({ data: { projectId, tcId: 'TC-0002', module: 'Checkout', title: 'Pay', steps: '[]', testType: 'Functional', technique: 'UseCase', requirements: { create: { requirementId: pay.id } } } });

    await api().post(`${base()}/documents/${docId}/versions`).set(as('tester')).attach('file', fx('srs-v1.docx')).expect(409);
    const res = await api().post(`${base()}/documents/${docId}/versions`).set(as('tester')).attach('file', fx('srs-v2.docx')).expect(201);
    expect(res.body).toMatchObject({ version: 2, parseStatus: 'Parsed', reverseCheckOk: true });
    const d = res.body.diff;
    expect(d.modified).toEqual([expect.objectContaining({ reqId: 'REQ-005.02', oldText: expect.stringContaining('3 consecutive'), newText: expect.stringContaining('5 consecutive') })]);
    expect(d.added.map((a: any) => a.text)).toEqual(['An OTP shall be sent by SMS for new devices.']);
    expect(d.removed.map((a: any) => a.text)).toEqual(['Social login is out of scope for this release']);
    expect(d.impactedTestCases).toEqual(['TC-0001']);

    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: tcLock.id } })).needsRegeneration).toBe(true);
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: tcPay.id } })).needsRegeneration).toBe(false);
    const current = await prisma.requirementItem.findMany({ where: { projectId, isCurrent: true } });
    expect(current.every((i) => i.versionId === res.body.id)).toBe(true);
    const newPay = current.find((i) => i.text.includes('Razorpay'))!;
    expect(newPay.reqId).toBe(pay.reqId);
    expect(newPay.coverageStatus).toBe('Covered'); // link migrated to the new version
    // Only new/modified items raise new questions.
    const qs = await prisma.clarificationQuestion.findMany({ where: { projectId, requirement: { versionId: res.body.id } } });
    expect(qs.length).toBeGreaterThan(0);
  });

  it('RTM is live and exportable as XLSX and CSV', async () => {
    const rtm = (await api().get(`${base()}/rtm`).set(as('client')).expect(200)).body;
    const pay = rtm.find((r: any) => r.text.includes('Razorpay'));
    expect(pay).toMatchObject({ testCaseIds: ['TC-0002'], executionStatus: 'Not Run', coverageStatus: 'Covered' });
    const xlsx = await api().get(`${base()}/rtm/export?format=xlsx`).set(as('client')).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.getWorksheet('RTM')!.rowCount).toBe(rtm.length + 1);
    const csv = await api().get(`${base()}/rtm/export?format=csv`).set(as('client')).expect(200);
    expect(csv.text.split('\r\n')[0]).toContain('Requirement ID');
  });

  it.each([
    ['login-checkout.pdf', false],
    ['user-stories.xlsx', false],
    ['search.md', false],
    ['stories.csv', false],
    ['email.txt', false],
    ['scanned-login.pdf', true],
  ])('parses %s with a passing reverse check', async (file, ocr) => {
    const res = await api().post(`${base()}/documents`).set(as('tester')).attach('file', fx(file)).expect(201);
    expect(res.body).toMatchObject({ parseStatus: 'Parsed', reverseCheckOk: true, ocrUsed: ocr });
    expect(res.body.wordCountExtracted).toBe(res.body.wordCountOriginal);
  }, 60_000);
});
