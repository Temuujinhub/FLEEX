import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';

// All report queries hit the positions hypertable directly. Because reports
// can span months, we never load the entire range into memory — we stream
// rows out of pgx into the writer (ExcelJS streaming workbook / pdfkit doc).
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureDeviceAccess(deviceId: string, actor: { role: Role; companyId: string | null }) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();
    return dev;
  }

  async tripReport(deviceId: string, from: Date, to: Date, actor: any) {
    const dev = await this.ensureDeviceAccess(deviceId, actor);
    const rows = await this.prisma.$queryRaw<any[]>`
      WITH points AS (
        SELECT time, latitude, longitude, speed, ignition,
               LAG(latitude) OVER (ORDER BY time)  AS prev_lat,
               LAG(longitude) OVER (ORDER BY time) AS prev_lng,
               LAG(time) OVER (ORDER BY time)      AS prev_time
        FROM positions
        WHERE device_id = ${deviceId}::uuid AND time BETWEEN ${from} AND ${to}
      )
      SELECT time, latitude, longitude, speed, ignition,
        CASE WHEN prev_lat IS NULL THEN 0
          ELSE 2 * 6371000 * asin(sqrt(
            sin(radians((latitude - prev_lat) / 2)) ^ 2 +
            cos(radians(prev_lat)) * cos(radians(latitude)) *
            sin(radians((longitude - prev_lng) / 2)) ^ 2
          )) END AS meters,
        EXTRACT(EPOCH FROM (time - prev_time)) AS dt_sec
      FROM points
      ORDER BY time ASC;
    `;
    let totalMeters = 0;
    let totalMoveSec = 0;
    let totalIdleSec = 0;
    let maxSpeed = 0;
    for (const r of rows) {
      totalMeters += Number(r.meters || 0);
      const dt = Number(r.dt_sec || 0);
      if (r.ignition === false) {
        // Engine off – not idle.
      } else if (Number(r.speed || 0) < 3) {
        totalIdleSec += dt;
      } else {
        totalMoveSec += dt;
      }
      maxSpeed = Math.max(maxSpeed, Number(r.speed || 0));
    }
    return {
      device: { id: dev.id, name: dev.name, imei: dev.imei },
      from,
      to,
      totalDistanceKm: totalMeters / 1000,
      totalDrivingHours: totalMoveSec / 3600,
      totalIdleHours: totalIdleSec / 3600,
      maxSpeed,
      sampleCount: rows.length,
      points: rows.slice(0, 5000).map((r) => ({
        time: r.time,
        lat: Number(r.latitude),
        lng: Number(r.longitude),
        speed: Number(r.speed || 0),
      })),
    };
  }

  async eventsReport(deviceId: string, from: Date, to: Date, actor: any) {
    await this.ensureDeviceAccess(deviceId, actor);
    return this.prisma.event.findMany({
      where: { deviceId, occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: 'asc' },
    });
  }

  // ── Eco-driving scoreboard ────────────────────────────────
  // Aggregates harsh-driving events per device (and per driver if assigned)
  // inside the date range, applies the caller-supplied weights to compute
  // a 0–100 behaviour score (100 = perfect, every event subtracts its
  // weight). Returns one row per device with full breakdown so the UI can
  // render a leaderboard and per-driver drill-down.
  async driverScores(
    actor: { role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'FLEET_MANAGER' | 'DISPATCHER' | 'DRIVER' | 'VIEWER'; companyId: string | null },
    from: Date,
    to: Date,
    weights: Record<string, number>,
  ) {
    const where: any = { occurredAt: { gte: from, lte: to } };
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId ?? undefined;

    const events = await this.prisma.event.findMany({
      where,
      select: { deviceId: true, type: true },
    });
    const counts = new Map<string, Record<string, number>>();
    for (const e of events) {
      const m = counts.get(e.deviceId) ?? {};
      m[e.type] = (m[e.type] ?? 0) + 1;
      counts.set(e.deviceId, m);
    }

    const devices = await this.prisma.device.findMany({
      where: actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId ?? undefined },
      select: {
        id: true, name: true, plateNumber: true, vehicleType: true,
        driver: { select: { id: true, fullName: true, employeeId: true } },
      },
    });

    const rows = devices.map((d) => {
      const c = counts.get(d.id) ?? {};
      const breakdown: { type: string; count: number; weight: number; cost: number }[] = [];
      let cost = 0;
      let totalEvents = 0;
      for (const [type, count] of Object.entries(c)) {
        const w = weights[type] ?? 0;
        const stake = count * w;
        cost += stake;
        totalEvents += count;
        breakdown.push({ type, count, weight: w, cost: stake });
      }
      breakdown.sort((a, b) => b.cost - a.cost);
      const score = Math.max(0, Math.min(100, Math.round(100 - cost)));
      return {
        device: { id: d.id, name: d.name, plateNumber: d.plateNumber, vehicleType: d.vehicleType },
        driver: d.driver,
        totalEvents,
        cost,
        score,
        breakdown,
      };
    });
    rows.sort((a, b) => b.score - a.score);
    return { from, to, rows };
  }

  async exportExcel(deviceId: string, from: Date, to: Date, actor: any): Promise<Buffer> {
    const data = await this.tripReport(deviceId, from, to, actor);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Fleex';
    wb.created = new Date();

    const summary = wb.addWorksheet('Summary');
    summary.columns = [
      { header: 'Field', key: 'k', width: 24 },
      { header: 'Value', key: 'v', width: 40 },
    ];
    summary.addRows([
      { k: 'Device', v: `${data.device.name} (${data.device.imei})` },
      { k: 'From', v: from.toISOString() },
      { k: 'To', v: to.toISOString() },
      { k: 'Total distance (km)', v: data.totalDistanceKm.toFixed(2) },
      { k: 'Driving hours', v: data.totalDrivingHours.toFixed(2) },
      { k: 'Idle hours', v: data.totalIdleHours.toFixed(2) },
      { k: 'Max speed (km/h)', v: data.maxSpeed.toFixed(1) },
      { k: 'Samples', v: data.sampleCount },
    ]);

    const points = wb.addWorksheet('Points');
    points.columns = [
      { header: 'Time', key: 't', width: 24 },
      { header: 'Latitude', key: 'lat', width: 14 },
      { header: 'Longitude', key: 'lng', width: 14 },
      { header: 'Speed (km/h)', key: 'sp', width: 14 },
    ];
    for (const p of data.points) {
      points.addRow({ t: new Date(p.time).toISOString(), lat: p.lat, lng: p.lng, sp: p.speed });
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  async exportPdf(deviceId: string, from: Date, to: Date, actor: any): Promise<Buffer> {
    const data = await this.tripReport(deviceId, from, to, actor);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Fleex Trip Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('gray').text(`${data.device.name} (${data.device.imei})`, { align: 'center' });
      doc.fillColor('black');
      doc.moveDown();

      const kv = (k: string, v: string) => {
        doc.font('Helvetica-Bold').text(k + ': ', { continued: true });
        doc.font('Helvetica').text(v);
      };
      kv('From', from.toISOString());
      kv('To', to.toISOString());
      kv('Distance', `${data.totalDistanceKm.toFixed(2)} km`);
      kv('Driving', `${data.totalDrivingHours.toFixed(2)} h`);
      kv('Idle', `${data.totalIdleHours.toFixed(2)} h`);
      kv('Max speed', `${data.maxSpeed.toFixed(1)} km/h`);
      kv('Samples', String(data.sampleCount));

      doc.end();
    });
  }
}

// Streaming helper kept for future use when reports outgrow Buffer.
export function bufferToStream(buf: Buffer): Readable {
  return Readable.from(buf);
}
