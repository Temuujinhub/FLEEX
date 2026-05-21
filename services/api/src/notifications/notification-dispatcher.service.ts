import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { EventType, NotificationChannel, NotificationRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { WebhookService } from './webhook.service';
import { renderTemplate } from './template';
import type { EventEnvelope } from './types';

const SEVERITY_RANK: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
const RULES_REFRESH_MS = 30_000;
// 5 km is the operational radius for the "panic ⇒ tell neighbours"
// broadcast — wide enough to find a responder in open pit operations,
// tight enough that we don't SMS the whole tenant on every press.
const PANIC_BROADCAST_RADIUS_KM = 5;
const PANIC_ONLINE_WINDOW_MS = 10 * 60_000;

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
    // PANIC events bypass the user-defined NotificationRule pipeline and
    // broadcast directly to any active driver within 5 km. This is the
    // HSE "press the red button" path — operators expect every nearby
    // responder to be paged regardless of whether they remembered to
    // configure a rule.
    if (ev.type === EventType.PANIC) {
      await this.broadcastPanic(ev).catch((err) =>
        this.logger.error(`panic broadcast: ${err.message}`),
      );
      // Don't return — still let rule-based notifications fire too so a
      // dispatcher-side SMS group still gets the page.
    }

    const rules = this.rulesByCompany.get(ev.companyId);
    if (!rules || rules.length === 0) return;

    const eventSeverity = SEVERITY_RANK[ev.severity] ?? 0;
    const placeIdForEvent = ev.geofenceId
      ? await this.lookupPlaceForGeofence(ev.geofenceId)
      : undefined;
    const matched = rules.filter((r) => this.matches(r, ev, eventSeverity, placeIdForEvent));
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

  private matches(
    rule: NotificationRule,
    ev: EventEnvelope,
    eventSeverity: number,
    placeIdForEvent?: string,
  ): boolean {
    if (rule.triggerType !== ev.type) return false;
    const minSeverity = SEVERITY_RANK[rule.minSeverity] ?? 0;
    if (eventSeverity < minSeverity) return false;
    if (rule.deviceIds.length > 0 && !rule.deviceIds.includes(ev.deviceId)) return false;
    if (rule.geofenceIds.length > 0) {
      if (!ev.geofenceId || !rule.geofenceIds.includes(ev.geofenceId)) return false;
    }
    if (rule.placeIds && rule.placeIds.length > 0) {
      if (!placeIdForEvent || !rule.placeIds.includes(placeIdForEvent)) return false;
    }
    // groupIds matching requires looking up the device's group at dispatch
    // time. For now we skip group-scoped rules until we add a device→group
    // cache; the UI still surfaces the field so rules persist as-is.
    return true;
  }

  // PANIC ⇒ pull active devices within 5 km, look up their driver
  // phones, and SMS each one with the panic location. Idempotency is
  // not a concern: a press triggers exactly one publish, and the
  // payload's eventId is the natural dedupe key downstream.
  private async broadcastPanic(ev: EventEnvelope) {
    if (typeof ev.lat !== 'number' || typeof ev.lng !== 'number') {
      this.logger.warn(`panic event ${ev.id} missing lat/lng; skipping broadcast`);
      return;
    }
    if (!this.sms.enabled()) {
      this.logger.warn(`panic ${ev.id}: SMS disabled, skipping nearby-responder broadcast`);
      return;
    }
    const since = new Date(Date.now() - PANIC_ONLINE_WINDOW_MS);
    const candidates = await this.prisma.device.findMany({
      where: {
        companyId: ev.companyId,
        status: 'ACTIVE',
        id: { not: ev.deviceId },
        lastSeenAt: { gte: since },
        lastLat: { not: null },
        lastLng: { not: null },
      },
      select: {
        id: true,
        name: true,
        plateNumber: true,
        lastLat: true,
        lastLng: true,
        driver: { select: { phone: true, fullName: true } },
      },
    });
    const responders = candidates.filter((c) => {
      if (c.lastLat == null || c.lastLng == null) return false;
      const km = haversineKm(ev.lat!, ev.lng!, c.lastLat, c.lastLng);
      return km <= PANIC_BROADCAST_RADIUS_KM;
    });
    const phones = responders
      .map((r) => r.driver?.phone)
      .filter((p): p is string => !!p);
    if (phones.length === 0) {
      this.logger.log(`panic ${ev.id}: no responders within ${PANIC_BROADCAST_RADIUS_KM}km with a phone on file`);
      return;
    }
    const deviceName = await this.lookupDeviceName(ev.deviceId);
    const link = `https://maps.google.com/?q=${ev.lat},${ev.lng}`;
    const text = `[Fleex PANIC] ${deviceName ?? ev.deviceId} тусламж хүсэж байна. Байршил: ${link}`;
    await this.sms.send(phones, text);
    this.logger.log(`panic ${ev.id}: SMS sent to ${phones.length} nearby responders`);
  }

  private async lookupPlaceForGeofence(geofenceId: string): Promise<string | undefined> {
    const place = await this.prisma.place.findFirst({
      where: { geofenceId },
      select: { id: true },
    });
    return place?.id;
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

// Great-circle distance in km between two lat/lng points. Inlined here
// rather than imported because it's a 6-line dependency-free helper
// used in exactly one call site (panic broadcast filtering).
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
