import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

// Subscription plans, usage limits and the manual payment ledger. BillingService
// is exported so DevicesModule (and future feature gates) can enforce caps.
@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
