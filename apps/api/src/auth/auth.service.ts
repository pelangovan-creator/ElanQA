import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword, passwordPolicyError, verifyPassword } from './password';

/** Consecutive failed sign-ins before the account is locked, and for how long. */
export const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS ?? 5);
export const LOCKOUT_MINUTES = Number(process.env.LOCKOUT_MINUTES ?? 15);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await this.audit.log({ userId: user.id, action: 'LOGIN_LOCKED', entityType: 'User', entityId: user.id, ip });
      throw new UnauthorizedException(`Too many failed sign-in attempts. Try again after ${Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000)} minute(s) or ask an Admin to reset your password.`);
    }
    // Same message for unknown user / wrong password to avoid account enumeration.
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      if (user) {
        const failed = user.failedLogins + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : null } });
        if (lock) await this.audit.log({ userId: user.id, action: 'ACCOUNT_LOCKED', entityType: 'User', entityId: user.id, after: { minutes: LOCKOUT_MINUTES }, ip });
      }
      await this.audit.log({ action: 'LOGIN_FAILED', entityType: 'User', after: { email }, ip });
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now, failedLogins: 0, lockedUntil: null } });
    await this.audit.log({ userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, ip });
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role, tv: user.tokenVersion });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(current, user.passwordHash))) throw new BadRequestException('Current password is incorrect');
    const err = passwordPolicyError(next);
    if (err) throw new BadRequestException(err);
    // Bumping tokenVersion signs out every other session; this one gets a fresh token.
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), tokenVersion: { increment: 1 } } });
    await this.audit.log({ userId, action: 'PASSWORD_CHANGE', entityType: 'User', entityId: userId });
    return { ok: true, token: await this.jwt.signAsync({ sub: updated.id, role: updated.role, tv: updated.tokenVersion }) };
  }

  /** Signs the user out everywhere by revoking every token issued so far. */
  async logoutAll(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    await this.audit.log({ userId, action: 'LOGOUT_ALL', entityType: 'User', entityId: userId });
    return { ok: true };
  }
}
