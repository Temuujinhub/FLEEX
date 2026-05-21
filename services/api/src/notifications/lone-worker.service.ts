import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

// Lone-worker safety heuristic. The events-engine fires DEVICE_OFFLINE
// already, but that's just signal loss; what HSE actually wants is
// "during a working shift, this asset hasn't moved for 2 hours" — that
// pattern matches a fall, a heart attack, or a vehicle stuck in a
// remote area where the driver can't call for help.
//
// We poll once a minute (cheap; one query per tick) and emit a
// LONE_WORKER_RISK event the first time a device crosses either
// threshold. A 6h Redis cooldown prevents the same device from firing
// repeatedly while the situation persists; the operator is expected to
// either dispatch help or mark the event resolved, which clears the
// cooldown manually via the Events UI.
//
// The event is written directly to the events table (mirroring what
// the Go events-engine does) and published to fleex.events so the
// NotificationDispatcher can route it to any configured rule.

const TICK_MS = 60_000;
const OFFLINE_RISK_MS = 2 * 60 * 60_000;     // 2h no contact
const STATIONARY_RISK_MS = 2 * 60 * 60_000;  // 2h speed=0 with shift active
const COOLDOWN_SECONDS = 6 * 60 * 60;        // 6h between alerts per device
const SHIFT_HOURS_START = 6;                  // 06:00 — only fire during day shift
const SHIFT_HOURS_END = 22;                   // 22:00

@Injectable()
export class LoneWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoneWorkerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.scan().catch((err) => this.logger.warn(`lone-worker scan: ${err.message}`));
    }, TICK_MS);
    // Initial tick after 30s so the service has time to settle before
    // hammering the DB on cold start.
    setTimeout(() => this.scan().catch(() => undefined), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async scan() {
    const now = new Date();
    const hour = now.getHours();
    if (hour < SHIFT_HOURS_START || hour >= SHIFT_HOURS_END) return;

    const candidates = await this.prisma.device.findMany({
      where: {
        status: 'ACTIVE',
        driverId: { not: null },
      },
      select: {
        id: true,
        companyId: true,
        name: true,
        lastLat: true,
        lastLng: true,
        lastSpeed: true,
        lastSeenAt: true,
      },
    });
    if (candidates.length === 0) return;

    const nowMs = now.getTime();
    for (const d of candidates) {
      const lastSeen = d.lastSeenAt ? d.lastSeenAt.getTime() : 0;
      const offlineMs = lastSeen ? nowMs - lastSeen : 0;
      const stationary = (d.lastSpeed ?? 0) < 1;
      // Use last-seen as the stationary clock too — once the device has
      // gone quiet, lastSeenAt stops advancing, so the same delta tells
      // us how long the asset has been still. Stationary+OFFLINE both
      // collapse to "no fresh motion for N minutes".
      const stationaryMs = stationary ? offlineMs : 0;

      const offlineRisk = offlineMs >= OFFLINE_RISK_MS;
      const stationaryRisk = stationaryMs >= STATIONARY_RISK_MS;
      if (!offlineRisk && !stationaryRisk) continue;

      const fired = await this.tryClaimCooldown(d.id);
      if (!fired) continue;

      const reason = offlineRisk ? 'OFFLINE_2H' : 'STATIONARY_2H';
      const minutes = Math.round(offlineMs / 60_000);
      const message = offlineRisk
        ? `${d.name}: 2+ цаг чимээгүй болсон (сүүлд ${minutes}м өмнө)`
        : `${d.name}: 2+ цаг хөдөлгөөнгүй зогссон (сүүлд ${minutes}м өмнө)`;

      await this.publishRisk(d, reason, message).catch((err) =>
        this.logger.warn(`lone-worker publish ${d.id}: ${err.message}`),
      );
    }
  }

  private async tryClaimCooldown(deviceId: string): Promise<boolean> {
    const key = `safety:lone-worker:${deviceId}`;
    const client = this.redis.client;
    const set = await client.set(key, '1', 'EX', COOLDOWN_SECONDS, 'NX');
    return set === 'OK';
  }

  private async publishRisk(
    d: { id: string; companyId: string; lastLat: number | null; lastLng: number | null },
    reason: string,
    message: string,
  ) {
    const row = await this.prisma.event.create({
      data: {
        companyId: d.companyId,
        deviceId: d.id,
        type: 'LONE_WORKER_RISK',
        severity: 'WARNING',
        lat: d.lastLat,
        lng: d.lastLng,
        message,
        occurredAt: new Date(),
      },
    });

    // Mirror the events-engine envelope so NotificationDispatcher (and
    // the WS live gateway) handle it uniformly.
    const envelope = {
      id: row.id,
      companyId: row.companyId,
      deviceId: row.deviceId,
      geofenceId: null,
      type: row.type,
      severity: row.severity,
      lat: d.lastLat,
      lng: d.lastLng,
      message,
      reason,
      occurredAt: row.occurredAt.toISOString(),
    };
    await this.redis.client.publish('fleex.events', JSON.stringify(envelope));
    this.logger.log(`lone-worker: emitted ${reason} for device ${d.id}`);
  }
}
