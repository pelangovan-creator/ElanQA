import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const REDACT = /password|secret|token|apikey|api_key|credentials/i;

/** Strip secrets from snapshots before they are written to the audit trail. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? '[REDACTED]' : redact(v)]),
    );
  }
  return value;
}

export interface AuditEntry {
  userId?: string | null;
  projectId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async log(e: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: e.userId ?? null,
          projectId: e.projectId ?? null,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId ?? null,
          before: e.before === undefined ? null : JSON.stringify(redact(e.before)),
          after: e.after === undefined ? null : JSON.stringify(redact(e.after)),
          ip: e.ip ?? null,
        },
      });
    } catch (err) {
      // Auditing must never break the business operation, but failures must be visible.
      this.logger.error(`Audit write failed for ${e.action} ${e.entityType}: ${(err as Error).message}`);
    }
  }
}
