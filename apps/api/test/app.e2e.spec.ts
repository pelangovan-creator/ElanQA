import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';

describe('QA Pilot API - Phase 1 (auth, RBAC, projects, audit)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const PW = 'Passw0rd!';

  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await hashPassword(PW);
    for (const [k, role] of [['admin', 'Admin'], ['lead', 'QALead'], ['tester', 'Tester'], ['dev', 'Developer'], ['client', 'Client'], ['outsider', 'Tester']]) {
      const u = await prisma.user.create({ data: { email: `${k}@t.local`, name: k, role, passwordHash: hash } });
      ids[k] = u.id;
      const res = await api().post('/api/auth/login').send({ email: `${k}@t.local`, password: PW }).expect(200);
      tokens[k] = res.body.token;
    }
  });

  afterAll(async () => app.close());

  it('health is public', async () => {
    const res = await api().get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects bad credentials with a generic message and audits the failure', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'admin@t.local', password: 'nope' }).expect(401);
    expect(res.body.message).toBe('Invalid email or password');
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBeGreaterThan(0);
  });

  it('requires a token', async () => {
    await api().get('/api/projects').expect(401);
    await api().get('/api/projects').set({ Authorization: 'Bearer garbage' }).expect(401);
  });

  it('returns the current user without the password hash', async () => {
    const res = await api().get('/api/auth/me').set(as('tester')).expect(200);
    expect(res.body).toMatchObject({ email: 'tester@t.local', role: 'Tester' });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('only Admin/QA Lead can create projects; payload is validated', async () => {
    await api().post('/api/projects').set(as('tester')).send({ key: 'NOPE', name: 'x' }).expect(403);
    await api().post('/api/projects').set(as('lead')).send({ key: 'bad key', name: 'x' }).expect(400);
    await api().post('/api/projects').set(as('lead')).send({ key: 'SHOP', name: 'Shop', hack: 1 }).expect(400);
    const res = await api().post('/api/projects').set(as('lead')).send({ key: 'SHOP', name: 'Shop', client: 'Acme' }).expect(201);
    ids.shop = res.body.id;
    await api().post('/api/projects').set(as('lead')).send({ key: 'SHOP', name: 'Dup' }).expect(409);
  });

  it('adds members and enforces project isolation', async () => {
    for (const k of ['tester', 'dev', 'client']) {
      const role = { tester: 'Tester', dev: 'Developer', client: 'Client' }[k]!;
      await api().post(`/api/projects/${ids.shop}/members`).set(as('lead')).send({ userId: ids[k], role }).expect(201);
    }
    await api().get(`/api/projects/${ids.shop}`).set(as('outsider')).expect(403);
    const list = await api().get('/api/projects').set(as('outsider')).expect(200);
    expect(list.body).toHaveLength(0);
    const adminList = await api().get('/api/projects').set(as('admin')).expect(200);
    expect(adminList.body.map((p: any) => p.key)).toContain('SHOP');
  });

  it('exposes the effective role & permissions for the project', async () => {
    const res = await api().get(`/api/projects/${ids.shop}`).set(as('client')).expect(200);
    expect(res.body.myRole).toBe('Client');
    expect(res.body.permissions).toEqual([]);
    const lead = await api().get(`/api/projects/${ids.shop}`).set(as('lead')).expect(200);
    expect(lead.body.permissions).toContain('artefacts.review');
  });

  it('client (view-only) cannot modify the project', async () => {
    await api().patch(`/api/projects/${ids.shop}`).set(as('client')).send({ name: 'hacked' }).expect(403);
    await api().patch(`/api/projects/${ids.shop}`).set(as('lead')).send({ name: 'Shop v2' }).expect(200);
  });

  it('stores encrypted settings and only returns masked values', async () => {
    await api().put(`/api/projects/${ids.shop}/settings`).set(as('lead')).send({ key: 'jira.apiToken', value: 'super-secret-9876', encrypted: true }).expect(200);
    const row = await prisma.projectSetting.findFirstOrThrow({ where: { projectId: ids.shop, key: 'jira.apiToken' } });
    expect(row.value).not.toContain('super-secret');
    const res = await api().get(`/api/projects/${ids.shop}/settings`).set(as('lead')).expect(200);
    expect(res.body[0]).toMatchObject({ key: 'jira.apiToken', value: '****9876', encrypted: true });
    await api().get(`/api/projects/${ids.shop}/settings`).set(as('tester')).expect(403);
  });

  it('records an audit trail with redaction', async () => {
    const res = await api().get(`/api/projects/${ids.shop}/audit`).set(as('lead')).expect(200);
    const actions = res.body.items.map((i: any) => `${i.action}:${i.entityType}`);
    expect(actions).toEqual(expect.arrayContaining(['CREATE:Project', 'UPDATE:Project', 'UPSERT:ProjectMember', 'UPSERT:ProjectSetting']));
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
    await api().get(`/api/projects/${ids.shop}/audit`).set(as('dev')).expect(403);
  });

  it('exports a full project backup', async () => {
    const res = await api().get(`/api/projects/${ids.shop}/export`).set(as('lead')).buffer(true)
      .parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)).on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(res.headers['content-disposition']).toContain('qa-pilot-SHOP');
    const m = JSON.parse(await (await (await import('jszip')).default.loadAsync(res.body)).file('backup.json')!.async('string'));
    expect(m).toMatchObject({ format: 'qa-pilot-backup', project: { key: 'SHOP' } });
    expect(m.tables.ProjectMember).toHaveLength(4);
  });

  it('user management is Admin-only and enforces password policy', async () => {
    await api().get('/api/users').set(as('lead')).expect(403);
    await api().post('/api/users').set(as('admin')).send({ email: 'new@t.local', name: 'New', role: 'Tester', password: 'weak' }).expect(400);
    const u = await api().post('/api/users').set(as('admin')).send({ email: 'new@t.local', name: 'New', role: 'Tester', password: 'Str0ng!pw' }).expect(201);
    await api().patch(`/api/users/${u.body.id}`).set(as('admin')).send({ active: false }).expect(200);
    await api().post('/api/auth/login').send({ email: 'new@t.local', password: 'Str0ng!pw' }).expect(401);
    await api().patch(`/api/users/${ids.admin}`).set(as('admin')).send({ active: false }).expect(400);
  });
});
