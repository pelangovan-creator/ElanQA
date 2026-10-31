import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'node:http';
import { join } from 'node:path';
import JSZip from 'jszip';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app: demoApp } = require('../../demo/server.js');
const binary = (r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Phase 5 - defect management: auto-creation with evidence, duplicates, life cycle, retest, exports', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let demo: Server;
  let projectId: string;
  let envId: string;
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const D = () => `/api/projects/${projectId}/defects`;
  const X = () => `/api/projects/${projectId}/execution`;
  const A = () => `/api/projects/${projectId}/artefacts`;
  const tcByTitle = async (q: string) => (await api().get(`${A()}/test-cases?q=${encodeURIComponent(q)}`).set(as('tester'))).body[0];

  async function run(body: Record<string, unknown>) {
    const r = (await api().post(`${X()}/runs`).set(as('tester')).send({ environmentId: envId, ...body }).expect(201)).body;
    for (let i = 0; i < 180; i++) {
      const s = (await api().get(`${X()}/runs/${r.id}`).set(as('tester'))).body;
      if (['Completed', 'Aborted', 'Error'].includes(s.status)) return s;
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error('run timeout');
  }

  beforeAll(async () => {
    demo = demoApp.listen(0);
    const demoUrl = `http://localhost:${(demo.address() as any).port}`;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await hashPassword('Passw0rd!');
    projectId = (await prisma.project.create({ data: { key: 'DEF', name: 'ShopEasy defects', client: 'Demo' } })).id;
    for (const [k, role] of [['lead', 'QALead'], ['tester', 'Tester'], ['dev', 'Developer'], ['client', 'Client']]) {
      const u = await prisma.user.create({ data: { email: `${k}@def.local`, name: k, role, passwordHash: hash } });
      await prisma.projectMember.create({ data: { projectId, userId: u.id, role } });
      tok[k] = (await api().post('/api/auth/login').send({ email: `${k}@def.local`, password: 'Passw0rd!' })).body.token;
    }
    await api().post(`/api/projects/${projectId}/requirements/documents`).set(as('tester')).attach('file', join(__dirname, '..', '..', 'demo', 'docs', 'demo-srs.md')).expect(201);
    await api().post(`${A()}/design/generate`).set(as('tester')).send({}).expect(201);
    const ids = (await api().get(`${A()}/test-cases`).set(as('lead'))).body.map((t: any) => t.id);
    await api().post(`${A()}/review`).set(as('lead')).send({ entityType: 'TestCase', ids, action: 'Approve' }).expect(201);
    envId = (await api().post(`${X()}/environments`).set(as('tester')).send({ name: 'QA', baseUrl: demoUrl, browsers: ['chromium'], workers: 4, credentials: { Tester: { username: 'qapilot.tester@example.com', password: 'Demo!2345' } } }).expect(201)).body.id;
    await api().post(`${X()}/scripts/generate`).set(as('tester')).send({ environmentId: envId }).expect(201);
  }, 120_000);
  afterAll(async () => { await app.close(); demo.close(); });

  let drafts: any[] = [];

  it('every failed test produces one draft defect with all evidence and filled-in fields', async () => {
    const done = await run({ mode: 'All', build: '1.0.0' });
    expect(done.failed).toBe(5);
    expect(done.log).toMatch(/Defects: 5 draft\(s\) created/);
    drafts = (await api().get(`${D()}?draft=true`).set(as('tester')).expect(200)).body;
    expect(drafts).toHaveLength(5);
    for (const d of drafts) {
      expect(d).toMatchObject({ isDraft: true, status: 'New', testRunId: done.runId, build: '1.0.0', hasScreenshot: true });
      expect(d.attachments.map((a: any) => a.kind)).toEqual(expect.arrayContaining(['FailureScreenshot', 'FullPageScreenshot', 'AnnotatedScreenshot', 'Video', 'Trace', 'ConsoleLog', 'NetworkLog']));
    }
    const lock = drafts.find((d: any) => /after 3 failed attempts/.test(d.title));
    const full = (await api().get(`${D()}/${lock.id}`).set(as('tester'))).body;
    expect(full).toMatchObject({ module: 'Login', requirementId: expect.stringContaining('REQ-'), environment: expect.stringContaining('QA (QA)'), defectType: 'Functional', severity: 'Critical', priority: 'P1' });
    expect(full.title).toMatch(/^\[Login\] .* – fails at: failed attempt 3: account becomes locked/);
    expect(full.stepsToReproduce).toMatch(/^1\. /);
    expect(full.actualResult).toMatch(/locked/i);
    expect(full.browserDeviceOs).toMatch(/^chromium · 1366x768 · /);
    // Not visible in the confirmed defect list until reviewed.
    expect((await api().get(D()).set(as('tester'))).body).toEqual([]);
  }, 240_000);

  it('similar failures are suggested as duplicates; linking moves the evidence instead of creating a new defect', async () => {
    const ep = drafts.find((d: any) => /Password: reject values/.test(d.title));
    const bva = drafts.find((d: any) => /Password: values just outside/.test(d.title));
    const suggestions = [...ep.duplicateCandidates, ...bva.duplicateCandidates].map((c: any) => c.defectId);
    expect(suggestions).toEqual(expect.arrayContaining([expect.stringMatching(/DEF-/)]));
    await api().post(`${D()}/${ep.id}/confirm`).set(as('tester')).expect(201);
    const target = (await api().post(`${D()}/${bva.id}/link`).set(as('tester')).send({ targetId: ep.defectId }).expect(201)).body;
    expect(target.defectId).toBe(ep.defectId);
    expect(target.history.at(-1).comment).toMatch(/Reproduced in RUN-/);
    expect(target.attachments.length).toBe(14); // 7 own + 7 linked
    const linked = (await api().get(`${D()}/${bva.id}`).set(as('tester'))).body;
    expect(linked).toMatchObject({ status: 'Duplicate', isDraft: false, duplicateOf: { defectId: ep.defectId } });
  });

  it('confirm requires a screenshot; drafts can be discarded; client and developer cannot create', async () => {
    const manual = (await api().post(D()).set(as('tester')).send({ title: 'Typo on checkout page', severity: 'Trivial', defectType: 'UI' }).expect(201)).body;
    expect(manual).toMatchObject({ isDraft: false, status: 'New', priority: 'P4', reportedBy: 'tester' });
    await prisma.defect.update({ where: { id: manual.id }, data: { isDraft: true } });
    await api().post(`${D()}/${manual.id}/confirm`).set(as('tester')).expect(400);
    await api().post(`${D()}/${manual.id}/attachments`).set(as('tester')).attach('file', Buffer.from('MZ'), { filename: 'x.exe', contentType: 'application/x-msdownload' }).expect(400);
    await api().post(`${D()}/${manual.id}/attachments`).set(as('tester')).attach('file', PNG, { filename: 'typo.png', contentType: 'image/png' }).expect(201);
    await api().post(`${D()}/${manual.id}/confirm`).set(as('tester')).expect(201);
    await api().post(D()).set(as('client')).send({ title: 'Client cannot log' }).expect(403);
    await api().post(D()).set(as('dev')).send({ title: 'Developer cannot log' }).expect(403);
    const disc = drafts.find((d: any) => /threshold \(5000\)/.test(d.title));
    await api().delete(`${D()}/${disc.id}`).set(as('tester')).expect(200);
    await api().delete(`${D()}/${manual.id}`).set(as('tester')).expect(400); // confirmed defects are rejected/closed, not deleted
  });

  it('life cycle: transitions validated, required fields enforced, developer limited, history recorded', async () => {
    const lockDraft = drafts.find((d: any) => /after 3 failed attempts/.test(d.title));
    await api().post(`${D()}/${lockDraft.id}/transition`).set(as('tester')).send({ to: 'Open' }).expect(400); // still a draft
    await api().post(`${D()}/${lockDraft.id}/confirm`).set(as('tester')).expect(201);
    const id = lockDraft.id;
    const t = (to: string, who = 'tester', extra: Record<string, unknown> = {}) => api().post(`${D()}/${id}/transition`).set(as(who)).send({ to, ...extra });
    await t('Closed').expect(400);                        // New → Closed not allowed
    await t('Assigned').expect(400);                      // needs an assignee
    await t('Assigned', 'dev', { assignedTo: 'dev' }).expect(403);
    await t('Rejected').expect(400);                      // needs a comment
    await t('Assigned', 'lead', { assignedTo: 'dev' }).expect(201);
    await api().patch(`${D()}/${id}`).set(as('dev')).send({ severity: 'Minor' }).expect(403);
    await api().patch(`${D()}/${id}`).set(as('dev')).send({ rootCause: 'Off-by-one in lockout counter (> instead of >=)', fixVersion: '1.0.1' }).expect(200);
    await t('InProgress', 'dev').expect(201);
    await t('Fixed', 'dev').expect(201);
    await t('ReadyForRetest', 'dev').expect(201);
    await t('Retest', 'dev').expect(403);                 // verification belongs to QA
    const d = (await api().get(`${D()}/${id}`).set(as('dev'))).body;
    expect(d.allowedTransitions).toEqual([]);             // developer has nothing left to do here
    expect(d.history.filter((h: any) => h.kind === 'StatusChange').map((h: any) => h.toValue)).toEqual(['Draft', 'New', 'Assigned', 'InProgress', 'Fixed', 'ReadyForRetest']);
    expect(d.history.some((h: any) => h.field === 'rootCause' && h.userName === 'dev')).toBe(true);
    await api().patch(`${D()}/${id}`).set(as('client')).send({ severity: 'Minor' }).expect(403);
  });

  it('retest: a failing re-run reopens a defect awaiting retest; a passing one verifies it', async () => {
    const lock = (await api().get(`${D()}?q=after 3 failed`).set(as('tester'))).body[0];
    expect(lock.status).toBe('ReadyForRetest');
    const tc = await tcByTitle('Account/state changes after 3');
    await run({ mode: 'Selected', testCaseIds: [tc.id], build: '1.0.1' });
    const reopened = (await api().get(`${D()}/${lock.id}`).set(as('tester'))).body;
    expect(reopened).toMatchObject({ status: 'Reopened', retestResult: 'Fail' });
    expect(reopened.history.at(-1).comment).toMatch(/Retest failed in RUN-\d+ \(build 1\.0\.1\)/);

    // A defect raised against a test that now passes is verified by the retest run.
    const ok = await tcByTitle('Email: accept a valid value');
    const def = (await api().post(D()).set(as('tester')).send({ title: 'Valid e-mail rejected (fixed in 1.0.2)', testCaseId: ok.id, assignedTo: 'dev' }).expect(201)).body;
    for (const to of ['InProgress', 'Fixed', 'ReadyForRetest']) await api().post(`${D()}/${def.id}/transition`).set(as('dev')).send({ to, rootCause: 'Regex fixed' }).expect(201);
    await run({ mode: 'Selected', testCaseIds: [ok.id], build: '1.0.2' });
    const verified = (await api().get(`${D()}/${def.id}`).set(as('tester'))).body;
    expect(verified).toMatchObject({ status: 'Verified', retestResult: 'Pass' });
    await api().post(`${D()}/${def.id}/transition`).set(as('tester')).send({ to: 'Closed' }).expect(201);
    expect((await api().get(`${D()}/${def.id}`).set(as('tester'))).body.closedDate).toBeTruthy();
  }, 120_000);

  it('a repeat failure of a tracked test case updates the existing defect instead of creating a new draft', async () => {
    const before = (await api().get(`${D()}?draft=all`).set(as('tester'))).body.length;
    const tc = await tcByTitle('Password: reject values');
    const done = await run({ mode: 'Selected', testCaseIds: [tc.id] });
    expect(done.log).toMatch(/0 draft\(s\) created, 1 existing defect\(s\) updated/);
    expect((await api().get(`${D()}?draft=all`).set(as('tester'))).body.length).toBe(before);
  }, 120_000);

  it('exports: single defect report embeds the screenshots (PDF/Word); defect list highlights Blocker/Critical/P1', async () => {
    const lock = (await api().get(`${D()}?q=after 3 failed`).set(as('tester'))).body[0];
    const pdf = await api().get(`${D()}/${lock.id}/export?format=pdf`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.body.length).toBeGreaterThan(50_000); // screenshots embedded
    const docx = await api().get(`${D()}/${lock.id}/export?format=docx`).set(as('client')).buffer(true).parse(binary).expect(200);
    const zip = await JSZip.loadAsync(docx.body);
    // At least the annotated and the failure screenshot (identical full-page/viewport shots are shown once).
    expect(Object.keys(zip.files).filter((f) => f.startsWith('word/media/')).length).toBeGreaterThanOrEqual(2);
    const ExcelJS = (await import('exceljs')).default;
    const x = await api().get(`${D()}/export?format=xlsx`).set(as('client')).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const ws = wb.getWorksheet('Defects')!;
    const header = (ws.getRow(1).values as string[]).filter(Boolean);
    for (const h of ['Defect ID', 'Severity', 'Priority', 'Steps to Reproduce', 'Expected', 'Actual', 'Root Cause', 'Age (days)', 'Jira', 'Attachments']) expect(header).toContain(h);
    let red = 0;
    ws.eachRow((row, n) => { if (n > 1 && (row.fill as any)?.fgColor?.argb === 'FFFDE2E2') red++; });
    expect(red).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('automatic creation can be switched off per project', async () => {
    await api().put(`/api/projects/${projectId}/settings`).set(as('lead')).send({ key: 'defects.autoCreate', value: 'false' }).expect(200);
    const tc = await tcByTitle('Rule does not apply at the threshold');
    const done = await run({ mode: 'Selected', testCaseIds: [tc.id] });
    expect(done.failed).toBe(1);
    expect(done.log).not.toMatch(/draft\(s\) created/);
    expect(done.log).toMatch(/switched off/);
  }, 120_000);

  it('Jira (manual, no connection): 11-step guide with values, illustrated screens, evidence ZIP, guide export, key saved back', async () => {
    const lock = (await api().get(`${D()}?q=after 3 failed`).set(as('tester'))).body[0];
    const g = (await api().get(`${D()}/${lock.id}/jira-guide`).set(as('client')).expect(200)).body;
    expect(g.steps.map((s: any) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(g.jiraPriority).toBe('Highest'); // P1 → Highest
    expect(g.steps[3].values[0]).toMatchObject({ label: 'Summary', value: lock.title, copy: true });
    expect(g.description).toMatch(/\*Steps to Reproduce\*\n1\. /);
    expect(g.description).toMatch(/\*Expected Result\*/);
    expect(g.description).toMatch(/\*Actual Result\*/);
    expect(g.description).toMatch(new RegExp(`References:\\* QA Pilot ${lock.defectId}`));
    expect(g.steps[6].values.find((v: any) => v.label === 'Labels').value).toMatch(/QA, QA-Pilot, login/);
    const png = await api().get(`${D()}/${lock.id}/jira-guide/steps/5.png`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.body.subarray(1, 4).toString()).toBe('PNG');
    await api().get(`${D()}/${lock.id}/jira-guide/steps/12.png`).set(as('client')).expect(404);

    const zipRes = await api().get(`${D()}/${lock.id}/evidence.zip`).set(as('client')).buffer(true).parse(binary).expect(200);
    const zip = await JSZip.loadAsync(zipRes.body);
    const names = Object.keys(zip.files);
    expect(names).toEqual(expect.arrayContaining(['README.txt']));
    expect(names.some((n) => /^FullPageScreenshot-.*\.png$/.test(n))).toBe(true);
    expect(names.some((n) => /^Trace-.*\.zip$/.test(n))).toBe(true);
    expect(names.some((n) => n.endsWith('.bin'))).toBe(false);

    const docx = await api().get(`${D()}/${lock.id}/jira-guide/export?format=docx`).set(as('client')).buffer(true).parse(binary).expect(200);
    const dz = await JSZip.loadAsync(docx.body);
    expect(Object.keys(dz.files).filter((f) => f.startsWith('word/media/')).length).toBe(11);
    const pdf = await api().get(`${D()}/${lock.id}/jira-guide/export?format=pdf`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    await api().patch(`${D()}/${lock.id}`).set(as('tester')).send({ jiraKey: 'not a key' }).expect(400);
    await api().patch(`${D()}/${lock.id}`).set(as('tester')).send({ jiraUrl: 'javascript:alert(1)' }).expect(400);
    await api().patch(`${D()}/${lock.id}`).set(as('client')).send({ jiraKey: 'SHOP-42' }).expect(403);
    const saved = (await api().patch(`${D()}/${lock.id}`).set(as('tester')).send({ jiraKey: 'SHOP-42', jiraUrl: 'https://example.atlassian.net/browse/SHOP-42' }).expect(200)).body;
    expect(saved).toMatchObject({ jiraKey: 'SHOP-42', jiraUrl: 'https://example.atlassian.net/browse/SHOP-42' });
    expect(saved.history.at(-1)).toMatchObject({ field: 'jiraUrl' });
    expect((await api().get(`${D()}?q=SHOP-42`).set(as('tester'))).body.map((d: any) => d.id)).toEqual([lock.id]);
  }, 120_000);

  it('meta endpoint exposes severity/priority definitions for tooltips', async () => {
    const m = (await api().get(`${D()}/meta`).set(as('client')).expect(200)).body;
    expect(m.severity.Blocker).toMatch(/no workaround/);
    expect(m.priority.P1).toMatch(/immediately/);
  });
});
