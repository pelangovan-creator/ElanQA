import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';

export const REVIEWABLE = ['ClarificationQuestion', 'TestScenario', 'TestCase', 'TestDataItem', 'Artefact'] as const;
export type Reviewable = (typeof REVIEWABLE)[number];

const DELEGATE: Record<Reviewable, string> = {
  ClarificationQuestion: 'clarificationQuestion', TestScenario: 'testScenario', TestCase: 'testCase', TestDataItem: 'testDataItem', Artefact: 'artefact',
};
const HAS_COMMENT = new Set<Reviewable>(['TestScenario', 'TestCase']);

/** Approve / Reject-with-comment workflow shared by every generated artefact. */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private model(t: Reviewable): any {
    return (this.prisma as any)[DELEGATE[t]];
  }

  async review(projectId: string, entityType: Reviewable, ids: string[], action: 'Approve' | 'Reject', comment: string | undefined, user: AuthUser) {
    if (!REVIEWABLE.includes(entityType)) throw new BadRequestException('Unknown entity type');
    if (!ids.length) throw new BadRequestException('No items selected');
    if (action === 'Reject' && !comment?.trim()) throw new BadRequestException('A comment is required when rejecting');
    const model = this.model(entityType);
    const found: { id: string }[] = await model.findMany({ where: { id: { in: ids }, projectId }, select: { id: true } });
    if (found.length !== ids.length) throw new NotFoundException('Some items were not found in this project');
    const reviewStatus = action === 'Approve' ? 'Approved' : 'Rejected';
    await model.updateMany({
      where: { id: { in: ids } },
      data: { reviewStatus, ...(HAS_COMMENT.has(entityType) ? { reviewComment: comment?.trim() || null } : {}) },
    });
    await this.prisma.reviewAction.createMany({ data: ids.map((entityId) => ({ projectId, entityType, entityId, action, comment: comment?.trim() || null, userId: user.id })) });
    await this.audit.log({ userId: user.id, projectId, action: action.toUpperCase(), entityType, entityId: ids.length === 1 ? ids[0] : null, after: { ids, comment } });
    return { updated: ids.length, reviewStatus };
  }

  async history(projectId: string, entityType: string, entityId: string) {
    const rows = await this.prisma.reviewAction.findMany({ where: { projectId, entityType, entityId }, orderBy: { createdAt: 'desc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, userName: name.get(r.userId) ?? 'Unknown' }));
  }
}

/** Editing an approved/rejected item sends it back for review. */
export const backToReview = { reviewStatus: 'PendingReview' } as const;
