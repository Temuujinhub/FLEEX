import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { UsageMeterService } from './usage-meter.service';

// Subscription plans, usage limits and the manual payment ledger. BillingService
// is exported so DevicesModule (and future feature gates) can enforce caps.
// UsageMeterService backs the per-company SMS quota counters.
@Module({
  controllers: [BillingController],
  providers: [BillingService, UsageMeterService],
  exports: [BillingService],
})
export class BillingModule {}
