import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword, passwordPolicyError } from '../auth/password';
import { CreateUserDto, UpdateUserDto } from './users.dto';

export const PUBLIC_USER = { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, lockedUntil: true, createdAt: true } as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  list() {
    return this.prisma.user.findMany({ select: PUBLIC_USER, orderBy: { name: 'asc' } });
  }

  async create(dto: CreateUserDto, actorId: string) {
    const err = passwordPolicyError(dto.password);
    if (err) throw new BadRequestException(err);
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Email already registered');
    const user = await this.prisma.user.create({
      data: { email, name: dto.name, role: dto.role, passwordHash: await hashPassword(dto.password) },
      select: PUBLIC_USER,
    });
    await this.audit.log({ userId: actorId, action: 'CREATE', entityType: 'User', entityId: user.id, after: user });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: PUBLIC_USER });
    if (id === actorId && (dto.active === false || (dto.role && dto.role !== 'Admin'))) {
      throw new BadRequestException('You cannot deactivate or demote your own account');
    }
    const data: Record<string, unknown> = { name: dto.name, role: dto.role, active: dto.active };
    if (dto.password) {
      const err = passwordPolicyError(dto.password);
      if (err) throw new BadRequestException(err);
      data.passwordHash = await hashPassword(dto.password);
    }
    // A reset password or re-activation also clears a sign-in lockout.
    if (dto.password || dto.active === true) Object.assign(data, { failedLogins: 0, lockedUntil: null });
    // Revoke existing sessions when the password, role or active state changes.
    if (dto.password || (dto.role && dto.role !== before.role) || dto.active === false) data.tokenVersion = { increment: 1 };
    const after = await this.prisma.user.update({ where: { id }, data, select: PUBLIC_USER });
    await this.audit.log({ userId: actorId, action: 'UPDATE', entityType: 'User', entityId: id, before, after });
    return after;
  }
}
