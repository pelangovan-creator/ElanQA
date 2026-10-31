import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { verifyUpload } from '../common/file-type';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdService } from '../common/id.service';
import { StorageService } from '../common/storage.service';
import { AuthUser } from '../common/decorators';
import { EnvironmentsService } from './environments.service';
import { ScriptService } from './scripts/script.service';
import { DefectsService } from '../defects/defects.service';

export const RUN_MODES = ['All', 'Selected', 'Module', 'Priority', 'Smoke', 'Sanity', 'Regression', 'RerunFailed'] as const;
export type RunMode = (typeof RUN_MODES)[number];
export interface StartRunInput { environmentId: string; mode: RunMode; testCaseIds?: string[]; module?: string; priority?: string; build?: string; browsers?: string[] }

const ATTACHMENT_KIND: Record<string, string> = {
  screenshot: 'FailureScreenshot', 'full-page-screenshot': 'FullPageScreenshot', 'annotated-screenshot': 'AnnotatedScreenshot',
  video: 'Video', trace: 'Trace', 'console-log': 'ConsoleLog', 'network-log': 'NetworkLog',
};
const STATUS: Record<string, string> = { passed: 'Pass', failed: 'Fail', timedOut: 'Fail', skipped: 'Skipped', interrupted: 'Blocked' };
const MAX_LOG = 200_000;
export const extFor = (mime: string) => ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/webm': '.webm', 'video/mp4': '.mp4', 'application/zip': '.zip', 'application/json': '.json', 'text/plain': '.txt' } as Record<string, string>)[mime.split(';')[0]] ?? '.bin';

/** Every representation of a secret that can appear in logs, traces or form bodies. */
export function secretVariants(secrets: string[]): string[] {
  return [...new Set(secrets.filter((x) => x && x.length >= 3).flatMap((x) => [
    x, encodeURIComponent(x), encodeURIComponent(x).replace(/%20/g, '+'), JSON.stringify(x).slice(1, -1),
    new URLSearchParams({ v: x }).toString().slice(2), // HTML form encoding: "!" → "%21", " " → "+"
    [...Buffer.from(x)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''), // fully percent-encoded
  ]))].sort((a, b) => b.length - a.length);
}
export function redactText(text: string, variants: string[]): string {
  let out = text;
  for (const v of variants) out = out.split(v).join('********');
  return out;
}
/** Rewrite every entry of a Playwright trace archive with secrets removed. */
export async function redactZip(file: string, variants: string[]): Promise<void> {
  if (!variants.length) return;
  const zip = await JSZip.loadAsync(await readFile(file));
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const buf = await entry.async('nodebuffer');
    const text = buf.toString('latin1');
    const red = redactText(text, variants);
    if (red !== text) { zip.file(name, Buffer.from(red, 'latin1')); changed = true; }
  }
  if (changed) await writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

interface ReporterEvent {
  type: string; title?: string; project?: string; status?: string; retry?: number; willRetry?: boolean; duration?: number; error?: string; errorStack?: string;
  total?: number; message?: string; steps?: { title: string; error?: string; duration: number }[];
  attachments?: { name: string; path?: string; contentType: string; body?: string }[]; annotations?: { type: string; description?: string }[];
}

