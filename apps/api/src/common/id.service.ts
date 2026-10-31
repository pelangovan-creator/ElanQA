import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Generates sequential human-readable IDs per project, e.g. TC-0001, DEF-0042. */
@Injectable()
export class IdService {
  constructor(private readonly prisma: PrismaService) {}

  async next(projectId: string, prefix: string, pad = 3): Promise<string> {
    const counter = await this.prisma.idCounter.upsert({
      where: { projectId_prefix: { projectId, prefix } },
      create: { projectId, prefix, value: 1 },
      update: { value: { increment: 1 } },
    });
    return `${prefix}-${String(counter.value).padStart(pad, '0')}`;
  }

  /** Atomically reserve `count` consecutive numbers; returns the first one. */
  async reserve(projectId: string, prefix: string, count: number): Promise<number> {
    if (count <= 0) return 0;
    const counter = await this.prisma.idCounter.upsert({
      where: { projectId_prefix: { projectId, prefix } },
      create: { projectId, prefix, value: count },
      update: { value: { increment: count } },
    });
    return counter.value - count + 1;
  }
}
