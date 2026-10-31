import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { StorageService } from '../common/storage.service';
import { AuthUser } from '../common/decorators';
import { createId } from './cuid';

export const BACKUP_FORMAT = 'qa-pilot-backup';
export const BACKUP_VERSION = 2;
/** Largest backup accepted for restore (uncompressed), default 2 GB. */
const MAX_RESTORE_BYTES = Number(process.env.BACKUP_MAX_MB ?? 2048) * 1024 * 1024;
const MAX_ENTRIES = 100_000;

type Where = (projectId: string) => Record<string, unknown>;
/**
 * Every table that belongs to a project, in an order where each row's foreign keys point at rows
 * restored earlier. A new table must be added here, or backups silently miss it - the
 * "covers every model" test fails when this list and the Prisma schema drift apart.
 */
export const BACKUP_TABLES: { model: Prisma.ModelName; where: Where }[] = [
  { model: 'Project', where: (id) => ({ id }) },
  { model: 'ProjectMember', where: (projectId) => ({ projectId }) },
  { model: 'ProjectSetting', where: (projectId) => ({ projectId }) },
  { model: 'IdCounter', where: (projectId) => ({ projectId }) },
  { model: 'RequirementDocument', where: (projectId) => ({ projectId }) },
  { model: 'DocumentVersion', where: (projectId) => ({ document: { projectId } }) },
  { model: 'RequirementItem', where: (projectId) => ({ projectId }) },
  { model: 'ClarificationQuestion', where: (projectId) => ({ projectId }) },
  { model: 'TestScenario', where: (projectId) => ({ projectId }) },
  { model: 'ScenarioRequirement', where: (projectId) => ({ scenario: { projectId } }) },
  { model: 'TestCase', where: (projectId) => ({ projectId }) },
  { model: 'TestCaseRequirement', where: (projectId) => ({ testCase: { projectId } }) },
  { model: 'TestDataItem', where: (projectId) => ({ projectId }) },
  { model: 'Artefact', where: (projectId) => ({ projectId }) },
  { model: 'ReviewAction', where: (projectId) => ({ projectId }) },
  { model: 'TestEnvironment', where: (projectId) => ({ projectId }) },
  { model: 'AutomationScript', where: (projectId) => ({ projectId }) },
  { model: 'TestRun', where: (projectId) => ({ projectId }) },
  { model: 'TestResult', where: (projectId) => ({ run: { projectId } }) },
  { model: 'Defect', where: (projectId) => ({ projectId }) },
  { model: 'DefectHistory', where: (projectId) => ({ defect: { projectId } }) },
  { model: 'Attachment', where: (projectId) => ({ OR: [{ defect: { projectId } }, { testResult: { run: { projectId } } }] }) },
  { model: 'MonitorCheck', where: (projectId) => ({ projectId }) },
  { model: 'Report', where: (projectId) => ({ projectId }) },
  { model: 'AuditLog', where: (projectId) => ({ projectId }) },
];
/** Models that are global rather than per project. */
export const GLOBAL_MODELS: Prisma.ModelName[] = ['User'];

/** Storage sub-folders that are caches and are rebuilt on demand. */
const SKIP_DIRS = new Set(['jira-guide', 'node_modules']);

const delegate = (prisma: PrismaService, model: string) =>
  (prisma as unknown as Record<string, { findMany(a: unknown): Promise<Record<string, unknown>[]>; createMany(a: unknown): Promise<unknown> }>)[model[0].toLowerCase() + model.slice(1)];

const fieldsOf = (model: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === model)!.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum');

/** cuid() ids: 'c' + 24 lowercase alphanumerics. Every id and foreign key in QA Pilot has this shape. */
const CUID = /\bc[a-z0-9]{24}\b/g;

interface BackupManifest {
  format: string; formatVersion: number; app: string; exportedAt: string; exportedBy: string;
  project: { id: string; key: string; name: string };
  note: string;
  users: { id: string; email: string; name: string; role: string }[];
  tables: Record<string, Record<string, unknown>[]>;
  files: { path: string; size: number; sha256: string }[];
}

