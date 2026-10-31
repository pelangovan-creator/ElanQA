import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';
import { BACKUP_TABLES, GLOBAL_MODELS } from '../src/projects/backup.service';
import { createId } from '../src/projects/cuid';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n));
const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Phase 10 - full project backup and restore', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
  let zipBuf: Buffer;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    const hash = await hashPassword('Passw0rd!');
    for (const [k, role] of [['blead', 'QALead'], ['btester', 'Tester'], ['bclient', 'Client']]) {
      ids[k] = (await prisma.user.create({ data: { email: `${k}@bk.local`, name: `${k} user`, role, passwordHash: hash } })).id;
      tok[k] = await jwt.signAsync({ sub: ids[k], role, tv: 0 });
    }
    const p = await api().post('/api/projects').set(as('blead')).send({ key: 'BKP', name: 'Backup source', client: 'Acme' }).expect(201);
    ids.project = p.body.id;
    for (const k of ['btester', 'bclient']) await api().post(`/api/projects/${ids.project}/members`).set(as('blead')).send({ userId: ids[k], role: k === 'btester' ? 'Tester' : 'Client' }).expect(201);
    await api().put(`/api/projects/${ids.project}/settings`).set(as('blead')).send({ key: 'api.token', value: 'super-secret-token', encrypted: true }).expect(200);
    const base = `/api/projects/${ids.project}`;
    await api().post(`${base}/requirements/documents`).set(as('blead')).field('title', 'SRS').field('docType', 'SRS').attach('file', fx('srs-v1.docx'), 'srs-v1.docx').expect(201);
    await api().post(`${base}/artefacts/design/generate`).set(as('blead')).send({}).expect(201);
    const tc = await prisma.testCase.findFirstOrThrow({ where: { projectId: ids.project } });
    const d = await api().post(`${base}/defects`).set(as('btester')).send({ title: 'Checkout total wrong', severity: 'Critical', priority: 'P1', defectType: 'Functional', module: 'Checkout', testCaseId: tc.id, actualResult: 'Total is 0', expectedResult: 'Total is 10' });
    if (d.status !== 201) throw new Error(`defect: ${d.status} ${JSON.stringify(d.body)}`);
    ids.defect = d.body.id;
    await api().post(`${base}/defects/${ids.defect}/attachments`).set(as('btester')).attach('file', fx('login-screenshot.png'), { filename: 'shot.png', contentType: 'image/png' }).expect(201);
    // Playwright run output: folder named after the test title (Unicode), inside a folder named after the run id.
    const runDir = join(process.env.STORAGE_DIR!, 'projects', ids.project, 'runs', 'cabcdefghijklmnopqrstuvwx', 'output', 'checkout-TC-0021-·-ed689-and-4999--chromium');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'error-context.md'), '# Page snapshot ✓');
  }, 120_000);
  afterAll(() => app.close());

  it('covers every model in the schema', () => {
    const covered = new Set([...BACKUP_TABLES.map((t) => t.model), ...GLOBAL_MODELS]);
    expect(Prisma.dmmf.datamodel.models.map((m) => m.name).filter((m) => !covered.has(m as Prisma.ModelName))).toEqual([]);
  });

  it('generates ids in the cuid shape the remapper relies on', () => {
    const a = new Set(Array.from({ length: 2000 }, createId));
    expect(a.size).toBe(2000);
    for (const id of a) expect(id).toMatch(/^c[a-z0-9]{24}$/);
  });

  it('exports a ZIP with every table, the referenced users and checksummed files', async () => {
    await api().get(`/api/projects/${ids.project}/export`).set(as('btester')).expect(403);
    const res = await api().get(`/api/projects/${ids.project}/export`).set(as('blead')).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/qa-pilot-BKP-\d{4}-\d{2}-\d{2}\.zip/);
    zipBuf = res.body;
    const zip = await JSZip.loadAsync(zipBuf);
    const m = JSON.parse(await zip.file('backup.json')!.async('string'));
    expect(m).toMatchObject({ format: 'qa-pilot-backup', formatVersion: 2, project: { key: 'BKP' } });
    for (const t of ['RequirementItem', 'TestCase', 'TestCaseRequirement', 'Defect', 'Attachment', 'AuditLog', 'IdCounter', 'DocumentVersion']) expect(m.tables[t].length).toBeGreaterThan(0);
    expect(m.users.map((u: { email: string }) => u.email).sort()).toEqual(['bclient@bk.local', 'blead@bk.local', 'btester@bk.local']);
    expect(m.users[0].passwordHash).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain('super-secret-token'); // encrypted settings stay ciphertext
    const paths = m.files.map((f: { path: string }) => f.path);
    expect(paths.some((p: string) => p.startsWith('documents/') && p.endsWith('.docx'))).toBe(true);
    expect(paths.some((p: string) => p.startsWith('defects/') && p.endsWith('.png'))).toBe(true);
    for (const p of paths) expect(zip.file(`files/${p}`)).toBeTruthy();
  });

  it('restores as a new project with identical content, new ids, working files and a fresh audit entry', async () => {
    await api().post('/api/projects/restore').set(as('btester')).field('key', 'BKR').attach('file', zipBuf, 'b.zip').expect(403);
    await api().post('/api/projects/restore').set(as('blead')).field('key', 'BKP').attach('file', zipBuf, 'b.zip').expect(409);
    const res = await api().post('/api/projects/restore').set(as('blead')).field('key', 'BKR').attach('file', zipBuf, 'b.zip').expect(201);
    const r = res.body;
    expect(r.project).toMatchObject({ key: 'BKR', name: 'Backup source (restored)' });
    expect(r.warnings).toEqual([]);
    const np = r.project.id;
    expect(np).not.toBe(ids.project);

    for (const t of BACKUP_TABLES.filter((x) => x.model !== 'AuditLog')) {
      const d = (prisma as any)[t.model[0].toLowerCase() + t.model.slice(1)];
      expect([t.model, await d.count({ where: t.where(np) })]).toEqual([t.model, await d.count({ where: t.where(ids.project) })]);
    }
    // Same content with remapped links: test case → requirement links point at the restored requirements.
    const links = await prisma.testCaseRequirement.findMany({ where: { testCase: { projectId: np } }, include: { requirement: true } });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.requirement.projectId).toBe(np);
    const nd = await prisma.defect.findFirstOrThrow({ where: { projectId: np }, include: { attachments: true, testCase: true } });
    expect(nd).toMatchObject({ defectId: 'DEF-0001', title: 'Checkout total wrong', severity: 'Critical' });
    expect(nd.testCase!.projectId).toBe(np);
    expect(nd.attachments[0].storagePath).toContain(np);
    const out = join(process.env.STORAGE_DIR!, 'projects', np, 'runs', 'cabcdefghijklmnopqrstuvwx', 'output', 'checkout-TC-0021-·-ed689-and-4999--chromium', 'error-context.md');
    expect(readFileSync(out, 'utf8')).toBe('# Page snapshot ✓');
    // Files are back and served.
    const img = await api().get(`/api/projects/${np}/execution/attachments/${nd.attachments[0].id}`).set(as('btester')).buffer(true).parse(binary).expect(200);
    expect(img.body.equals(fx('login-screenshot.png'))).toBe(true);
    const doc = await prisma.documentVersion.findFirstOrThrow({ where: { document: { projectId: np } } });
    const orig = await api().get(`/api/projects/${np}/requirements/versions/${doc.id}/original`).set(as('btester')).buffer(true).parse(binary).expect(200);
    expect(orig.body.equals(fx('srs-v1.docx'))).toBe(true);
    // Team, encrypted setting and id counters carry over: the next defect continues the sequence.
    const team = await prisma.projectMember.findMany({ where: { projectId: np } });
    expect(team.map((m) => m.userId).sort()).toEqual([ids.blead, ids.btester, ids.bclient].sort());
    const settings = await api().get(`/api/projects/${np}/settings`).set(as('blead')).expect(200);
    expect(settings.body.find((s: { key: string }) => s.key === 'api.token').value).toBe('****oken');
    const next = await api().post(`/api/projects/${np}/defects`).set(as('btester')).send({ title: 'Another', severity: 'Minor', priority: 'P3', defectType: 'UI', actualResult: 'a', expectedResult: 'b' }).expect(201);
    expect(next.body.defectId).toBe('DEF-0002');
    expect(await prisma.auditLog.count({ where: { projectId: np, action: 'RESTORE' } })).toBe(1);
    // The original is untouched.
    expect(await prisma.defect.count({ where: { projectId: ids.project } })).toBe(1);
    // A restored project can itself be backed up again.
    await api().get(`/api/projects/${np}/export`).set(as('blead')).buffer(true).parse(binary).expect(200);
  });

  it('maps users by e-mail and reports the ones missing on this server', async () => {
    const zip = await JSZip.loadAsync(zipBuf);
    const m = JSON.parse(await zip.file('backup.json')!.async('string'));
    m.users = m.users.map((u: { email: string }) => (u.email === 'bclient@bk.local' ? { ...u, email: 'gone@elsewhere.local', name: 'Gone' } : u));
    zip.file('backup.json', JSON.stringify(m));
    const res = await api().post('/api/projects/restore').set(as('blead')).field('key', 'BKU').field('name', 'Other server').attach('file', await zip.generateAsync({ type: 'nodebuffer' }), 'b.zip').expect(201);
    expect(res.body.project.name).toBe('Other server');
    expect(res.body.warnings).toEqual([expect.stringContaining('gone@elsewhere.local')]);
    const team = await prisma.projectMember.findMany({ where: { projectId: res.body.project.id } });
    expect(team.map((t) => t.userId).sort()).toEqual([ids.blead, ids.btester].sort());
  });

  it('refuses damaged, foreign or unsafe backups and leaves nothing behind', async () => {
    const before = await prisma.project.count();
    const post = (buf: Buffer, key = 'BKX') => api().post('/api/projects/restore').set(as('blead')).field('key', key).attach('file', buf, 'b.zip');
    expect((await post(Buffer.from('not a zip')).expect(400)).body.message).toMatch(/not a valid ZIP/);
    const other = new JSZip(); other.file('backup.json', JSON.stringify({ format: 'something-else' }));
    expect((await post(await other.generateAsync({ type: 'nodebuffer' })).expect(400)).body.message).toMatch(/not a QA Pilot backup/);

    const tampered = await JSZip.loadAsync(zipBuf);
    const m = JSON.parse(await tampered.file('backup.json')!.async('string'));
    tampered.file(`files/${m.files[0].path}`, 'tampered');
    expect((await post(await tampered.generateAsync({ type: 'nodebuffer' })).expect(400)).body.message).toMatch(/Checksum mismatch/);

    const evil = await JSZip.loadAsync(zipBuf);
    const em = JSON.parse(await evil.file('backup.json')!.async('string'));
    em.files.push({ path: '../../../etc/evil', size: 1, sha256: 'x' });
    evil.file('backup.json', JSON.stringify(em));
    expect((await post(await evil.generateAsync({ type: 'nodebuffer' })).expect(400)).body.message).toMatch(/Unsafe file path/);
    expect(await prisma.project.count()).toBe(before);
  });
});
