import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { REQUIRES_ALL_REPORTS } from './plan.decorator';
import { BillingService } from './billing.service';

// Plan feature-gate guard. Runs globally but is a no-op unless a handler is
// annotated with @RequiresAllReports(). On annotated routes it defers to
// BillingService.assertReportsAll, which allows SUPER_ADMIN and unmanaged
// (grandfathered) tenants and only blocks a managed `basic` (Starter) plan.
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiresAll = this.reflector.getAllAndOverride<boolean>(REQUIRES_ALL_REPORTS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiresAll) return true;

    const user = context.switchToHttp().getRequest().user;
    await this.billing.assertReportsAll(user); // throws ForbiddenException if gated
    return true;
  }
}
