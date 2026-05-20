import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { NotificationChannel, NotificationRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { WebhookService } from './webhook.service';
import { renderTemplate } from './template';
import type { EventEnvelope } from './types';

const SEVERITY_RANK: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
const RULES_REFRESH_MS = 30_000;

// Subscribes to the `fleex.events` Redis channel and routes each event to
// EMAIL / SMS / WEBHOOK channels per the matching NotificationRule rows.
// IN_APP is handled separately by LiveGateway (WebSocket fanout), so we
// deliberately skip that channel here even when configured on the rule.
//
// Rules are cached in memory and refreshed every 30s. That's a deliberate
// trade-off — the rules UI doesn't push invalidations yet, and polling is
// cheap (a few hundred rows per tenant). Eventually we'd publish a
// "rules.changed" pub/sub event from the controller to invalidate sooner.
@Injectable()
export class NotificationDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private sub?: Redis;
  private rulesByCompany = new Map<string, NotificationRule[]>();
  private deviceNames = new Map<string, string>();
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly webhook: WebhookService,
  ) {}

  async onModuleInit() {
    await this.refreshRules();
    this.refreshTimer = setInterval(() => {
      this.refreshRules().catch((err) => this.logger.warn(`refresh rules: ${err.message}`));
    }, RULES_REFRESH_MS);

    this.sub = this.redis.duplicate();
    await this.sub.subscribe('fleex.events');
    this.sub.on('message', (channel, raw) => {
      if (channel !== 'fleex.events') return;
      let ev: EventEnvelope;
      try {
        ev = JSON.parse(raw);
      } catch {
        return;
      }
      this.handle(ev).catch((err) => this.logger.error(`dispatch: ${err.message}`));
    });
    this.logger.log('Notification dispatcher subscribed to fleex.events');
  }

  async onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await this.sub?.quit().catch(() => undefined);
  }

  private async refreshRules() {
    const rules = await this.prisma.notificationRule.findMany({ where: { active: true } });
    const grouped = new Map<string, NotificationRule[]>();
    for (const r of rules) {
      const list = grouped.get(r.companyId) ?? [];
      list.push(r);
      grouped.set(r.companyId, list);
    }
    this.rulesByCompany = grouped;
  }

  private async handle(ev: EventEnvelope) {
    const rules = this.rulesByCompany.get(ev.companyId);
    if (!rules || rules.length === 0) return;

    const eventSeverity = SEVERITY_RANK[ev.severity] ?? 0;
    const matched = rules.filter((r) => this.matches(r, ev, eventSeverity));
    if (matched.length === 0) return;

    const deviceName = await this.lookupDeviceName(ev.deviceId);

    await Promise.all(
      matched.map(async (rule) => {
        const message = renderTemplate(rule.template, ev, deviceName);
        const subject = `[Fleex] ${rule.name}`;
        const channels = new Set(rule.channels);

        const jobs: Promise<unknown>[] = [];
        if (channels.has(NotificationChannel.EMAIL) && rule.recipientEmails.length > 0) {
          jobs.push(this.email.send(rule.recipientEmails, subject, message));
        }
        if (channels.has(NotificationChannel.SMS) && rule.recipientPhones.length > 0) {
          jobs.push(this.sms.send(rule.recipientPhones, message));
        }
        if (channels.has(NotificationChannel.WEBHOOK) && rule.webhookUrl) {
          jobs.push(this.webhook.send(rule.webhookUrl, ev, message));
        }
        await Promise.allSettled(jobs);
      }),
    );
  }

  private matches(rule: NotificationRule, ev: EventEnvelope, eventSeverity: number): boolean {
    if (rule.triggerType !== ev.type) return false;
    const minSeverity = SEVERITY_RANK[rule.minSeverity] ?? 0;
    if (eventSeverity < minSeverity) return false;
    if (rule.deviceIds.length > 0 && !rule.deviceIds.includes(ev.deviceId)) return false;
    if (rule.geofenceIds.length > 0) {
      if (!ev.geofenceId || !rule.geofenceIds.includes(ev.geofenceId)) return false;
    }
    // groupIds matching requires looking up the device's group at dispatch
    // time. For now we skip group-scoped rules until we add a device→group
    // cache; the UI still surfaces the field so rules persist as-is.
    return true;
  }

  private async lookupDeviceName(deviceId: string): Promise<string | undefined> {
    if (this.deviceNames.has(deviceId)) return this.deviceNames.get(deviceId);
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { name: true, plateNumber: true, imei: true },
    });
    if (!device) return undefined;
    const name = device.name || device.plateNumber || device.imei;
    this.deviceNames.set(deviceId, name);
    return name;
  }
}
