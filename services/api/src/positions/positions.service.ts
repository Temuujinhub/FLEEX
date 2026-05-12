import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Positions live in a TimescaleDB hypertable that Prisma doesn't model
// directly. All access goes through tagged-template raw queries to keep
// types tight and avoid string concatenation.
export interface Position {
  time: Date;
  device_id: string;
  company_id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  altitude: number | null;
  satellites: number | null;
  ignition: boolean | null;
  odometer_km: number | null;
  engine_hours: number | null;
  battery_volt: number | null;
  attributes: Record<string, unknown> | null;
}

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async history(
    deviceId: string,
    actor: { role: Role; companyId: string | null },
    from: Date,
    to: Date,
    limit = 5000,
  ): Promise<Position[]> {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException('Device not found');
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();

    const safeLimit = Math.min(Math.max(limit, 1), 50_000);
    return this.prisma.$queryRaw<Position[]>`
      SELECT time, device_id::text, company_id::text, latitude, longitude,
             speed, course, altitude, satellites, ignition,
             odometer_km, engine_hours, battery_volt, attributes
      FROM positions
      WHERE device_id = ${deviceId}::uuid
        AND time BETWEEN ${from} AND ${to}
      ORDER BY time ASC
      LIMIT ${safeLimit};
    `;
  }

  async latest(actor: { role: Role; companyId: string | null }): Promise<Position[]> {
    // One row per device — the latest snapshot we hold. We read from the
    // devices table (already maintained by the ingestor) to keep this cheap.
    const where = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId! };
    const rows = await this.prisma.device.findMany({
      where,
      select: {
        id: true,
        companyId: true,
        name: true,
        imei: true,
        lastSeenAt: true,
        lastLat: true,
        lastLng: true,
        lastSpeed: true,
        lastCourse: true,
        ignitionOn: true,
      },
    });
    return rows
      .filter((d) => d.lastLat != null && d.lastLng != null && d.lastSeenAt != null)
      .map((d) => ({
        time: d.lastSeenAt!,
        device_id: d.id,
        company_id: d.companyId,
        latitude: d.lastLat!,
        longitude: d.lastLng!,
        speed: d.lastSpeed,
        course: d.lastCourse,
        altitude: null,
        satellites: null,
        ignition: d.ignitionOn,
        odometer_km: null,
        engine_hours: null,
        battery_volt: null,
        attributes: { name: d.name, imei: d.imei },
      }));
  }

  async dailySummary(deviceId: string, actor: { role: Role; companyId: string | null }, from: Date, to: Date) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.$queryRaw<any[]>`
      SELECT day, samples, max_speed, avg_speed, distance_km, engine_hours
      FROM positions_daily
      WHERE device_id = ${deviceId}::uuid
        AND day BETWEEN ${from}::date AND ${to}::date
      ORDER BY day ASC;
    `;
  }
}
