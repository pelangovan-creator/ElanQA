import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AuthUser } from '../common/decorators';

export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export type Credentials = Record<string, { username: string; password: string }>;

export interface EnvironmentInput {
  name?: string; envType?: string; baseUrl?: string; browsers?: string[]; viewport?: string; modulePaths?: Record<string, string>;
  workers?: number; retries?: number; timeoutMs?: number;
  /** Replaces all credentials when given. Use "" as a password to keep the stored one for that role. */
  credentials?: Credentials;
}

/** Only http(s) URLs; the runner navigates real browsers there. */
function checkUrl(u: string) {
  let url: URL;
  try { url = new URL(u); } catch { throw new BadRequestException('baseUrl must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new BadRequestException('baseUrl must use http or https');
  return url.toString().replace(/\/$/, '');
}

@Injectable()
export class EnvironmentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly crypto: CryptoService) {}

  private creds(enc: string | null): Credentials {
    return enc ? (JSON.parse(this.crypto.decrypt(enc)) as Credentials) : {};
  }

  /** Public shape: credentials masked, never decrypted to the client. */
  private out(e: { credentialsEnc: string | null; browsers: string; modulePaths: string | null; lastProbe: string | null } & Record<string, unknown>) {
    const { credentialsEnc, ...rest } = e;
    const c = this.creds(credentialsEnc);
    return {
      ...rest, browsers: JSON.parse(e.browsers), modulePaths: e.modulePaths ? JSON.parse(e.modulePaths) : {}, lastProbe: e.lastProbe ? JSON.parse(e.lastProbe) : null,
      credentials: Object.fromEntries(Object.entries(c).map(([role, v]) => [role, { username: v.username, password: CryptoService.mask(v.password) }])),
    };
  }

  async list(projectId: string) {
    const rows = await this.prisma.testEnvironment.findMany({ where: { projectId }, orderBy: { name: 'asc' } });
    return rows.map((r) => this.out(r));
  }

  async getRaw(projectId: string, id: string) {
    const e = await this.prisma.testEnvironment.findFirst({ where: { id, projectId } });
    if (!e) throw new NotFoundException('Environment not found');
    return e;
  }

  /** Server-side only: decrypted credentials for a run. */
  async credentialsFor(projectId: string, id: string): Promise<Credentials> {
    return this.creds((await this.getRaw(projectId, id)).credentialsEnc);
  }

  private data(dto: EnvironmentInput, existingEnc: string | null) {
    if (dto.browsers && (!dto.browsers.length || dto.browsers.some((b) => !(BROWSERS as readonly string[]).includes(b)))) throw new BadRequestException(`browsers must be some of ${BROWSERS.join(', ')}`);
    if (dto.viewport && !/^\d{3,4}x\d{3,4}$/.test(dto.viewport)) throw new BadRequestException('viewport must look like 1366x768');
    let credentialsEnc: string | null | undefined;
    if (dto.credentials) {
      const old = this.creds(existingEnc);
      const merged: Credentials = {};
      for (const [role, v] of Object.entries(dto.credentials)) {
        if (!v.username?.trim()) continue;
        const password = v.password ? v.password : old[role]?.password;
        if (!password) throw new BadRequestException(`Password required for ${role}`);
        merged[role] = { username: v.username.trim(), password };
      }
      credentialsEnc = Object.keys(merged).length ? this.crypto.encrypt(JSON.stringify(merged)) : null;
    }
    return {
      name: dto.name, envType: dto.envType, baseUrl: dto.baseUrl ? checkUrl(dto.baseUrl) : undefined,
      browsers: dto.browsers ? JSON.stringify(dto.browsers) : undefined, viewport: dto.viewport,
      modulePaths: dto.modulePaths ? JSON.stringify(dto.modulePaths) : undefined,
      workers: dto.workers, retries: dto.retries, timeoutMs: dto.timeoutMs, credentialsEnc,
    };
  }

  async create(projectId: string, dto: EnvironmentInput, user: AuthUser) {
    if (!dto.name || !dto.baseUrl) throw new BadRequestException('name and baseUrl are required');
    const d = this.data(dto, null);
    const e = await this.prisma.testEnvironment.create({ data: { projectId, ...d, name: dto.name, baseUrl: d.baseUrl! } });
    await this.audit.log({ userId: user.id, projectId, action: 'CREATE', entityType: 'TestEnvironment', entityId: e.id, after: { ...dto, credentials: Object.keys(dto.credentials ?? {}) } });
    return this.out(e);
  }

  async update(projectId: string, id: string, dto: EnvironmentInput, user: AuthUser) {
    const before = await this.getRaw(projectId, id);
    const e = await this.prisma.testEnvironment.update({ where: { id }, data: this.data(dto, before.credentialsEnc) });
    await this.audit.log({ userId: user.id, projectId, action: 'UPDATE', entityType: 'TestEnvironment', entityId: id, after: { ...dto, credentials: dto.credentials ? Object.keys(dto.credentials) : undefined } });
    return this.out(e);
  }

  async remove(projectId: string, id: string, user: AuthUser) {
    await this.getRaw(projectId, id);
    await this.prisma.testEnvironment.delete({ where: { id } });
    await this.audit.log({ userId: user.id, projectId, action: 'DELETE', entityType: 'TestEnvironment', entityId: id });
    return { ok: true };
  }

  /**
   * Visit each module page and record the labels of its form controls. Used to build Page Objects
   * and to decide which test cases can be automated against this application.
   */
  async probe(projectId: string, id: string, pages: { module: string; path: string }[]) {
    const env = await this.getRaw(projectId, id);
    const result: Record<string, { path: string; status: number | null; labels: string[]; buttons: string[]; error?: string }> = {};
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    try {
      const ctx = await browser.newContext();
      for (const p of pages) {
        const page = await ctx.newPage();
        try {
          const res = await page.goto(env.baseUrl + p.path, { timeout: 15000, waitUntil: 'domcontentloaded' });
          const labels = await page.locator('input:visible, select:visible, textarea:visible').evaluateAll((els) =>
            els.map((e) => ((e as HTMLInputElement).labels?.[0]?.textContent ?? e.getAttribute('aria-label') ?? e.getAttribute('placeholder') ?? '').trim()).filter(Boolean));
          const buttons = await page.getByRole('button').allInnerTexts();
          result[p.module] = { path: p.path, status: res?.status() ?? null, labels: [...new Set(labels)], buttons: buttons.map((b) => b.trim()).filter(Boolean) };
        } catch (e) {
          result[p.module] = { path: p.path, status: null, labels: [], buttons: [], error: (e as Error).message.split('\n')[0] };
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
    await this.prisma.testEnvironment.update({ where: { id }, data: { lastProbe: JSON.stringify({ at: new Date().toISOString(), pages: result }) } });
    return result;
  }
}
