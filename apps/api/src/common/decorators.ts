import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSION_KEY = 'permission';
/** Require a permission. On routes with a :projectId param the project-level role is used. */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Effective role within the project in the route (set by PermissionGuard). */
  projectRole?: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
