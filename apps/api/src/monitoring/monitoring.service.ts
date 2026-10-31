import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { ExportDoc } from '../common/export/model';
import { ageDays, isOpen, STATUS_LABEL } from '../defects/lifecycle';
import { dueSlots, isHHMM, isValidTimeZone, zoned } from './clock';

export interface MonitorSettings {
  enabled: boolean;
  timeZone: string;
  morning: string; // HH:MM
  evening: string; // HH:MM
  /** Hours from report to fix before the SLA is breached, per priority. */
  slaHours: Record<'P1' | 'P2' | 'P3' | 'P4', number>;
  /** Blocker/Critical/P1 defects older than this are listed as ageing. */
  agingDays: number;
}

const DEFAULT_SLA = { P1: 24, P2: 168, P3: 720, P4: 2160 };
const KEY = 'monitor.settings';

export interface DefectLine {
  id: string; defectId: string; title: string; severity: string; priority: string; status: string; assignedTo: string | null;
  ageDays: number; lastUpdated: string; slaDueAt: string; slaBreached: boolean; module: string | null;
}
export interface CheckSummary {
  generatedAt: string; slot: string; timeZone: string; localTime: string; since: string; previousCheckAt: string | null;
  totals: { open: number; critical: number; breached: number; drafts: number; pendingRetest: number; aging: number };
  bySeverity: Record<string, number>; byPriority: Record<string, number>;
  critical: DefectLine[]; newSince: DefectLine[]; reopened: DefectLine[]; closed: DefectLine[]; pendingRetest: DefectLine[]; aging: DefectLine[];
}

