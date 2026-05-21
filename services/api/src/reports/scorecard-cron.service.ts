import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';
import { EmailService } from '../notifications/email.service';
import { ReportsService } from './reports.service';

// Monthly driver scorecard auto-email.
//
// What it does: on the 1st of every month at 02:00 (company timezone
// is naive UTC for now — the cron framework runs on the server clock,
// which is set to UTC in production), iterate all companies, then all
// drivers within each company that have an email on file, render last
// month's PDF, and email it. Cron runs hourly as a safety net: a
// Redis key guards each (company, year-month) tuple so a partial run
// will retry, but a completed run won't double-send.
//
// What it does NOT do (deferred): per-driver opt-out flag, manager
// digest with the top/bottom 10, localised email subject. Those layer
// cleanly once finance sees the monthly file landing in inboxes.

const RUN_KEY_TTL_DAYS = 35; // longer than a month so the dedup survives
const MIN_DAYS_WITH_DATA = 3; // skip drivers with effectively no activity

@Injectable()
export class ScorecardCronService {
  private readonly logger = new Logger(ScorecardCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly reports: ReportsService,
  ) {}

  // Runs at the top of every hour. The body checks if we're inside the
  // 02:00 — 03:00 hour on the 1st of the month and bails out otherwise,
  // so a process restart in the middle of the month doesn't fire.
  @Cron(CronExpression.EVERY_HOUR)
  async tick() {
    const now = new Date();
    if (now.getUTCDate() !== 1) return;
    if (now.getUTCHours() !== 2) return;
    await this.runMonth(now).catch((err) => this.logger.error(`scorecard cron: ${err.message}`));
  }

  // Public so an admin can trigger a backfill ("send last month again")
  // from an internal route or a one-off test.
  async runMonth(asOf = new Date()): Promise<{ companies: number; emailsSent: number; skipped: number }> {
    const { from, to, ym } = previousMonthWindow(asOf);
    this.logger.log(`Running monthly scorecard for ${ym} (${from.toISOString()} → ${to.toISOString()})`);

    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    let totalSent = 0;
    let totalSkipped = 0;
    for (const co of companies) {
      const key = `cron:scorecard:${co.id}:${ym}`;
      const claim = await this.redis.client.set(
        key,
        new Date().toISOString(),
        'EX',
        RUN_KEY_TTL_DAYS * 86400,
        'NX',
      );
      if (claim !== 'OK') {
        this.logger.debug(`Scorecard for ${co.name} ${ym} already sent; skipping`);
        continue;
      }
      try {
        const r = await this.runCompany(co.id, from, to);
        totalSent += r.sent;
        totalSkipped += r.skipped;
      } catch (err: any) {
        // Release the claim so the next hourly tick can retry.
        await this.redis.client.del(key).catch(() => undefined);
        this.logger.error(`Scorecard ${co.name} ${ym}: ${err.message}`);
      }
    }
    return { companies: companies.length, emailsSent: totalSent, skipped: totalSkipped };
  }

  private async runCompany(companyId: string, from: Date, to: Date) {
    const drivers = await this.prisma.driver.findMany({
      where: { companyId, active: true, email: { not: null } },
      select: { id: true, fullName: true, email: true },
    });
    if (drivers.length === 0) return { sent: 0, skipped: 0 };

    if (!this.email.enabled()) {
      this.logger.warn(`Scorecard ${companyId}: email disabled, skipping ${drivers.length} drivers`);
      return { sent: 0, skipped: drivers.length };
    }

    const actor = { role: 'SUPER_ADMIN' as const, companyId: null };
    let sent = 0;
    let skipped = 0;
    for (const d of drivers) {
      try {
        const data = await this.reports.driverScorecard(actor, d.id, from, to);
        if (data.daily.length < MIN_DAYS_WITH_DATA) {
          skipped++;
          continue;
        }
        const buf = await this.reports.driverScorecardPdf(actor, d.id, from, to);
        const ym = from.toISOString().slice(0, 7);
        const subject = `Fleex — Таны ${ym} сарын scorecard`;
        const body =
          `Сайн байна уу, ${d.fullName}.\n\n` +
          `Өмнөх сарын (${ym}) жолоодлогын дүн хавсралтад байна.\n` +
          `Дундаж оноо: ${data.score} / 100.\n` +
          `Нийт зам: ${data.totals.distanceKm} км, idle: ${data.totals.idleHours} ц.\n\n` +
          `Аюулгүй замыг хүсье,\nFleex`;
        await this.email.sendWithAttachments(
          [d.email!],
          subject,
          body,
          [{ filename: `scorecard-${ym}.pdf`, content: buf, contentType: 'application/pdf' }],
        );
        sent++;
      } catch (err: any) {
        this.logger.warn(`Scorecard driver ${d.id}: ${err.message}`);
      }
    }
    this.logger.log(`Scorecard ${companyId}: sent ${sent}, skipped ${skipped} of ${drivers.length}`);
    return { sent, skipped };
  }
}

// Returns the calendar window for the month *before* `asOf`, plus a
// YYYY-MM tag used as the dedup key.
function previousMonthWindow(asOf: Date): { from: Date; to: Date; ym: string } {
  const firstThis = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const firstPrev = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1));
  const ym = firstPrev.toISOString().slice(0, 7);
  return { from: firstPrev, to: firstThis, ym };
}
