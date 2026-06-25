import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Actor = { role: Role; companyId: string | null };

export interface FuelReading {
  t: Date;
  level: number; // calibrated (sensor unit: L or %)
  ignition?: boolean | null;
}

export interface FuelEvent {
  type: 'FUEL_FILL' | 'FUEL_DRAIN';
  at: Date;
  before: number;
  after: number;
  deltaL: number; // signed: + fill, − drain
  ignitionOff: boolean; // drain with engine off ⇒ likely theft
}

export interface FuelDetectOpts {
  fillL: number; // min rise to count as a refuelling
  drainL: number; // min drop to count as a drain/theft
  windowMs: number; // the rise/drop must happen within this window
}

export const DEFAULT_FUEL_OPTS: FuelDetectOpts = {
  fillL: 15,
  drainL: 10,
  windowMs: 20 * 60_000,
};

/**
 * Detect refuelling (sudden rise) and drain/theft (sudden drop) from a fuel
 * level series. Pure + synchronous so it's unit-testable. Slow consumption
 * while driving never trips the thresholds; only changes large enough within a
 * short window do. A drain while the engine is off is flagged as likely theft.
 */
export function detectFuelEvents(readings: FuelReading[], opts: FuelDetectOpts = DEFAULT_FUEL_OPTS): FuelEvent[] {
  const r = [...readings].sort((a, b) => a.t.getTime() - b.t.getTime());
  const out: FuelEvent[] = [];
  let i = 0;
  while (i < r.length - 1) {
    // Extend j to the furthest reading still inside the window from i.
    let j = i + 1;
    while (j + 1 < r.length && r[j + 1].t.getTime() - r[i].t.getTime() <= opts.windowMs) j++;
    // Only evaluate a pair that's actually within the window — otherwise sparse
    // reporting (gaps > window) would mis-read normal driving consumption as a
    // drain.
    if (r[j].t.getTime() - r[i].t.getTime() <= opts.windowMs) {
      const delta = r[j].level - r[i].level;
      if (delta >= opts.fillL) {
        out.push({ type: 'FUEL_FILL', at: r[j].t, before: r[i].level, after: r[j].level, deltaL: delta, ignitionOff: r[j].ignition === false });
        i = j;
        continue;
      }
      if (-delta >= opts.drainL) {
        out.push({ type: 'FUEL_DRAIN', at: r[j].t, before: r[i].level, after: r[j].level, deltaL: delta, ignitionOff: r[j].ignition === false });
        i = j;
        continue;
      }
    }
    i++;
  }
  return out;
}

@Injectable()
export class FuelAnalyticsService {
  private readonly logger = new Logger(FuelAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // On-demand analysis for one device+window (powers GET /reports/fuel/:id).
  async analyze(deviceId: string, from: Date, to: Date, actor: Actor, opts: Partial<FuelDetectOpts> = {}) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException('Device not found');
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();

    const sensor = await this.prisma.sensor.findFirst({
      where: { deviceId, type: 'FUEL_LEVEL', active: true },
    });
    if (!sensor) {
      return { deviceId, sensor: null, events: [], totalFilledL: 0, totalDrainedL: 0 };
    }
    const readings = await this.fetchReadings(deviceId, sensor, from, to);
    const events = detectFuelEvents(readings, { ...DEFAULT_FUEL_OPTS, ...opts });
    const totalFilledL = events.filter((e) => e.type === 'FUEL_FILL').reduce((a, e) => a + e.deltaL, 0);
    const totalDrainedL = events.filter((e) => e.type === 'FUEL_DRAIN').reduce((a, e) => a - e.deltaL, 0);
    return {
      deviceId,
      sensor: { name: sensor.name, unit: sensor.unit },
      events,
      totalFilledL: round1(totalFilledL),
      totalDrainedL: round1(totalDrainedL),
    };
  }

  // Periodic detector: persists new fuel events as Event rows so they show in
  // the events feed, fire notification rules, and feed the `fuel` report.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async runDetection() {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 3600_000); // last 6h
    const sensors = await this.prisma.sensor.findMany({ where: { type: 'FUEL_LEVEL', active: true } });
    let created = 0;
    for (const sensor of sensors) {
      try {
        const readings = await this.fetchReadings(sensor.deviceId, sensor, from, to);
        if (readings.length < 2) continue;
        const events = detectFuelEvents(readings);
        for (const e of events) {
          if (await this.alreadyRecorded(sensor.deviceId, e)) continue;
          await this.prisma.event.create({
            data: {
              companyId: sensor.companyId,
              deviceId: sensor.deviceId,
              type: e.type,
              severity: e.type === 'FUEL_DRAIN' ? (e.ignitionOff ? 'CRITICAL' : 'WARNING') : 'INFO',
              message:
                e.type === 'FUEL_FILL'
                  ? `Түлш цэнэглэлт +${round1(e.deltaL)}${sensor.unit ?? ''} (${round1(e.before)}→${round1(e.after)})`
                  : `Түлш буурлаа ${round1(e.deltaL)}${sensor.unit ?? ''}${e.ignitionOff ? ' (хөдөлгүүр унтарсан — хулгай сэжигтэй)' : ''}`,
              payload: { before: e.before, after: e.after, deltaL: e.deltaL, ignitionOff: e.ignitionOff },
              occurredAt: e.at,
            },
          });
          created++;
        }
      } catch (err) {
        this.logger.debug(`fuel detect ${sensor.deviceId}: ${(err as Error).message}`);
      }
    }
    if (created > 0) this.logger.log(`Fuel events created: ${created}`);
  }

  private async fetchReadings(deviceId: string, sensor: { sourceParam: string; multiplier: number; offset: number }, from: Date, to: Date): Promise<FuelReading[]> {
    // sourceParam "io.239" → the attributes JSON key "io_239" the ingestor writes.
    const key = sensor.sourceParam.replace(/\./g, '_');
    const rows = await this.prisma.$queryRaw<{ time: Date; raw: number | null; ignition: boolean | null }[]>`
      SELECT time, (attributes->>${key})::float AS raw, ignition
      FROM positions
      WHERE device_id = ${deviceId}::uuid
        AND time BETWEEN ${from} AND ${to}
        AND (attributes->>${key}) IS NOT NULL
      ORDER BY time ASC
    `;
    return rows
      .filter((r) => r.raw != null && Number.isFinite(r.raw))
      .map((r) => ({ t: r.time, level: (r.raw as number) * sensor.multiplier + sensor.offset, ignition: r.ignition }));
  }

  private async alreadyRecorded(deviceId: string, e: FuelEvent): Promise<boolean> {
    const tol = DEFAULT_FUEL_OPTS.windowMs;
    const existing = await this.prisma.event.findFirst({
      where: {
        deviceId,
        type: e.type,
        occurredAt: { gte: new Date(e.at.getTime() - tol), lte: new Date(e.at.getTime() + tol) },
      },
      select: { id: true },
    });
    return existing != null;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
