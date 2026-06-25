import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../common/redis.service';

// Per-company, per-calendar-month usage counters in Redis. Currently tracks
// outbound SMS (a metered, real-cost resource). Keys auto-expire ~70 days after
// last write so old months self-clean without a sweep job. Pure counter ops —
// quota policy lives in BillingService, which owns the plan catalogue.
const TTL_SECONDS = 70 * 86_400;

@Injectable()
export class UsageMeterService {
  private readonly logger = new Logger(UsageMeterService.name);

  constructor(private readonly redis: RedisService) {}

  // fleex:meter:sms:<companyId>:<YYYYMM> (UTC month).
  private smsKey(companyId: string, now = new Date()): string {
    const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `fleex:meter:sms:${companyId}:${ym}`;
  }

  async smsUsed(companyId: string): Promise<number> {
    try {
      const v = await this.redis.client.get(this.smsKey(companyId));
      return v ? Number(v) || 0 : 0;
    } catch (err) {
      // Metering must never take down the notification path — fail open at 0.
      this.logger.warn(`smsUsed(${companyId}): ${(err as Error).message}`);
      return 0;
    }
  }

  // Increment and return the new monthly total. Sets a TTL on first write so the
  // key expires once the month is well past.
  async addSms(companyId: string, n: number): Promise<number> {
    if (n <= 0) return this.smsUsed(companyId);
    const key = this.smsKey(companyId);
    try {
      const total = await this.redis.client.incrby(key, n);
      if (total === n) await this.redis.client.expire(key, TTL_SECONDS); // first write this month
      return total;
    } catch (err) {
      this.logger.warn(`addSms(${companyId}, ${n}): ${(err as Error).message}`);
      return 0;
    }
  }
}
