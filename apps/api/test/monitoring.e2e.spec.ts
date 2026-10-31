import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';
import { MonitoringService } from '../src/monitoring/monitoring.service';

const binary = (r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };
const at = (iso: string) => new Date(iso);
const daysBefore = (iso: string, d: number) => new Date(at(iso).getTime() - d * 86_400_000);

describe('Phase 7 - twice-daily defect monitoring', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let monitor: MonitoringService;
  let projectId: string;
  let otherId: string;
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const M = () => `/api/projects/${projectId}/monitoring`;
  const MORNING = '2026-11-02T04:00:00Z'; // 09:30 IST
  const EVENING = '2026-11-02T12:30:00Z'; // 18:00 IST
  let n = 0;
  const defect = (data: Record<string, unknown>) => prisma.defect.create({ data: { projectId, defectId: `DEF-${String(++n).padStart(4, '0')}`, title: `Defect ${n}`, severity: 'Major', priority: 'P3', defectType: 'Functional', ...data } as never });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    monitor = app.get(MonitoringService);
    // Other suites' projects share this DB: keep only ours active so ticks are deterministic.
    await prisma.project.updateMany({ data: { status: 'Archived' } });
    const hash = await hashPassword('Passw0rd!');
    projectId = (await prisma.project.create({ data: { key: 'MON', name: 'Monitoring' } })).id;
    otherId = (await prisma.project.create({ data: { key: 'MON2', name: 'Monitoring 2' } })).id;
    for (const [k, role] of [['lead', 'QALead'], ['tester', 'Tester'], ['client', 'Client']]) {
      const u = await prisma.user.create({ data: { email: `${k}@mon.local`, name: k, role, passwordHash: hash } });
      await prisma.projectMember.create({ data: { projectId, userId: u.id, role } });
      tok[k] = (await api().post('/api/auth/login').send({ email: `${k}@mon.local`, password: 'Passw0rd!' })).body.token;
    }
    // Defect landscape before the morning check:
    await defect({ title: 'Checkout blocked', severity: 'Blocker', priority: 'P1', status: 'Assigned', assignedTo: 'dev', reportedDate: daysBefore(MORNING, 5), createdAt: daysBefore(MORNING, 5) }); // ageing + SLA breached
    await defect({ title: 'Login crash', severity: 'Critical', priority: 'P2', status: 'Open', reportedDate: daysBefore(MORNING, 2), createdAt: daysBefore(MORNING, 2) }); // critical, P2 SLA (7d) not breached
    await defect({ title: 'Wrong total', severity: 'Major', priority: 'P1', status: 'New', reportedDate: daysBefore(MORNING, 0.5), createdAt: daysBefore(MORNING, 0.5) }); // P1, 12h old: within SLA
    await defect({ title: 'Typo', severity: 'Trivial', priority: 'P4', status: 'ReadyForRetest', reportedDate: daysBefore(MORNING, 1), createdAt: daysBefore(MORNING, 1) });
    await defect({ title: 'Old closed', severity: 'Critical', priority: 'P1', status: 'Closed', reportedDate: daysBefore(MORNING, 9), closedDate: daysBefore(MORNING, 3), createdAt: daysBefore(MORNING, 9) });
    await defect({ title: 'Draft from run', isDraft: true, severity: 'Critical', priority: 'P1', testResultId: 'x', reportedDate: daysBefore(MORNING, 0.2), createdAt: daysBefore(MORNING, 0.2) });
  }, 30_000);
  afterAll(() => app.close());

  it('settings: defaults to 09:30 / 18:00 Asia/Kolkata; validated; only QA Lead/Admin can change', async () => {
    const s = (await api().get(`${M()}/settings`).set(as('client')).expect(200)).body;
    expect(s).toMatchObject({ enabled: true, timeZone: 'Asia/Kolkata', morning: '09:30', evening: '18:00', agingDays: 3, slaHours: { P1: 24, P2: 168 } });
    await api().put(`${M()}/settings`).set(as('tester')).send({ morning: '08:00' }).expect(403);
    await api().put(`${M()}/settings`).set(as('lead')).send({ timeZone: 'Mars/Olympus' }).expect(400);
    await api().put(`${M()}/settings`).set(as('lead')).send({ morning: '19:00' }).expect(400); // after evening
    await api().put(`${M()}/settings`).set(as('lead')).send({ morning: '9:30' }).expect(400);
  });

  it('no check yet: latest is empty', async () => {
    const r = await api().get(`${M()}/checks/latest`).set(as('client')).expect(200);
    expect(r.body).toEqual({});
  });

  it('the scheduler runs the morning check at 09:30 IST exactly once, with the right summary', async () => {
    await monitor.saveSettings(otherId, { enabled: false }, { id: 'system', email: '', name: 'system', role: 'Admin' });
    expect(await monitor.tick(at('2026-11-02T03:59:00Z'))).toEqual([]);
    expect(await monitor.tick(at(MORNING))).toEqual([{ projectId, slot: 'Morning' }]);
    expect(await monitor.tick(at('2026-11-02T04:01:00Z'))).toEqual([]); // same slot, same day: never twice
    const c = (await api().get(`${M()}/checks/latest`).set(as('client')).expect(200)).body;
    expect(c).toMatchObject({ slot: 'Morning', scheduledFor: '2026-11-02 Morning', late: false, criticalCount: 3, breachedCount: 1, delivered: ['dashboard'] });
    const s = c.summary;
    expect(s.localTime).toBe('2026-11-02 09:30');
    expect(s.critical.map((d: any) => d.title)).toEqual(['Checkout blocked', 'Login crash', 'Wrong total']); // breached first, then oldest
    expect(s.critical[0]).toMatchObject({ severity: 'Blocker', priority: 'P1', assignedTo: 'dev', ageDays: 5, slaBreached: true });
    expect(s.critical[2].slaBreached).toBe(false);
    expect(s.aging.map((d: any) => d.title)).toEqual(['Checkout blocked']);
    expect(s.pendingRetest.map((d: any) => d.title)).toEqual(['Typo']);
    expect(s.totals).toMatchObject({ open: 4, critical: 3, breached: 1, drafts: 1, pendingRetest: 1, aging: 1 });
    expect(s.bySeverity).toMatchObject({ Blocker: 1, Critical: 1, Major: 1, Trivial: 1 });
    expect(s.critical.some((d: any) => d.title === 'Old closed' || d.title === 'Draft from run')).toBe(false);
  });

  it('the evening check reports what changed since the morning', async () => {
    const wrong = await prisma.defect.findFirstOrThrow({ where: { projectId, title: 'Wrong total' } });
    const typo = await prisma.defect.findFirstOrThrow({ where: { projectId, title: 'Typo' } });
    const draft = await prisma.defect.findFirstOrThrow({ where: { projectId, title: 'Draft from run' } });
    const noon = at('2026-11-02T07:00:00Z');
    await prisma.defect.update({ where: { id: typo.id }, data: { status: 'Reopened', updatedAt: noon } });
    await prisma.defectHistory.create({ data: { defectId: typo.id, kind: 'StatusChange', fromValue: 'Retest', toValue: 'Reopened', createdAt: noon } });
    await prisma.defect.update({ where: { id: wrong.id }, data: { status: 'Closed', closedDate: noon } });
    await prisma.defectHistory.create({ data: { defectId: wrong.id, kind: 'StatusChange', fromValue: 'Verified', toValue: 'Closed', createdAt: noon } });
    await prisma.defect.update({ where: { id: draft.id }, data: { isDraft: false, status: 'New' } });
    await prisma.defectHistory.create({ data: { defectId: draft.id, kind: 'StatusChange', fromValue: 'Draft', toValue: 'New', createdAt: noon } });
    expect(await monitor.tick(at(EVENING))).toEqual([{ projectId, slot: 'Evening' }]);
    const s = (await api().get(`${M()}/checks/latest`).set(as('client'))).body.summary;
    expect(s.previousCheckAt).toBe(at(MORNING).toISOString());
    expect(s.newSince.map((d: any) => d.title)).toEqual(['Draft from run']);
    expect(s.reopened.map((d: any) => d.title)).toEqual(['Typo']);
    expect(s.closed.map((d: any) => d.title)).toEqual(['Wrong total']);
    expect(s.critical.map((d: any) => d.title)).toEqual(['Checkout blocked', 'Login crash', 'Draft from run']);
  });

  it('a slot missed while the server was down runs late (within 3 hours) and is flagged', async () => {
    await monitor.saveSettings(otherId, { enabled: true }, { id: 'system', email: '', name: 'system', role: 'Admin' });
    const ran = await monitor.tick(at('2026-11-02T13:30:00Z')); // 19:00 IST
    expect(ran).toEqual([{ projectId: otherId, slot: 'Evening' }]);
    const late = await prisma.monitorCheck.findFirstOrThrow({ where: { projectId: otherId } });
    expect(late).toMatchObject({ late: true, scheduledFor: '2026-11-02 Evening' });
    expect(await monitor.tick(at('2026-11-02T16:00:00Z'))).toEqual([]); // 21:30 IST: past grace, nothing more
  });

  it('manual "run now" is for QA Lead/Admin and is listed in the history', async () => {
    await api().post(`${M()}/run`).set(as('tester')).expect(403);
    const c = (await api().post(`${M()}/run`).set(as('lead')).expect(201)).body;
    expect(c.slot).toBe('Manual');
    const list = (await api().get(`${M()}/checks`).set(as('client')).expect(200)).body;
    // The manual run uses the real clock; the scheduled ones were simulated in the future - compare as a set.
    expect(list.map((x: any) => x.slot).sort()).toEqual(['Evening', 'Manual', 'Morning']);
  });

  it('exports the alert summary with Blocker/Critical/P1 rows highlighted', async () => {
    const x = await api().get(`${M()}/checks/latest/export?format=xlsx`).set(as('client')).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const ws = wb.getWorksheet('Critical')!;
    expect((ws.getRow(1).values as string[]).filter(Boolean)).toEqual(['Defect ID', 'Title', 'Severity', 'Priority', 'Status', 'Assignee', 'Age (days)', 'Last updated', 'SLA due', 'SLA breached']);
    expect((ws.getRow(2).fill as any).fgColor.argb).toBe('FFFDE2E2');
    expect(ws.getRow(2).getCell(10).value).toBe('YES');
    const pdf = await api().get(`${M()}/checks/latest/export?format=pdf`).set(as('client')).buffer(true).parse(binary).expect(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);

  it('changing times and time zone moves the schedule', async () => {
    const r = await api().put(`${M()}/settings`).set(as('lead')).send({ timeZone: 'Europe/London', morning: '08:00', evening: '17:30' });
    expect(r.body).toMatchObject({ timeZone: 'Europe/London', morning: '08:00' });
    expect(await monitor.tick(at('2026-11-03T08:00:00Z'))).toContainEqual({ projectId, slot: 'Morning' }); // 08:00 GMT
  });
});
