import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { BillingService } from './billing.service';

class SetPlanDto {
  @IsIn(['trial', 'basic', 'pro', 'enterprise']) planKey!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) deviceLimitOverride?: number;
}

class RecordPaymentDto {
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsIn(['trial', 'basic', 'pro', 'enterprise']) planKey?: string;
  @IsOptional() @IsInt() @Min(1) @Max(36) periods?: number;
}

// Billing is admin content — floor is COMPANY_ADMIN (a manager sees their own
// plan/usage); company assignment and payments are SUPER_ADMIN-only.
@Controller('billing')
@Roles(Role.COMPANY_ADMIN)
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  // The caller's own company subscription + usage + warnings.
  @Get('me')
  @Audit('billing.me')
  me(@Req() req: any) {
    return this.svc.summary(req.user);
  }

  // Plan catalogue (limits/features per tier) — drives the pricing/compare UI.
  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  // The caller's own payment history.
  @Get('payments')
  @Audit('billing.payments')
  myPayments(@Req() req: any) {
    return this.svc.payments(req.user, req.user.companyId);
  }

  // ── SUPER_ADMIN management ────────────────────────────────────
  @Get('companies/:id')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.company.read', { resourceType: 'company', resourceIdParam: 'id' })
  company(@Param('id') id: string) {
    return this.svc.getForCompany(id);
  }

  @Post('companies/:id/plan')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.company.set_plan', { resourceType: 'company', resourceIdParam: 'id', captureResult: true })
  setPlan(@Param('id') id: string, @Body() dto: SetPlanDto, @Req() req: any) {
    return this.svc.setPlan(req.user, id, dto.planKey, dto.deviceLimitOverride ?? null);
  }

  @Post('companies/:id/payment')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.company.record_payment', { resourceType: 'company', resourceIdParam: 'id', captureResult: true })
  recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto, @Req() req: any) {
    return this.svc.recordPayment(req.user, id, dto);
  }

  @Get('companies/:id/payments')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.company.payments', { resourceType: 'company', resourceIdParam: 'id' })
  companyPayments(@Param('id') id: string, @Req() req: any) {
    return this.svc.payments(req.user, id);
  }
}
