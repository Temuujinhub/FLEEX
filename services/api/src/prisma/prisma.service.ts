import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantStore } from '../common/tenant-context';
import { applyTenantGuard } from '../common/tenant-guard';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    // Defense-in-depth tenant guard (audit R-2 / P1): for a request-scoped
    // non-SUPER_ADMIN actor, auto-inject where.companyId on tenant models for
    // collection/bulk operations so a forgotten filter can't leak across
    // tenants. Additive — by-id checks and raw queries still apply.
    this.$use(async (params, next) => {
      applyTenantGuard(params, tenantStore.getStore());
      return next(params);
    });
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
