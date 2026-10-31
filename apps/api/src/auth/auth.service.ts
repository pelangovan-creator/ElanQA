import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword, passwordPolicyError, verifyPassword } from './password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Same message for unknown user / wrong password to avoid account enumeration.
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      await this.audit.log({ action: 'LOGIN_FAILED', entityType: 'User', after: { email }, ip });
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, ip });
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(current, user.passwordHash))) throw new BadRequestException('Current password is incorrect');
    const err = passwordPolicyError(next);
    if (err) throw new BadRequestException(err);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
    await this.audit.log({ userId, action: 'PASSWORD_CHANGE', entityType: 'User', entityId: userId });
    return { ok: true };
  }
}