/** Runs Playwright for a project and turns its events into results, evidence and live progress. */
@Injectable()
export class RunsService implements OnModuleDestroy {
  private readonly logger = new Logger(RunsService.name);
  private readonly children = new Map<string, ChildProcess>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
    private readonly storage: StorageService,
    private readonly envs: EnvironmentsService,
    private readonly scripts: ScriptService,
    private readonly defects: DefectsService,
  ) {}

  onModuleDestroy() {
    for (const c of this.children.values()) c.kill('SIGTERM');
  }

  // ───────────────────────────── Selection ─────────────────────────────

  async select(projectId: string, dto: Pick<StartRunInput, 'mode' | 'testCaseIds' | 'module' | 'priority'>) {
    const where: Prisma.TestCaseWhereInput = { projectId };
    switch (dto.mode) {
      case 'Selected': if (!dto.testCaseIds?.length) throw new BadRequestException('Select at least one test case'); where.id = { in: dto.testCaseIds }; break;
      case 'Module': if (!dto.module) throw new BadRequestException('module is required'); where.module = dto.module; break;
      case 'Priority': if (!dto.priority) throw new BadRequestException('priority is required'); where.priority = dto.priority; break;
      case 'Smoke': case 'Sanity': case 'Regression': where.suites = { contains: `"${dto.mode}"` }; break;
      case 'RerunFailed': where.status = 'Fail'; break;
      case 'All': break;
      default: throw new BadRequestException('Unknown run mode');
    }
    return this.prisma.testCase.findMany({ where, orderBy: { tcId: 'asc' }, select: { id: true, tcId: true, automatedScriptId: true, title: true, module: true, automationCandidate: true } });
  }

  // ───────────────────────────── Automated runs ─────────────────────────────

  async start(projectId: string, dto: StartRunInput, user: AuthUser) {
    const active = await this.prisma.testRun.findFirst({ where: { projectId, kind: 'Automated', status: { in: ['Queued', 'Running'] } } });
    if (active) throw new ConflictException(`${active.runId} is still running`);
    const env = await this.envs.getRaw(projectId, dto.environmentId);
    const selected = await this.select(projectId, dto);
    if (!selected.length) throw new BadRequestException('No test cases match this selection');
    const automated = selected.filter((t) => t.automatedScriptId);
    const notAutomated = selected.filter((t) => !t.automatedScriptId).map((t) => t.tcId);
    if (!automated.length) throw new BadRequestException('None of the selected test cases has an automation script. Generate scripts first, or execute them manually.');
    const browsers = dto.browsers?.length ? dto.browsers : (JSON.parse(env.browsers) as string[]);

    const run = await this.prisma.testRun.create({
      data: {
        projectId, runId: await this.ids.next(projectId, 'RUN', 4), environmentId: env.id, build: dto.build ?? null, mode: dto.mode, kind: 'Automated',
        filter: JSON.stringify({ testCaseIds: dto.testCaseIds, module: dto.module, priority: dto.priority }),
        summary: JSON.stringify({ browsers, environment: env.name, baseUrl: env.baseUrl, notAutomated, testCases: automated.map((t) => t.tcId) }),
        total: automated.length * browsers.length, status: 'Queued', executedById: user.id,
      },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'RUN', entityType: 'TestRun', entityId: run.id, after: { runId: run.runId, mode: dto.mode, testCases: automated.length, notAutomated: notAutomated.length, environment: env.name } });
    void this.execute(projectId, run.id, automated.map((t) => t.tcId), browsers, user).catch(async (e) => {
      this.logger.error(`${run.runId} failed: ${(e as Error).message}`);
      await this.prisma.testRun.update({ where: { id: run.id }, data: { status: 'Error', finishedAt: new Date(), log: `ERROR: ${(e as Error).message}` } });
    });
    return run;
  }

  private async execute(projectId: string, runDbId: string, tcIds: string[], browsers: string[], user: AuthUser) {
    const run = await this.prisma.testRun.findUniqueOrThrow({ where: { id: runDbId }, include: { environment: true } });
    const env = run.environment!;
    const dir = join(this.storage.root, 'projects', projectId, 'runs', run.id);
    const workspace = join(dir, 'workspace');
    const output = join(dir, 'output');
    await this.scripts.materialize(projectId, workspace);
    await mkdir(output, { recursive: true });

    const creds = await this.envs.credentialsFor(projectId, env.id);
    const credsByRole = Object.fromEntries(Object.entries(creds).map(([r, c]) => [r, c]));
    // Typed passwords show up in Playwright step titles, logs and traces - redact them before anything is stored.
    const secrets = secretVariants(Object.values(creds).map((c) => c.password));
    const pwPkg = dirname(require.resolve('@playwright/test/package.json'));
    // Allowlisted environment: the API's own secrets (DB URL, JWT, encryption key, AI key) never reach test code.
    const childEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG ?? 'en_US.UTF-8',
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, NODE_PATH: dirname(pwPkg).replace(/@playwright$/, ''),
      CI: '1', FORCE_COLOR: '0',
      BASE_URL: env.baseUrl, QAPILOT_BROWSERS: browsers.join(','), QAPILOT_VIEWPORT: env.viewport ?? '1366x768',
      QAPILOT_MODULE_PATHS: env.modulePaths ?? '{}', QAPILOT_OUTPUT: output, QAPILOT_TIMEOUT: String(env.timeoutMs),
      QAPILOT_CREDENTIALS: JSON.stringify(credsByRole),
    };
    const grep = `(${tcIds.map((t) => t.replace(/[^A-Z0-9-]/gi, '')).join('|')}) `;
    const args = [join(pwPkg, 'cli.js'), 'test', '--config', join(workspace, 'playwright.config.ts'), '--workers', String(env.workers), '--retries', String(env.retries), '--grep', grep];

    const tcMap = new Map((await this.prisma.testCase.findMany({ where: { projectId, tcId: { in: tcIds } }, select: { id: true, tcId: true } })).map((t) => [t.tcId, t.id]));
    let log = `▶ ${run.runId} on ${env.name} (${env.baseUrl}) · browsers: ${browsers.join(', ')} · ${tcIds.length} test cases\n`;
    let dirty = true;
    const append = (line: string) => { log = (log + redactText(line, secrets) + '\n').slice(-MAX_LOG); dirty = true; };
    await this.prisma.testRun.update({ where: { id: run.id }, data: { status: 'Running', startedAt: new Date(), log } });

    const child = spawn(process.execPath, args, { cwd: workspace, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.set(run.id, child);
    const flush = setInterval(() => { if (dirty) { dirty = false; void this.prisma.testRun.update({ where: { id: run.id }, data: { log } }).catch(() => undefined); } }, 1000);
    let queue = Promise.resolve();
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const at = line.indexOf('@@QAPILOT@@');
        if (at < 0) { if (line.trim()) append(line); continue; }
        let ev: ReporterEvent;
        try { ev = JSON.parse(line.slice(at + 11)); } catch { continue; }
        queue = queue.then(() => this.onEvent(projectId, run.id, dir, ev, tcMap, user, append, secrets)).catch((e) => append(`! ${(e as Error).message}`));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => chunk.toString().split('\n').filter((l) => l.trim()).forEach((l) => append(l)));
    const code: number = await new Promise((resolve) => child.on('close', (c) => resolve(c ?? 1)));
    await queue;
    clearInterval(flush);
    this.children.delete(run.id);

    const current = await this.prisma.testRun.findUniqueOrThrow({ where: { id: run.id } });
    const aborted = current.status === 'Aborted';
    append(aborted ? '■ Run aborted by user' : `■ Finished (exit code ${code})`);
    await this.rollUpTestCases(projectId, run.id, user);
    // Draft defects (with evidence) for failures; retests verify / reopen tracked defects.
    if (!aborted) {
      const d = await this.defects.processRun(projectId, run.id, user).catch((e) => { append(`! defect creation failed: ${(e as Error).message}`); return null; });
      if (d && 'skipped' in d) append('■ Automatic defect creation is switched off for this project (setting defects.autoCreate)');
      else if (d) append(`■ Defects: ${d.created} draft(s) created, ${d.reproduced} existing defect(s) updated, ${d.reopened} reopened, ${d.verified} verified by retest`);
    }
    await this.prisma.testRun.update({ where: { id: run.id }, data: { status: aborted ? 'Aborted' : 'Completed', finishedAt: new Date(), log } });
  }

  private async onEvent(projectId: string, runId: string, dir: string, rawEv: ReporterEvent, tcMap: Map<string, string>, user: AuthUser, append: (l: string) => void, secrets: string[]) {
    // Redact secrets in everything textual the reporter sent (titles, errors, steps, annotations, inline bodies are handled below).
    const ev = JSON.parse(redactText(JSON.stringify({ ...rawEv, attachments: undefined }), secrets.map((x) => JSON.stringify(x).slice(1, -1)))) as ReporterEvent;
    ev.attachments = rawEv.attachments;
    if (ev.type === 'begin') { append(`${ev.total} tests (test cases × browsers) scheduled`); return; }
    if (ev.type === 'error') { append(`ERROR ${ev.message}`); return; }
    if (ev.type === 'testBegin') { append(`… ${ev.title} [${ev.project}]${ev.retry ? ` (retry ${ev.retry})` : ''}`); return; }
    if (ev.type !== 'testEnd') return;
    const status = STATUS[ev.status ?? ''] ?? 'Blocked';
    if (ev.willRetry) { append(`↻ ${ev.title} [${ev.project}] ${status} – retrying`); return; }
    const tcId = /^(TC-\d+)/.exec(ev.title ?? '')?.[1];
    const testCaseId = tcId ? tcMap.get(tcId) : undefined;
    if (!testCaseId) { append(`? Result for unknown test "${ev.title}"`); return; }
    const icon = { Pass: '✓', Fail: '✗', Skipped: '–', Blocked: '!' }[status];
    const skipReason = ev.annotations?.find((a) => a.type === 'fixme' || a.type === 'skip')?.description;
    append(`${icon} ${ev.title} [${ev.project}] ${status} ${Math.round((ev.duration ?? 0) / 100) / 10}s${ev.error ? `\n    ${ev.error.split('\n')[0]}` : ''}${skipReason ? ` – ${skipReason}` : ''}`);

    const result = await this.prisma.testResult.create({
      data: {
        runId, testCaseId, status, title: ev.title ?? null, browser: ev.project ?? null, durationMs: Math.round(ev.duration ?? 0), retries: ev.retry ?? 0,
        error: ev.error || (status === 'Skipped' ? skipReason ?? null : null), stepResults: JSON.stringify(ev.steps ?? []), executedBy: `Automation (${user.name})`,
      },
    });
    for (const a of ev.attachments ?? []) {
      const kind = ATTACHMENT_KIND[a.name];
      if (!kind) continue;
      const target = join(dir, 'evidence', result.id, `${a.name}${a.path ? extname(a.path) : extFor(a.contentType)}`);
      await mkdir(dirname(target), { recursive: true });
      if (a.path) await copyFile(a.path, target); else if (a.body) await writeFile(target, Buffer.from(a.body, 'base64')); else continue;
      if (kind === 'Trace') await redactZip(target, secrets).catch((e) => append(`! trace redaction failed: ${(e as Error).message}`));
      else if (/json|text/.test(a.contentType)) await writeFile(target, redactText(await readFile(target, 'utf8'), secrets));
      const size = (await stat(target)).size;
      const rel = target.slice(this.storage.root.length + 1);
      await this.prisma.attachment.create({ data: { testResultId: result.id, kind, fileName: basename(target), mimeType: a.contentType, storagePath: rel, sizeBytes: size } });
      if (kind === 'ConsoleLog') await this.prisma.testResult.update({ where: { id: result.id }, data: { consoleLog: rel } });
      if (kind === 'NetworkLog') await this.prisma.testResult.update({ where: { id: result.id }, data: { networkLog: rel } });
    }
    const counter = { Pass: 'passed', Fail: 'failed', Blocked: 'blocked', Skipped: 'skipped' }[status] as 'passed' | 'failed' | 'blocked' | 'skipped';
    await this.prisma.testRun.update({ where: { id: runId }, data: { [counter]: { increment: 1 } } });
  }

  /** Test case status = worst result across browsers in this run (Fail > Blocked > Skipped > Pass). */
  private async rollUpTestCases(projectId: string, runId: string, user: AuthUser) {
    const results = await this.prisma.testResult.findMany({ where: { runId }, select: { testCaseId: true, status: true, error: true } });
    const byTc = new Map<string, { status: string; error: string | null }[]>();
    for (const r of results) byTc.set(r.testCaseId, [...(byTc.get(r.testCaseId) ?? []), r]);
    const rank = ['Pass', 'Skipped', 'Blocked', 'Fail'];
    for (const [tcId, rs] of byTc) {
      const worst = rs.reduce((a, b) => (rank.indexOf(b.status) > rank.indexOf(a.status) ? b : a));
      await this.prisma.testCase.update({
        where: { id: tcId },
        data: { status: worst.status, executedBy: `Automation (${user.name})`, executionDate: new Date(), actualResult: worst.status === 'Pass' ? 'As expected' : worst.error?.slice(0, 2000) ?? worst.status },
      });
    }
    void projectId;
  }

  async abort(projectId: string, runDbId: string, user: AuthUser) {
    const run = await this.prisma.testRun.findFirst({ where: { id: runDbId, projectId } });
    if (!run) throw new NotFoundException('Run not found');
    if (!['Queued', 'Running'].includes(run.status)) throw new BadRequestException('Run is not active');
    await this.prisma.testRun.update({ where: { id: run.id }, data: { status: 'Aborted' } });
    this.children.get(run.id)?.kill('SIGTERM');
    await this.audit.log({ userId: user.id, projectId, action: 'ABORT', entityType: 'TestRun', entityId: run.id });
    return { ok: true };
  }

  // ───────────────────────────── Queries ─────────────────────────────

  list(projectId: string) {
    return this.prisma.testRun.findMany({
      where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, runId: true, kind: true, mode: true, build: true, status: true, total: true, passed: true, failed: true, blocked: true, skipped: true, startedAt: true, finishedAt: true, createdAt: true, executedById: true, environment: { select: { name: true, envType: true } } },
    });
  }

  async get(projectId: string, runDbId: string) {
    const run = await this.prisma.testRun.findFirst({
      where: { id: runDbId, projectId },
      include: {
        environment: { select: { name: true, envType: true, baseUrl: true } },
        results: { orderBy: { createdAt: 'asc' }, include: { testCase: { select: { tcId: true, title: true, module: true, priority: true, steps: true } }, attachments: { select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true } } } },
      },
    });
    if (!run) throw new NotFoundException('Run not found');
    const executedBy = run.executedById ? await this.prisma.user.findUnique({ where: { id: run.executedById }, select: { name: true } }) : null;
    return {
      ...run, executedBy: executedBy?.name ?? null, summary: run.summary ? JSON.parse(run.summary) : null,
      results: run.results.map((r) => ({ ...r, stepResults: r.stepResults ? JSON.parse(r.stepResults) : [], testCase: { ...r.testCase, steps: JSON.parse(r.testCase.steps) } })),
    };
  }

  async attachment(projectId: string, id: string) {
    const a = await this.prisma.attachment.findFirst({
      where: { id, OR: [{ testResult: { run: { projectId } } }, { defect: { projectId } }] },
    });
    if (!a) throw new NotFoundException('Attachment not found');
    return { data: await this.storage.get(a.storagePath), mimeType: a.mimeType, fileName: a.fileName };
  }

  // ───────────────────────────── Manual runs ─────────────────────────────

  async startManual(projectId: string, dto: { testCaseIds?: string[]; mode?: RunMode; module?: string; priority?: string; environmentId?: string; build?: string }, user: AuthUser) {
    const tcs = await this.select(projectId, { mode: dto.mode ?? 'Selected', testCaseIds: dto.testCaseIds, module: dto.module, priority: dto.priority });
    if (!tcs.length) throw new BadRequestException('No test cases selected');
    if (dto.environmentId) await this.envs.getRaw(projectId, dto.environmentId);
    const run = await this.prisma.testRun.create({
      data: {
        projectId, runId: await this.ids.next(projectId, 'RUN', 4), environmentId: dto.environmentId ?? null, build: dto.build ?? null, mode: dto.mode ?? 'Selected', kind: 'Manual',
        summary: JSON.stringify({ testCases: tcs.map((t) => t.tcId), testCaseIds: tcs.map((t) => t.id) }), total: tcs.length, status: 'Running', startedAt: new Date(), executedById: user.id,
      },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'RUN', entityType: 'TestRun', entityId: run.id, after: { runId: run.runId, kind: 'Manual', testCases: tcs.length } });
    return run;
  }

  async recordManual(projectId: string, runDbId: string, dto: { testCaseId: string; steps: { no: number; status: string; actual?: string }[]; notes?: string }, user: AuthUser) {
    const run = await this.prisma.testRun.findFirst({ where: { id: runDbId, projectId, kind: 'Manual' } });
    if (!run) throw new NotFoundException('Manual run not found');
    if (run.status !== 'Running') throw new BadRequestException('Run is already completed');
    const planned: string[] = run.summary ? JSON.parse(run.summary).testCaseIds ?? [] : [];
    if (!planned.includes(dto.testCaseId)) throw new BadRequestException('Test case is not part of this run');
    const st = dto.steps.map((s) => s.status);
    const status = st.includes('Fail') ? 'Fail' : st.includes('Blocked') ? 'Blocked' : st.length && st.every((s) => s === 'Pass') ? 'Pass' : 'Skipped';
    const failing = dto.steps.find((s) => s.status === 'Fail' || s.status === 'Blocked');
    const actual = failing ? `Step ${failing.no}: ${failing.actual || failing.status}` : 'As expected';
    const existing = await this.prisma.testResult.findFirst({ where: { runId: run.id, testCaseId: dto.testCaseId } });
    const data = { status, stepResults: JSON.stringify(dto.steps), error: status === 'Pass' ? null : [actual, dto.notes].filter(Boolean).join(' – '), executedBy: user.name, title: null, browser: 'Manual' };
    const result = existing ? await this.prisma.testResult.update({ where: { id: existing.id }, data }) : await this.prisma.testResult.create({ data: { ...data, runId: run.id, testCaseId: dto.testCaseId } });
    await this.prisma.testCase.update({ where: { id: dto.testCaseId }, data: { status, executedBy: user.name, executionDate: new Date(), actualResult: actual } });
    const counts = await this.prisma.testResult.groupBy({ by: ['status'], where: { runId: run.id }, _count: true });
    const c = Object.fromEntries(counts.map((x) => [x.status, x._count])) as Record<string, number>;
    await this.prisma.testRun.update({ where: { id: run.id }, data: { passed: c.Pass ?? 0, failed: c.Fail ?? 0, blocked: c.Blocked ?? 0, skipped: c.Skipped ?? 0 } });
    await this.audit.log({ userId: user.id, projectId, action: 'EXECUTE', entityType: 'TestResult', entityId: result.id, after: { run: run.runId, status } });
    return result;
  }

  async addManualAttachment(projectId: string, runDbId: string, resultId: string, file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined, user: AuthUser) {
    if (!file?.buffer?.length) throw new BadRequestException('A file is required');
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.mimetype)) throw new BadRequestException('Screenshots must be PNG, JPEG, GIF or WebP');
    const checked = verifyUpload(file.mimetype, file.buffer);
    if ('error' in checked) throw new BadRequestException(checked.error);
    const result = await this.prisma.testResult.findFirst({ where: { id: resultId, runId: runDbId, run: { projectId } } });
    if (!result) throw new NotFoundException('Result not found - save the step results first');
    const rel = await this.storage.put(['projects', projectId, 'manual', resultId], file.originalname, file.buffer);
    const a = await this.prisma.attachment.create({ data: { testResultId: resultId, kind: 'Manual', fileName: basename(rel), mimeType: checked.mime, storagePath: rel, sizeBytes: file.size } });
    await this.audit.log({ userId: user.id, projectId, action: 'UPLOAD', entityType: 'Attachment', entityId: a.id });
    return a;
  }

  async completeManual(projectId: string, runDbId: string, user: AuthUser) {
    const run = await this.prisma.testRun.findFirst({ where: { id: runDbId, projectId, kind: 'Manual' } });
    if (!run) throw new NotFoundException('Manual run not found');
    await this.prisma.testRun.update({ where: { id: run.id }, data: { status: 'Completed', finishedAt: new Date() } });
    await this.audit.log({ userId: user.id, projectId, action: 'COMPLETE', entityType: 'TestRun', entityId: run.id });
    const defects = await this.defects.processRun(projectId, run.id, user);
    return { ok: true, defects };
  }
}
