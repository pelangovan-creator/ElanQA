import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermission } from '../common/decorators';

@Controller('projects/:projectId/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit.view')
  async list(
    @Param('projectId') projectId: string,
    @Query('entityType') entityType?: string,
    @Query('take') take = '100',
    @Query('skip') skip = '0',
  ) {
    const where = { projectId, ...(entityType ? { entityType } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(take) || 100, 500),
        skip: Number(skip) || 0,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
