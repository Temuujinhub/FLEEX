import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';
import { EmailService } from '../notifications/email.service';

// 14-day-ahead reminder for upcoming service tasks. Builds on the
// odometer-extrapolation predictor (ServiceTasksService.upcomingPredictions)
// — when a task's predicted daysUntil enters the SOON bucket (≤14
// days), email a configured fleet manager so they can schedule the
// workshop slot before the asset is parked.
//
// Why we re-implement the prediction here rather than calling into
// ServiceTasksService: the cron runs across all tenants and doesn't
// have an authenticated actor. The math is small enough to inline.

const REMIND_WITHIN_DAYS = 14;
const COOLDOWN_DAYS = 7;
const COMPANY_TICK_CONCURRENCY = 4;

@Injectable()
export class ServiceReminderCronService {
  private readonly logger = new Logger(ServiceReminderCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly email: EmailService,
  ) {}

  // Once a day at 03:00 UTC — after the monthly scorecard mailer
  // (02:00) so the two don't contend for the SMTP/API rate limit.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async tick() {
    await this.run().catch((err) => this.logger.error(`service reminder: ${err.message}`));
  }

  async run(): Promise<{ companies: number; emailsSent: number }> {
    if (!this.email.enabled()) {
      this.logger.warn('Email disabled — skipping service reminders');
      return { companies: 0, emailsSent: 0 };
    }
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    let totalSent = 0;
    // Limit concurrency so a 50-company tenant doesn't fan out 50
    // queries simultaneously; we're CPU-bound on PDF later anyway.
    for (let i = 0; i < companies.length; i += COMPANY_TICK_CONCURRENCY) {
      const slice = companies.slice(i, i + COMPANY_TICK_CONCURRENCY);
      const results = await Promise.all(slice.map((c) => this.runCompany(c.id, c.name)));
      totalSent += results.reduce((a, b) => a + b, 0);
    }
    return { companies: companies.length, emailsSent: totalSent };
  }

  private async runCompany(companyId: string, companyName: string): Promise<number> {
    const tasks = await this.prisma.serviceTask.findMany({
      where: {
        companyId,
        status: { in: ['PLANNED', 'IN_PROGRESS', 'OVERDUE'] },
        scheduledOdometerKm: { not: null },
      },
      include: {
        device: { select: { id: true, name: true, plateNumber: true, odometerKm: true } },
      },
    });
    if (tasks.length === 0) return 0;

    // Recipients: every COMPANY_ADMIN + FLEET_MANAGER user with an email.
    const managers = await this.prisma.user.findMany({
      where: {
        companyId,
        role: { in: ['COMPANY_ADMIN', 'FLEET_MANAGER'] },
        email: { not: '' },
      },
      select: { email: true },
    });
    const to = managers.map((m) => m.email).filter(Boolean);
    if (to.length === 0) return 0;

    // Avg km/day per device over the trailing 30 days, same model the
    // /service-tasks/upcoming-predictions endpoint uses.
    const deviceIds = Array.from(new Set(tasks.map((t) => t.deviceId)));
    const since = new Date(Date.now() - 30 * 86_400_000);
    const trips = await this.prisma.trip.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: deviceIds }, startedAt: { gte: since } },
      _sum: { distanceKm: true },
    });
    const avgPerDay = new Map<string, number>();
    for (const t of trips) {
      avgPerDay.set(t.deviceId, (t._sum.distanceKm ?? 0) / 30);
    }

    const dueRows: Array<{
      deviceName: string;
      plate: string | null;
      title: string;
      daysUntil: number;
      remainingKm: number;
    }> = [];
    for (const t of tasks) {
      const odo = t.device.odometerKm ?? 0;
      const target = t.scheduledOdometerKm ?? 0;
      const remainingKm = Math.max(0, target - odo);
      const perDay = avgPerDay.get(t.deviceId) ?? 0;
      if (perDay <= 0) continue;
      const daysUntil = Math.ceil(remainingKm / perDay);
      if (daysUntil > REMIND_WITHIN_DAYS) continue;
      // Cooldown so the same task doesn't trigger every day for 14
      // days running — once a week is the right cadence.
      const key = `service-reminder:${t.id}`;
      const claim = await this.redis.client.set(key, '1', 'EX', COOLDOWN_DAYS * 86400, 'NX');
      if (claim !== 'OK') continue;
      dueRows.push({
        deviceName: t.device.name,
        plate: t.device.plateNumber,
        title: t.title,
        daysUntil,
        remainingKm,
      });
    }
    if (dueRows.length === 0) return 0;

    dueRows.sort((a, b) => a.daysUntil - b.daysUntil);
    const subject = `Fleex — Удахгүй хийгдэх засвар (${dueRows.length})`;
    const lines = dueRows.map(
      (r) =>
        `• ${r.deviceName}${r.plate ? ' (' + r.plate + ')' : ''}: ${r.title} — ~${r.daysUntil} хоног, ${r.remainingKm.toLocaleString('mn-MN')} км үлдсэн`,
    );
    const body =
      `Сайн байна уу.\n\n` +
      `${companyName} компанийн дараах засварууд 14 хоногийн дотор хийгдэх ёстой:\n\n` +
      lines.join('\n') +
      `\n\nFleex Засвар үйлчилгээ → /app/service-tasks хэсгээс цаг товлоорой.\n\nFleex`;
    await this.email.send(to, subject, body);
    this.logger.log(`Service reminder ${companyName}: ${dueRows.length} tasks → ${to.length} managers`);
    return dueRows.length;
  }
}
