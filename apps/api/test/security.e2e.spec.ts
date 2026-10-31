import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';
import { fileHeaders, sniff, verifyUpload } from '../src/common/file-type';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('Phase 10 - security hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const PW = 'Passw0rd!';
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const tokenFor = async (id: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    return jwt.signAsync({ sub: u.id, role: u.role, tv: u.tokenVersion });
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    const hash = await hashPassword(PW);
    for (const [k, role] of [['sadmin', 'Admin'], ['slock', 'Tester'], ['stester', 'Tester'], ['srev', 'Developer']]) {
      ids[k] = (await prisma.user.create({ data: { email: `${k}@sec.local`, name: k, role, passwordHash: hash } })).id;
    }
    const project = await prisma.project.create({ data: { key: 'SEC', name: 'Security', createdById: ids.sadmin } });
    ids.project = project.id;
    await prisma.projectMember.create({ data: { projectId: project.id, userId: ids.stester, role: 'Tester' } });
    ids.defect = (await prisma.defect.create({ data: { projectId: project.id, defectId: 'DEF-9001', title: 'Upload target', severity: 'Minor', priority: 'P3', defectType: 'UI', status: 'New' } as never })).id;
  });
  afterAll(async () => app.close());

  it('sends security headers', async () => {
    const res = await api().get('/api/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('locks an account after 5 consecutive failures, even for the right password; an Admin reset unlocks it', async () => {
    for (let i = 0; i < 5; i++) await api().post('/api/auth/login').send({ email: 'slock@sec.local', password: 'wrong' }).expect(401);
    const locked = await api().post('/api/auth/login').send({ email: 'slock@sec.local', password: PW }).expect(401);
    expect(locked.body.message).toMatch(/Too many failed sign-in attempts/);
    expect(await prisma.auditLog.count({ where: { action: 'ACCOUNT_LOCKED', entityId: ids.slock } })).toBe(1);
    const admin = await tokenFor(ids.sadmin);
    const list = await api().get('/api/users').set({ Authorization: `Bearer ${admin}` }).expect(200);
    expect(list.body.find((u: { id: string }) => u.id === ids.slock).lockedUntil).toBeTruthy();
    await api().patch(`/api/users/${ids.slock}`).set({ Authorization: `Bearer ${admin}` }).send({ password: 'N3w-Passw0rd!' }).expect(200);
    await api().post('/api/auth/login').send({ email: 'slock@sec.local', password: 'N3w-Passw0rd!' }).expect(200);
  });

  // Login is also rate-limited to 10 requests a minute per IP, so this file stays within 10 sign-in calls.
  it('a successful sign-in resets the failure counter', async () => {
    for (let i = 0; i < 2; i++) await api().post('/api/auth/login').send({ email: 'srev@sec.local', password: 'wrong' }).expect(401);
    await api().post('/api/auth/login').send({ email: 'srev@sec.local', password: PW }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.srev } })).failedLogins).toBe(0);
  });

  it('revokes tokens on password change, "sign out everywhere", role change and deactivation', async () => {
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const old = await tokenFor(ids.srev);
    const res = await api().post('/api/auth/change-password').set(auth(old)).send({ currentPassword: PW, newPassword: 'An0ther-Passw0rd!' }).expect(200);
    await api().get('/api/auth/me').set(auth(old)).expect(401);
    await api().get('/api/auth/me').set(auth(res.body.token)).expect(200);

    await api().post('/api/auth/logout-all').set(auth(res.body.token)).expect(200);
    await api().get('/api/auth/me').set(auth(res.body.token)).expect(401);

    const admin = auth(await tokenFor(ids.sadmin));
    const beforeRole = await tokenFor(ids.srev);
    await api().patch(`/api/users/${ids.srev}`).set(admin).send({ name: 'renamed' }).expect(200);
    await api().get('/api/auth/me').set(auth(beforeRole)).expect(200); // a rename does not sign anyone out
    await api().patch(`/api/users/${ids.srev}`).set(admin).send({ role: 'Tester' }).expect(200);
    await api().get('/api/auth/me').set(auth(beforeRole)).expect(401);
    const beforeDeactivate = await tokenFor(ids.srev);
    await api().patch(`/api/users/${ids.srev}`).set(admin).send({ active: false }).expect(200);
    await api().get('/api/auth/me').set(auth(beforeDeactivate)).expect(401);
  });

  it('rejects tokens signed with another algorithm or secret', async () => {
    const forged = await new JwtService({ secret: 'not-the-real-secret-not-the-real-secret' }).signAsync({ sub: ids.sadmin, tv: 0 });
    await api().get('/api/auth/me').set({ Authorization: `Bearer ${forged}` }).expect(401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: ids.sadmin, tv: 0 })).toString('base64url')}.`;
    await api().get('/api/auth/me').set({ Authorization: `Bearer ${none}` }).expect(401);
  });

  it('sniffs uploads: a script disguised as a screenshot is refused, a real PNG is accepted and served inline', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(ids.stester)}` };
    const url = `/api/projects/${ids.project}/defects/${ids.defect}/attachments`;
    const bad = await api().post(url).set(auth).attach('file', SVG, { filename: 'shot.png', contentType: 'image/png' }).expect(400);
    expect(bad.body.message).toMatch(/not a valid image\/png/);
    await api().post(url).set(auth).attach('file', PNG, { filename: 'shot.jpg', contentType: 'image/jpeg' }).expect(201); // stored as what it really is
    await api().post(url).set(auth).attach('file', PNG, { filename: 'notes.txt', contentType: 'text/plain' }).expect(400);
    await api().post(url).set(auth).attach('file', SVG, { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(400);
    const att = await prisma.attachment.findFirstOrThrow({ where: { defectId: ids.defect } });
    expect(att.mimeType).toBe('image/png');
    const served = await api().get(`/api/projects/${ids.project}/execution/attachments/${att.id}`).set(auth).expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['content-disposition']).toMatch(/^inline/);
    expect(served.headers['content-security-policy']).toMatch(/sandbox/);
  });

  it('file helpers: only real raster images render inline', () => {
    expect(sniff(PNG)).toBe('image/png');
    expect(sniff(SVG)).toBeNull();
    expect(verifyUpload('application/json', Buffer.from('{"a":1}'))).toEqual({ mime: 'application/json' });
    expect(verifyUpload('application/zip', PNG)).toHaveProperty('error');
    const h = fileHeaders('text/html', Buffer.from('<script>x</script>'), 'a.html');
    expect(h['Content-Type']).toBe('application/octet-stream');
    expect(h['Content-Disposition']).toMatch(/^attachment/);
    expect(fileHeaders('image/png', SVG, 's.png')['Content-Disposition']).toMatch(/^attachment/);
  });
});
