import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AuthUser } from '../common/decorators';
import { roleHas } from '../common/permissions';
import { AddMemberDto, CreateProjectDto, SettingDto, UpdateProjectDto } from './projects.dto';

const toDate = (s?: string) => (s ? new Date(s) : undefined);

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  /** Projects visible to the user: all for Admin, memberships otherwise. */
  async listFor(user: AuthUser) {
    const where = user.role === 'Admin' ? {} : { members: { some: { userId: user.id } } };
    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { members: { where: { userId: user.id }, select: { role: true } }, _count: { select: { members: true } } },
    });
    return projects.map(({ members, _count, ...p }) => ({
      ...p,
      myRole: user.role === 'Admin' ? 'Admin' : members[0]?.role,
      memberCount: _count.members,
    }));
  }

  async create(dto: CreateProjectDto, user: AuthUser) {
    if (await this.prisma.project.findUnique({ where: { key: dto.key } })) throw new ConflictException(`Project key ${dto.key} already exists`);
    const project = await this.prisma.project.create({
      data: {
        key: dto.key, name: dto.name, client: dto.client, description: dto.description,
        startDate: toDate(dto.startDate), endDate: toDate(dto.endDate), createdById: user.id,
        // Creator becomes a member with their own role (QA Lead / Admin).
        members: { create: { userId: user.id, role: user.role } },
      },
    });
    await this.audit.log({ userId: user.id, projectId: project.id, action: 'CREATE', entityType: 'Project', entityId: project.id, after: project });
    return project;
  }

  async get(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } } },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(projectId: string, dto: UpdateProjectDto, user: AuthUser) {
    const before = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const after = await this.prisma.project.update({
      where: { id: projectId },
      data: { ...dto, startDate: toDate(dto.startDate), endDate: toDate(dto.endDate) },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'UPDATE', entityType: 'Project', entityId: projectId, before, after });
    return after;
  }

  async addMember(projectId: string, dto: AddMemberDto, user: AuthUser) {
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!target) throw new NotFoundException('User not found');
    // A non-admin cannot grant a role with more power than their own project role.
    if (dto.role === 'Admin' && user.role !== 'Admin') throw new BadRequestException('Only Admins can grant Admin');
    const m = await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: dto.userId } },
      create: { projectId, userId: dto.userId, role: dto.role },
      update: { role: dto.role },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'UPSERT', entityType: 'ProjectMember', entityId: m.id, after: m });
    return m;
  }

  async removeMember(projectId: string, userId: string, user: AuthUser) {
    const m = await this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
    if (!m) throw new NotFoundException('Membership not found');
    await this.prisma.projectMember.delete({ where: { id: m.id } });
    await this.audit.log({ userId: user.id, projectId, action: 'DELETE', entityType: 'ProjectMember', entityId: m.id, before: m });
    return { ok: true };
  }

  /** Settings are returned masked if encrypted - plaintext never leaves the server. */
  async listSettings(projectId: string) {
    const rows = await this.prisma.projectSetting.findMany({ where: { projectId }, orderBy: { key: 'asc' } });
    return rows.map((r) => ({ key: r.key, encrypted: r.encrypted, value: r.encrypted ? CryptoService.mask(this.crypto.decrypt(r.value)) : r.value, updatedAt: r.updatedAt }));
  }

  async setSetting(projectId: string, dto: SettingDto, user: AuthUser) {
    const encrypted = dto.encrypted ?? false;
    const value = encrypted ? this.crypto.encrypt(dto.value) : dto.value;
    await this.prisma.projectSetting.upsert({
      where: { projectId_key: { projectId, key: dto.key } },
      create: { projectId, key: dto.key, value, encrypted },
      update: { value, encrypted },
    });
    await this.audit.log({ userId: user.id, projectId, action: 'UPSERT', entityType: 'ProjectSetting', entityId: dto.key, after: { key: dto.key, encrypted, value: encrypted ? '[ENCRYPTED]' : dto.value } });
    return { ok: true };
  }

  /** Server-side only: decrypted setting value for integrations. */
  async getSettingValue(projectId: string, key: string): Promise<string | undefined> {
    const r = await this.prisma.projectSetting.findUnique({ where: { projectId_key: { projectId, key } } });
    if (!r) return undefined;
    return r.encrypted ? this.crypto.decrypt(r.value) : r.value;
  }

  /** Full project backup as JSON (encrypted values remain encrypted). */
  async exportProject(projectId: string, user: AuthUser) {
    const p = this.prisma;
    const where = { projectId };
    const [project, members, settings, documents, requirements, questions, scenarios, scenarioLinks, testCases, testCaseLinks,
      testData, artefacts, environments, scripts, runs, defects, monitorChecks, reports] = await Promise.all([
      p.project.findUniqueOrThrow({ where: { id: projectId } }),
      p.projectMember.findMany({ where, include: { user: { select: { email: true, name: true } } } }),
      p.projectSetting.findMany({ where }),
      p.requirementDocument.findMany({ where, include: { versions: true } }),
      p.requirementItem.findMany({ where }),
      p.clarificationQuestion.findMany({ where }),
      p.testScenario.findMany({ where }),
      p.scenarioRequirement.findMany({ where: { scenario: { projectId } } }),
      p.testCase.findMany({ where }),
      p.testCaseRequirement.findMany({ where: { testCase: { projectId } } }),
      p.testDataItem.findMany({ where }),
      p.artefact.findMany({ where }),
      p.testEnvironment.findMany({ where }),
      p.automationScript.findMany({ where }),
      p.testRun.findMany({ where, include: { results: { include: { attachments: true } } } }),
      p.defect.findMany({ where, include: { attachments: true, history: true } }),
      p.monitorCheck.findMany({ where }),
      p.report.findMany({ where }),
    ]);
    await this.audit.log({ userId: user.id, projectId, action: 'EXPORT', entityType: 'Project', entityId: projectId });
    return {
      format: 'qa-pilot-backup', formatVersion: 1, exportedAt: new Date().toISOString(), exportedBy: user.email,
      note: 'Encrypted settings/credentials are exported as ciphertext and require the same ENCRYPTION_KEY to restore. Binary files (originals, screenshots) are referenced by storagePath.',
      project, members, settings, documents, requirements, questions, scenarios, scenarioLinks, testCases, testCaseLinks,
      testData, artefacts, environments, scripts, runs, defects, monitorChecks, reports,
    };
  }

  /** Effective permissions for the UI to show/hide actions. */
  permissionsFor(role: string) {
    const all = ['project.manage', 'project.export', 'audit.view', 'requirements.edit', 'coverage.acknowledge', 'artefacts.edit',
      'artefacts.review', 'execution.run', 'defects.create', 'defects.update', 'reports.edit', 'closure.trigger'] as const;
    return all.filter((perm) => roleHas(role, perm));
  }
}