export interface RestoreResult {
  project: { id: string; key: string; name: string };
  counts: Record<string, number>;
  files: number;
  warnings: string[];
}

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
  ) {}

  private projectDir(projectId: string) {
    return join(this.storage.root, 'projects', projectId);
  }

  private async listFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(p); } else if (e.isFile()) out.push(p);
      }
    };
    await walk(root);
    return out.sort();
  }

  private static sha256File(path: string): Promise<string> {
    return new Promise((ok, fail) => {
      const h = createHash('sha256');
      createReadStream(path).on('data', (c) => h.update(c)).on('error', fail).on('end', () => ok(h.digest('hex')));
    });
  }

  /**
   * Full project backup: a ZIP with backup.json (every project table, plus the users it refers
   * to) and files/ (uploaded originals, screenshots, videos, traces, run output) with checksums.
   * Encrypted credentials stay encrypted and need the same ENCRYPTION_KEY to be usable.
   */
  async exportZip(projectId: string, user: AuthUser): Promise<{ fileName: string; stream: NodeJS.ReadableStream }> {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const t of BACKUP_TABLES) tables[t.model] = await delegate(this.prisma, t.model).findMany({ where: t.where(projectId) });
    const project = tables.Project[0] as { id: string; key: string; name: string };

    // Users referenced anywhere in the data, so restore can match them by e-mail on another server.
    const text = JSON.stringify(tables);
    const referenced = new Set(text.match(CUID) ?? []);
    const users = (await this.prisma.user.findMany({ select: { id: true, email: true, name: true, role: true } })).filter((u) => referenced.has(u.id));

    const zip = new JSZip();
    const root = this.projectDir(projectId);
    const files: BackupManifest['files'] = [];
    for (const abs of await this.listFiles(root)) {
      const rel = relative(root, abs).split(sep).join('/');
      files.push({ path: rel, size: (await stat(abs)).size, sha256: await BackupService.sha256File(abs) });
      zip.file(`files/${rel}`, createReadStream(abs));
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, app: 'QA Pilot', exportedAt: new Date().toISOString(), exportedBy: user.email,
      project: { id: project.id, key: project.key, name: project.name },
      note: 'Restore with "Restore from backup" on the Projects page. Encrypted settings and credentials need the same ENCRYPTION_KEY; otherwise they are dropped and must be re-entered.',
      users, tables, files,
    };
    zip.file('backup.json', JSON.stringify(manifest, null, 1));
    await this.audit.log({ userId: user.id, projectId, action: 'EXPORT', entityType: 'Project', entityId: projectId, after: { kind: 'backup', files: files.length } });
    return {
      fileName: `qa-pilot-${project.key}-${new Date().toISOString().slice(0, 10)}.zip`,
      stream: zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } }),
    };
  }

  /** Restores a backup as a NEW project (new key and ids), leaving the original untouched. */
  async restore(buf: Buffer, opts: { key: string; name?: string }, user: AuthUser): Promise<RestoreResult> {
    if (!buf?.length) throw new BadRequestException('Choose a QA Pilot backup (.zip) to restore');
    const key = opts.key.trim().toUpperCase();
    if (await this.prisma.project.findUnique({ where: { key } })) throw new ConflictException(`Project key ${key} is already in use - choose another`);

    let zip: JSZip;
    try { zip = await JSZip.loadAsync(buf); } catch { throw new BadRequestException('This is not a valid ZIP file'); }
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    if (entries.length > MAX_ENTRIES) throw new BadRequestException('The backup has too many files');
    const declared = entries.reduce((n, f) => n + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
    if (declared > MAX_RESTORE_BYTES) throw new BadRequestException(`The backup is larger than the ${MAX_RESTORE_BYTES / 1024 / 1024} MB restore limit (BACKUP_MAX_MB)`);
    const manifestFile = zip.file('backup.json');
    if (!manifestFile) throw new BadRequestException('backup.json is missing - is this a QA Pilot backup?');
    let m: BackupManifest;
    try { m = JSON.parse(await manifestFile.async('string')); } catch { throw new BadRequestException('backup.json is not valid JSON'); }
    if (m.format !== BACKUP_FORMAT) throw new BadRequestException('This is not a QA Pilot backup');
    if (m.formatVersion !== BACKUP_VERSION) throw new BadRequestException(`Unsupported backup version ${m.formatVersion} (this server reads version ${BACKUP_VERSION})`);
    if (!m.tables?.Project?.length) throw new BadRequestException('The backup contains no project');
    const warnings: string[] = [];

    // Verify every file before writing anything.
    const fileData: { path: string; data: Buffer }[] = [];
    for (const f of m.files ?? []) {
      // Playwright names output folders after test titles (any Unicode), so only path tricks are refused here;
      // the resolved target is checked again against the project folder before writing.
      if (typeof f.path !== 'string' || /[\\\x00-\x1f]/.test(f.path) || f.path.startsWith('/') || f.path.split('/').some((p) => p === '..' || p === '.' || p === '')) throw new BadRequestException(`Unsafe file path in backup: ${f.path}`);
      const entry = zip.file(`files/${f.path}`);
      if (!entry) throw new BadRequestException(`File missing from backup: ${f.path}`);
      const data = await entry.async('nodebuffer');
      if (StorageService.sha256(data) !== f.sha256) throw new BadRequestException(`Checksum mismatch - the backup is damaged: ${f.path}`);
      fileData.push({ path: f.path, data });
    }

    // New ids for every row; users are matched by e-mail on this server.
    const idMap = new Map<string, string>();
    for (const rows of Object.values(m.tables)) for (const r of rows) if (typeof r.id === 'string') idMap.set(r.id, createId());
    const byEmail = new Map((await this.prisma.user.findMany({ where: { email: { in: (m.users ?? []).map((u) => u.email.toLowerCase()) } }, select: { id: true, email: true } })).map((u) => [u.email, u.id]));
    const unmatched = new Set<string>();
    for (const u of m.users ?? []) {
      const local = byEmail.get(u.email.toLowerCase());
      if (local) idMap.set(u.id, local);
      else { idMap.set(u.id, user.id); unmatched.add(u.id); warnings.push(`${u.name} <${u.email}> has no account here: their work is attributed to you and they were not added to the team.`); }
    }
    const remap = (s: string) => s.replace(CUID, (id) => idMap.get(id) ?? id);
    const newProjectId = idMap.get(m.tables.Project[0].id as string)!;

    const counts: Record<string, number> = {};
    const prepared: { model: string; rows: Record<string, unknown>[] }[] = [];
    for (const t of BACKUP_TABLES) {
      const fields = fieldsOf(t.model);
      let rows = (m.tables[t.model] ?? []).map((src) => {
        const row: Record<string, unknown> = {};
        for (const f of fields) {
          let v = src[f.name];
          if (v === undefined) continue; // field added after the backup was made: use its default
          if (typeof v === 'string') v = f.type === 'DateTime' ? new Date(v) : remap(v);
          row[f.name] = v;
        }
        return row;
      });
      if (t.model === 'Project') rows = rows.map((r) => ({ ...r, key, name: opts.name?.trim() || `${r.name} (restored)` }));
      if (t.model === 'ProjectMember') {
        const origUser = new Map((m.tables.ProjectMember ?? []).map((r) => [idMap.get(r.id as string), r.userId as string]));
        const seen = new Set<string>();
        rows = rows.filter((r) => !unmatched.has(origUser.get(r.id as string)!) && !seen.has(r.userId as string) && seen.add(r.userId as string));
        if (user.role !== 'Admin' && !seen.has(user.id)) rows.push({ projectId: newProjectId, userId: user.id, role: 'QALead' });
      }
      if (t.model === 'AuditLog') {
        const origUser = new Map((m.tables.AuditLog ?? []).map((r) => [idMap.get(r.id as string), r.userId as string | null]));
        rows = rows.map((r) => (unmatched.has(origUser.get(r.id as string) ?? '') ? { ...r, userId: null } : r));
      }
      if (t.model === 'ProjectSetting') {
        rows = rows.filter((r) => {
          if (!r.encrypted) return true;
          try { this.crypto.decrypt(r.value as string); return true; } catch { warnings.push(`Setting "${r.key}" was encrypted with a different ENCRYPTION_KEY and was dropped - enter it again.`); return false; }
        });
      }
      if (t.model === 'TestEnvironment') {
        rows = rows.map((r) => {
          if (!r.credentialsEnc) return r;
          try { this.crypto.decrypt(r.credentialsEnc as string); return r; } catch { warnings.push(`Test credentials for environment "${r.name}" were encrypted with a different ENCRYPTION_KEY and were dropped - enter them again.`); return { ...r, credentialsEnc: null }; }
        });
      }
      counts[t.model] = rows.length;
      prepared.push({ model: t.model, rows });
    }

    const dir = this.projectDir(newProjectId);
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const p of prepared) for (let i = 0; i < p.rows.length; i += 500) await delegate(tx as unknown as PrismaService, p.model).createMany({ data: p.rows.slice(i, i + 500) });
      }, { timeout: 120_000, maxWait: 10_000 });
      for (const f of fileData) {
        // Folder names carry record ids (defects/<id>/…, runs/<id>/…): remap them like the rows' storage paths.
        const target = resolve(dir, remap(f.path));
        if (!target.startsWith(resolve(dir) + sep)) throw new BadRequestException(`Unsafe file path in backup: ${f.path}`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, f.data);
      }
    } catch (e) {
      // Leave nothing half-restored.
      await this.prisma.project.delete({ where: { id: newProjectId } }).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
    await this.audit.log({ userId: user.id, projectId: newProjectId, action: 'RESTORE', entityType: 'Project', entityId: newProjectId, after: { from: m.project, exportedAt: m.exportedAt, counts, files: fileData.length, warnings: warnings.length } });
    return { project: { id: newProjectId, key, name: prepared[0].rows[0].name as string }, counts, files: fileData.length, warnings };
  }
}
