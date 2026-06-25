import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { UsageMeterService } from './usage-meter.service';
import { RetentionEnforcementService } from './retention-enforcement.service';

// Subscription plans, usage limits and the manual payment ledger. BillingService
// is exported so DevicesModule (and future feature gates) can enforce caps.
// UsageMeterService backs the per-company SMS quota counters;
// RetentionEnforcementService trims position history per plan (dry-run default).
@Module({
  controllers: [BillingController],
  providers: [BillingService, UsageMeterService, RetentionEnforcementService],
  exports: [BillingService],
})
export class BillingModule {}
