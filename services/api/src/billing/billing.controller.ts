import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { BillingService } from './billing.service';
import { RetentionEnforcementService } from './retention-enforcement.service';

const PLAN_KEYS = ['starter', 'business', 'pro', 'enterprise'];

class SetPlanDto {
  @IsIn(PLAN_KEYS) planKey!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) deviceLimitOverride?: number;
}

class CreateInvoiceDto {
  @IsOptional() @IsIn(PLAN_KEYS) planKey?: string;
  @IsInt() @Min(1) @Max(36) months!: number; // UI offers 1–11 + 12/24/36
  @IsOptional() @IsNumber() @Min(0) amount?: number; // override for custom/discount
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class PayInvoiceDto {
  @IsOptional() @IsString() @MaxLength(200) bankReference?: string;
}

// Billing is admin content — floor COMPANY_ADMIN (own plan/usage/invoices);
// plan assignment, invoice issuing and marking-paid are SUPER_ADMIN-only.
@Controller('billing')
@Roles(Role.COMPANY_ADMIN)
export class BillingController {
  constructor(
    private readonly svc: BillingService,
    private readonly retention: RetentionEnforcementService,
  ) {}

  @Get('me')
  @Audit('billing.me')
  me(@Req() req: any) {
    return this.svc.summary(req.user);
  }

  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  @Get('payments')
  @Audit('billing.payments')
  myPayments(@Req() req: any) {
    return this.svc.payments(req.user, req.user.companyId);
  }

  // The caller's own invoices (so they can see the number to pay with).
  @Get('invoices')
  @Audit('billing.invoices')
  myInvoices(@Req() req: any) {
    return this.svc.listInvoices(req.user, req.user.companyId);
  }

  // Self-serve: a COMPANY_ADMIN issues an invoice for their OWN company (to
  // renew/upgrade and get a number to pay by). The service forces the catalogue
  // price and blocks the negotiated Enterprise plan for non-admins.
  @Post('invoices')
  @Audit('billing.invoice.self_create', { captureResult: true })
  createMyInvoice(@Body() dto: CreateInvoiceDto, @Req() req: any) {
    return this.svc.createInvoice(req.user, req.user.companyId, dto);
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

  @Get('companies/:id/invoices')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.company.invoices', { resourceType: 'company', resourceIdParam: 'id' })
  companyInvoices(@Param('id') id: string, @Req() req: any) {
    return this.svc.listInvoices(req.user, id);
  }

  // Issue an invoice (нэхэмжлэх) for a company.
  @Post('companies/:id/invoices')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.invoice.create', { resourceType: 'company', resourceIdParam: 'id', captureResult: true })
  createInvoice(@Param('id') id: string, @Body() dto: CreateInvoiceDto, @Req() req: any) {
    return this.svc.createInvoice(req.user, id, dto);
  }

  // Mark an invoice paid (reconciled against the bank by its number) → extends
  // the subscription.
  @Post('invoices/:invoiceId/pay')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.invoice.pay', { resourceType: 'invoice', resourceIdParam: 'invoiceId', captureResult: true })
  payInvoice(@Param('invoiceId') invoiceId: string, @Body() dto: PayInvoiceDto, @Req() req: any) {
    return this.svc.markInvoicePaid(req.user, invoiceId, dto);
  }

  @Post('invoices/:invoiceId/cancel')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.invoice.cancel', { resourceType: 'invoice', resourceIdParam: 'invoiceId' })
  cancelInvoice(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    return this.svc.cancelInvoice(req.user, invoiceId);
  }

  @Get('companies/:id/payments')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.company.payments', { resourceType: 'company', resourceIdParam: 'id' })
  companyPayments(@Param('id') id: string, @Req() req: any) {
    return this.svc.payments(req.user, id);
  }

  // Per-plan data-retention preview (read-only): how many positions sit beyond
  // each managed tenant's plan window, and whether deletion is enabled. The
  // daily job is dry-run until RETENTION_ENFORCE is turned on.
  @Get('retention/preview')
  @Roles(Role.SUPER_ADMIN)
  @Audit('billing.retention.preview')
  retentionPreview() {
    return this.retention.preview();
  }
}
