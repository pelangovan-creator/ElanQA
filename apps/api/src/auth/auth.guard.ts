import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, IS_PUBLIC, PERMISSION_KEY } from '../common/decorators';
import { Permission, roleHas } from '../common/permissions';

/**
 * Global guard: (1) verifies the JWT, (2) for routes with :projectId checks project membership
 * and resolves the project-level role, (3) enforces @RequirePermission.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException('Account disabled');

    const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    req.user = authUser;

    const projectId: string | undefined = req.params?.projectId;
    if (projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!project) throw new NotFoundException('Project not found');
      if (user.role === 'Admin') {
        authUser.projectRole = 'Admin';
      } else {
        const m = await this.prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: user.id } },
        });
        if (!m) throw new ForbiddenException('You are not a member of this project');
        authUser.projectRole = m.role;
      }
    }

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
    if (permission) {
      const effective = authUser.projectRole ?? authUser.role;
      if (!roleHas(effective, permission)) throw new ForbiddenException(`Role ${effective} lacks permission ${permission}`);
    }
    return true;
  }
}