const highImpact = (d: { severity: string; priority: string }) => d.severity === 'Blocker' || d.severity === 'Critical' || d.priority === 'P1';

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───────────────────────────── Settings ─────────────────────────────

  defaults(): MonitorSettings {
    const tz = process.env.MONITOR_TIMEZONE && isValidTimeZone(process.env.MONITOR_TIMEZONE) ? process.env.MONITOR_TIMEZONE : 'Asia/Kolkata';
    const t = (v: string | undefined, d: string) => (v && isHHMM(v) ? v : d);
    return { enabled: true, timeZone: tz, morning: t(process.env.MONITOR_MORNING_TIME, '09:30'), evening: t(process.env.MONITOR_EVENING_TIME, '18:00'), slaHours: { ...DEFAULT_SLA }, agingDays: 3 };
  }

  async settings(projectId: string): Promise<MonitorSettings> {
    const row = await this.prisma.projectSetting.findUnique({ where: { projectId_key: { projectId, key: KEY } } });
    const saved = row ? (JSON.parse(row.value) as Partial<MonitorSettings>) : {};
    const d = this.defaults();
    return { ...d, ...saved, slaHours: { ...d.slaHours, ...(saved.slaHours ?? {}) } };
  }

  async saveSettings(projectId: string, dto: Partial<MonitorSettings>, user: AuthUser) {
    // Validated DTOs carry unsent fields as explicit `undefined` - drop them so they don't overwrite saved values.
    const defined = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
    const current = await this.settings(projectId);
    const next: MonitorSettings = { ...current, ...defined(dto), slaHours: { ...current.slaHours, ...defined(dto.slaHours) } };
    if (!isValidTimeZone(next.timeZone)) throw new BadRequestException('Unknown time zone');
    if (!isHHMM(next.morning) || !isHHMM(next.evening)) throw new BadRequestException('Times must be HH:MM (24-hour)');
    if (next.morning >= next.evening) throw new BadRequestException('The morning check must be earlier than the evening check');
    for (const [p, h] of Object.entries(next.slaHours)) if (!Number.isFinite(h) || h <= 0 || h > 24 * 365) throw new BadRequestException(`SLA hours for ${p} must be between 1 and 8760`);
    if (!Number.isInteger(next.agingDays) || next.agingDays < 1 || next.agingDays > 90) throw new BadRequestException('Ageing threshold must be 1-90 days');
    await this.prisma.projectSetting.upsert({
      where: { projectId_key: { projectId, key: KEY } },
      create: { projectId, key: KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'UPDATE', entityType: 'MonitorSettings', after: next });
    return next;
  }

  // ───────────────────────────── Checks ─────────────────────────────

  /** Build and store a defect alert summary. Returns null if this slot already ran today. */
  async runCheck(projectId: string, slot: 'Morning' | 'Evening' | 'Manual', opts: { now?: Date; scheduledFor?: string; late?: boolean; user?: AuthUser } = {}) {
    const now = opts.now ?? new Date();
    const settings = await this.settings(projectId);
    const previous = await this.prisma.monitorCheck.findFirst({ where: { projectId, createdAt: { lt: now } }, orderBy: { createdAt: 'desc' } });
    const since = previous?.createdAt ?? new Date(now.getTime() - 24 * 3_600_000);
    const summary = await this.buildSummary(projectId, settings, slot, now, since, previous?.createdAt ?? null);
    try {
      const check = await this.prisma.monitorCheck.create({
        data: {
          projectId, slot, scheduledFor: opts.scheduledFor ?? null, late: !!opts.late, summary: JSON.stringify(summary),
          criticalCount: summary.totals.critical, breachedCount: summary.totals.breached, delivered: JSON.stringify(['dashboard']),
          triggeredBy: opts.user?.id ?? null, createdAt: now,
        },
      });
      await this.audit.log({ userId: opts.user?.id ?? null, projectId, action: 'MONITOR_CHECK', entityType: 'MonitorCheck', entityId: check.id, after: { slot, critical: summary.totals.critical, breached: summary.totals.breached } });
      return { ...check, summary };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // another instance/tick already ran this slot
      throw e;
    }
  }

  async buildSummary(projectId: string, s: MonitorSettings, slot: string, now: Date, since: Date, previousCheckAt: Date | null): Promise<CheckSummary> {
    const defects = await this.prisma.defect.findMany({ where: { projectId }, orderBy: { defectId: 'asc' } });
    const line = (d: (typeof defects)[number]): DefectLine => {
      const due = new Date(d.reportedDate.getTime() + (s.slaHours[d.priority as keyof MonitorSettings['slaHours']] ?? DEFAULT_SLA.P3) * 3_600_000);
      return {
        id: d.id, defectId: d.defectId, title: d.title, severity: d.severity, priority: d.priority, status: d.status, assignedTo: d.assignedTo, module: d.module,
        ageDays: ageDays(d.reportedDate, d.closedDate ?? now), lastUpdated: d.updatedAt.toISOString(), slaDueAt: due.toISOString(),
        slaBreached: isOpen(d.status) && now > due,
      };
    };
    const confirmed = defects.filter((d) => !d.isDraft);
    const open = confirmed.filter((d) => isOpen(d.status));
    const transitions = await this.prisma.defectHistory.findMany({
      where: { defect: { projectId }, kind: 'StatusChange', createdAt: { gt: since, lte: now } },
      select: { defectId: true, fromValue: true, toValue: true },
    });
    const idsWhere = (pred: (t: (typeof transitions)[number]) => boolean) => new Set(transitions.filter(pred).map((t) => t.defectId));
    const confirmedSince = idsWhere((t) => t.fromValue === 'Draft' && t.toValue !== 'Duplicate');
    const reopenedIds = idsWhere((t) => t.toValue === 'Reopened');
    const closedIds = idsWhere((t) => t.toValue === 'Closed');
    const newSince = confirmed.filter((d) => confirmedSince.has(d.id) || (d.createdAt > since && d.createdAt <= now && !d.testResultId && d.status !== 'Duplicate'));
    const critical = open.filter(highImpact).map(line).sort((a, b) => Number(b.slaBreached) - Number(a.slaBreached) || b.ageDays - a.ageDays);
    const pendingRetest = open.filter((d) => ['ReadyForRetest', 'Retest'].includes(d.status)).map(line);
    const aging = open.filter((d) => highImpact(d) && ageDays(d.reportedDate, now) > s.agingDays).map(line);
    const count = (key: 'severity' | 'priority', values: string[]) => Object.fromEntries(values.map((v) => [v, open.filter((d) => d[key] === v).length]));
    const z = zoned(now, s.timeZone);
    return {
      generatedAt: now.toISOString(), slot, timeZone: s.timeZone, localTime: `${z.date} ${z.time}`, since: since.toISOString(), previousCheckAt: previousCheckAt?.toISOString() ?? null,
      totals: {
        open: open.length, critical: critical.length, breached: open.map(line).filter((l) => l.slaBreached).length,
        drafts: defects.filter((d) => d.isDraft).length, pendingRetest: pendingRetest.length, aging: aging.length,
      },
      bySeverity: count('severity', ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial']), byPriority: count('priority', ['P1', 'P2', 'P3', 'P4']),
      critical, newSince: newSince.map(line), reopened: confirmed.filter((d) => reopenedIds.has(d.id)).map(line), closed: confirmed.filter((d) => closedIds.has(d.id)).map(line),
      pendingRetest, aging,
    };
  }

  async list(projectId: string, take = 60) {
    const rows = await this.prisma.monitorCheck.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take, select: { id: true, slot: true, scheduledFor: true, late: true, criticalCount: true, breachedCount: true, createdAt: true, triggeredBy: true } });
    return rows;
  }

  async get(projectId: string, id: string) {
    const c = id === 'latest'
      ? await this.prisma.monitorCheck.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } })
      : await this.prisma.monitorCheck.findFirst({ where: { projectId, id } });
    if (!c) { if (id === 'latest') return null; throw new NotFoundException('Check not found'); }
    return { ...c, summary: JSON.parse(c.summary) as CheckSummary, delivered: c.delivered ? JSON.parse(c.delivered) : [] };
  }

  async exportDoc(projectId: string, id: string): Promise<ExportDoc> {
    const c = await this.get(projectId, id);
    if (!c) throw new NotFoundException('No checks yet');
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const s = c.summary;
    const cols = [
      { header: 'Defect ID', key: 'defectId', width: 10 }, { header: 'Title', key: 'title', width: 45 }, { header: 'Severity', key: 'severity', width: 9 }, { header: 'Priority', key: 'priority', width: 8 },
      { header: 'Status', key: 'statusLabel', width: 13 }, { header: 'Assignee', key: 'assignedTo', width: 14 }, { header: 'Age (days)', key: 'ageDays', width: 8 },
      { header: 'Last updated', key: 'updated', width: 16 }, { header: 'SLA due', key: 'due', width: 16 }, { header: 'SLA breached', key: 'breach', width: 9 },
    ];
    const rows = (ls: DefectLine[]) => ls.map((l) => ({ ...l, statusLabel: STATUS_LABEL[l.status] ?? l.status, updated: fmt(l.lastUpdated, s.timeZone), due: fmt(l.slaDueAt, s.timeZone), breach: l.slaBreached ? 'YES' : 'no' }));
    const red = (r: Record<string, unknown>) => (highImpact(r as { severity: string; priority: string }) ? 'red' as const : undefined);
    const tbl = (heading: string, ls: DefectLine[], sheetName: string) => ({ heading: `${heading} (${ls.length})`, table: { sheetName, columns: cols, rows: rows(ls), highlight: red } });
    return {
      title: `Defect Alert Summary – ${c.slot} check`, subtitle: `${p.name} · ${s.localTime} (${s.timeZone})`, landscape: true,
      banner: s.totals.critical ? `${s.totals.critical} open Blocker/Critical/P1 defect(s)${s.totals.breached ? ` · ${s.totals.breached} past SLA` : ''}` : undefined,
      meta: [['Open defects', String(s.totals.open)], ['Blocker/Critical/P1', String(s.totals.critical)], ['SLA breached', String(s.totals.breached)], ['Pending retest', String(s.totals.pendingRetest)], ['Drafts awaiting review', String(s.totals.drafts)], ['Changes since', fmt(s.since, s.timeZone)]],
      sections: [
        tbl('Blocker / Critical / P1 defects', s.critical, 'Critical'),
        tbl('New since the last check', s.newSince, 'New'),
        tbl('Reopened', s.reopened, 'Reopened'),
        tbl('Closed', s.closed, 'Closed'),
        tbl('Pending retest', s.pendingRetest, 'Pending retest'),
        tbl(`Ageing (Blocker/Critical/P1 open more than ${(await this.settings(projectId)).agingDays} days)`, s.aging, 'Ageing'),
        { heading: 'Open defects by severity and priority', keyValues: [...Object.entries(s.bySeverity), ...Object.entries(s.byPriority)].map(([k, v]) => [k, String(v)] as [string, string]) },
      ],
    };
  }

  // ───────────────────────────── Scheduler ─────────────────────────────

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.MONITOR_SCHEDULER === 'false') return;
    const schedule = () => {
      const delay = 60_000 - (Date.now() % 60_000) + 500; // half a second after each minute starts
      this.timer = setTimeout(async () => { await this.tick().catch((e) => this.logger.error(`Monitor tick failed: ${(e as Error).message}`)); schedule(); }, delay);
    };
    schedule();
    this.logger.log('Defect monitoring scheduler started');
    void this.tick().catch(() => undefined); // catch up a slot missed while the server was down
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Run every due slot for every active project (idempotent: one check per slot per day). */
  async tick(now = new Date()) {
    if (this.ticking) return [];
    this.ticking = true;
    const ran: { projectId: string; slot: string }[] = [];
    try {
      const projects = await this.prisma.project.findMany({ where: { status: 'Active' }, select: { id: true } });
      for (const p of projects) {
        const s = await this.settings(p.id);
        if (!s.enabled) continue;
        for (const due of dueSlots(now, s.timeZone, [{ slot: 'Morning', time: s.morning }, { slot: 'Evening', time: s.evening }])) {
          const exists = await this.prisma.monitorCheck.findUnique({ where: { projectId_scheduledFor: { projectId: p.id, scheduledFor: due.scheduledFor } } });
          if (exists) continue;
          const c = await this.runCheck(p.id, due.slot as 'Morning' | 'Evening', { now, scheduledFor: due.scheduledFor, late: due.late });
          if (c) ran.push({ projectId: p.id, slot: due.slot });
        }
      }
    } finally {
      this.ticking = false;
    }
    return ran;
  }
}

const fmt = (iso: string, tz: string) => { const z = zoned(new Date(iso), tz); return `${z.date} ${z.time}`; };
