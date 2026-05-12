import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

// Hierarchical RBAC: higher roles automatically satisfy permissions of
// lower roles. The mapping below is the single source of truth for the
// privilege ladder.
const HIERARCHY: Record<Role, number> = {
  SUPER_ADMIN: 100,
  COMPANY_ADMIN: 80,
  FLEET_MANAGER: 60,
  DISPATCHER: 40,
  DRIVER: 20,
  VIEWER: 10,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.role) throw new ForbiddenException('No user role');

    const userLevel = HIERARCHY[user.role as Role] ?? 0;
    const minRequired = Math.min(...required.map((r) => HIERARCHY[r] ?? Infinity));
    if (userLevel < minRequired) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
