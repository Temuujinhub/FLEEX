import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildDailySummary,
  buildEngineSessions,
  buildIdlePeriods,
  buildTripSegments,
  computeFuelConsumption,
  type RawPosition,
} from './report-builders';
import {
  engineSessionsExcel,
  engineSessionsPdf,
  eventsExcel,
  eventsPdf,
  fuelConsumptionExcel,
  fuelConsumptionPdf,
  hardenWorkbook,
  idlePeriodsExcel,
  idlePeriodsPdf,
  mileageExcel,
  mileagePdf,
  tripSegmentsExcel,
  tripSegmentsPdf,
  utilizationExcel,
  utilizationPdf,
  type DailyTotals,
  type DeviceHeader,
  type FuelConsumptionData,
  type ReportRange,
} from './report-exporters';

// Per-template metadata used by the dispatcher: which event types each
// event-driven report filters to, and what title/filename it exports under.
// Trip/idle/engine/idle-billing templates are handled separately because
// they reshape positions rather than filter events.
export const REPORT_TEMPLATES = {
  // Trip / engine family — all hit the positions hypertable and feed
  // builders in report-builders.ts.
  trip:      { kind: 'trip',     title: 'Зорчилт',                    fileStem: 'trips' },
  idle:      { kind: 'idle',     title: 'Зогсолт',                    fileStem: 'idle-periods' },
  engine:    { kind: 'engine',   title: 'Мото цаг',                   fileStem: 'engine-hours' },
  // Daily rollups (Wialon-parity): per-day distance, utilization, nominal fuel.
  mileage:          { kind: 'mileage',          title: 'Гүйлт (өдрөөр)',              fileStem: 'mileage' },
  utilization:      { kind: 'utilization',      title: 'Ашиглалт (өдрөөр)',           fileStem: 'utilization' },
  fuel_consumption: { kind: 'fuel_consumption', title: 'Шатхууны зарцуулалт (норм)',  fileStem: 'fuel-consumption' },
  // Event family — same Event-table query, different filter.
  driver:    { kind: 'events',   title: 'Жолоочийн зан төлөв',        fileStem: 'driver-behaviour',
               filter: ['HARSH_ACCEL', 'HARSH_BRAKE', 'HARSH_CORNER'] },
  overspeed: { kind: 'events',   title: 'Хурд хэтрэлт',               fileStem: 'overspeed',
               filter: ['OVERSPEED'] },
  panic:     { kind: 'events',   title: 'Panic дохио',                fileStem: 'panic',
               filter: ['PANIC'] },
  geofence:  { kind: 'events',   title: 'Хязгаар бүс зөрчил',         fileStem: 'geofence',
               filter: ['GEOFENCE_ENTER', 'GEOFENCE_EXIT'] },
  safety:    { kind: 'events',   title: 'Аюулгүй байдлын тойм',       fileStem: 'safety',
               filter: undefined as string[] | undefined },
  ignition:  { kind: 'events',   title: 'Хөдөлгүүр асаалт/унтраалт',  fileStem: 'ignition',
               filter: ['IGNITION_ON', 'IGNITION_OFF'] },
  offline:   { kind: 'events',   title: 'Сүлжээ тасалдалт',           fileStem: 'offline',
               filter: ['DEVICE_OFFLINE', 'DEVICE_ONLINE'] },
  power:     { kind: 'events',   title: 'Цахилгаан · батарей',        fileStem: 'power',
               filter: ['POWER_CUT', 'LOW_BATTERY'] },
  tamper:    { kind: 'events',   title: 'Хөндөлт (Tamper)',           fileStem: 'tamper',
               filter: ['TAMPER'] },
  fuel:      { kind: 'events',   title: 'Түлш (цэнэглэлт/задрал)',     fileStem: 'fuel',
               filter: ['FUEL_FILL', 'FUEL_DRAIN'] },
} as const;

export type ReportTemplateId = keyof typeof REPORT_TEMPLATES;

export function isReportTemplateId(s: string): s is ReportTemplateId {
  return Object.prototype.hasOwnProperty.call(REPORT_TEMPLATES, s);
}

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

  // Shared raw-positions fetch used by every position-based report. Returns
  // rows with the windowed meters / dt_sec columns the builders expect.
  private async fetchPositionsWindow(deviceId: string, from: Date, to: Date): Promise<RawPosition[]> {
    const rows = await this.prisma.$queryRaw<RawPosition[]>`
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
    // Prisma returns Decimal for some numeric columns — coerce to plain
    // JS numbers so the builders' arithmetic doesn't accidentally do
    // string concatenation.
    return rows.map((r) => ({
      ...r,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      speed: r.speed == null ? null : Number(r.speed),
      meters: r.meters == null ? 0 : Number(r.meters),
      dt_sec: r.dt_sec == null ? 0 : Number(r.dt_sec),
    }));
  }

  async tripReport(deviceId: string, from: Date, to: Date, actor: any) {
    const dev = await this.ensureDeviceAccess(deviceId, actor);
    const rows = await this.fetchPositionsWindow(deviceId, from, to);
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

  // Engine-hours report: returns one row per ignition-on→off cycle (or per
  // motion-detected session when no ignition signal exists). Used by the
  // "Мото цаг" template's UI table and Excel/PDF export.
  async engineSessionsReport(deviceId: string, from: Date, to: Date, actor: any) {
    const dev = await this.ensureDeviceAccess(deviceId, actor);
    const rows = await this.fetchPositionsWindow(deviceId, from, to);
    const sessions = buildEngineSessions(rows);
    const totalEngineHours = sessions.reduce((s, x) => s + x.durationMin / 60, 0);
    const totalDrivingHours = sessions.reduce((s, x) => s + x.drivingMin / 60, 0);
    const totalIdleHours = sessions.reduce((s, x) => s + x.idleMin / 60, 0);
    const distanceKm = sessions.reduce((s, x) => s + x.distanceKm, 0);
    const maxSpeed = sessions.reduce((m, x) => Math.max(m, x.maxSpeed), 0);
    return {
      device: { id: dev.id, name: dev.name, plateNumber: dev.plateNumber, imei: dev.imei },
      from, to,
      detection: sessions[0]?.detection ?? 'ignition',
      totals: { totalEngineHours, totalDrivingHours, totalIdleHours, distanceKm, maxSpeed },
      sessions,
    };
  }

  // Trip-segments report: one row per contiguous moving stretch.
  async tripSegmentsReport(deviceId: string, from: Date, to: Date, actor: any) {
    const dev = await this.ensureDeviceAccess(deviceId, actor);
    const rows = await this.fetchPositionsWindow(deviceId, from, to);
    const segments = buildTripSegments(rows);
    const distanceKm = segments.reduce((s, t) => s + t.distanceKm, 0);
    const durationMin = segments.reduce((s, t) => s + t.durationMin, 0);
    const maxSpeed = segments.reduce((m, t) => Math.max(m, t.maxSpeedKmh), 0);
    const avgSpeed = durationMin > 0 ? distanceKm / (durationMin / 60) : 0;
    return {
      device: { id: dev.id, name: dev.name, plateNumber: dev.plateNumber, imei: dev.imei },
      from, to,
      totals: { distanceKm, durationMin, maxSpeed, avgSpeed },
      segments,
    };
  }

  // Idle-periods report: one row per stop ≥ 1 minute while engine is on.
  async idlePeriodsReport(deviceId: string, from: Date, to: Date, actor: any) {
    const dev = await this.ensureDeviceAccess(deviceId, actor);
    const rows = await this.fetchPositionsWindow(deviceId, from, to);
    const periods = buildIdlePeriods(rows);
    const totalIdleHours = periods.reduce((s, p) => s + p.durationMin / 60, 0);
    return {
      device: { id: dev.id, name: dev.name, plateNumber: dev.plateNumber, imei: dev.imei },
      from, to,
      totals: { totalIdleHours, periodCount: periods.length },
      periods,
    };
  }

  // Daily summary: one row per UTC day with distance / engine-on / moving /
  // idle. Backs both the Mileage and Utilization reports (and feeds the
  // nominal fuel-consumption estimate) — Wialon's most-used "per day" tables.
  async dailySummaryReport(deviceId: string, from: Date, to: Date, actor: any) {
    const dev = await this.ensureDeviceAccess(deviceId, actor);
    const rows = await this.fetchPositionsWindow(deviceId, from, to);
    const { days, hasIgnition } = buildDailySummary(rows);
    const totals: DailyTotals = days.reduce(
      (acc, d) => {
        acc.distanceKm += d.distanceKm;
        acc.movingMin += d.movingMin;
        acc.idleMin += d.idleMin;
        acc.engineOnMin += d.engineOnMin;
        acc.maxSpeed = Math.max(acc.maxSpeed, d.maxSpeed);
        return acc;
      },
      { distanceKm: 0, movingMin: 0, idleMin: 0, engineOnMin: 0, maxSpeed: 0 } as DailyTotals,
    );
    return {
      device: { id: dev.id, name: dev.name, plateNumber: dev.plateNumber, imei: dev.imei },
      from, to, hasIgnition, totals, days,
    };
  }

  // Nominal fuel consumption: distance × the device's configured L/100km. Needs
  // no fuel sensor (that's the `fuel` template / R2 analytics) — it estimates
  // burn from the catalogue rate so every vehicle gets a fuel figure.
  async fuelConsumptionReport(deviceId: string, from: Date, to: Date, actor: any) {
    const dev = await this.ensureDeviceAccess(deviceId, actor);
    const rate = Number(dev.fuelConsumptionL100Km ?? 0);
    const rows = await this.fetchPositionsWindow(deviceId, from, to);
    const { days } = buildDailySummary(rows);
    const calc = computeFuelConsumption(
      days.map((d) => ({ date: d.date, distanceKm: d.distanceKm })),
      rate,
    );
    return {
      device: { id: dev.id, name: dev.name, plateNumber: dev.plateNumber, imei: dev.imei },
      from, to,
      rateL100Km: rate,
      tankCapacityL: dev.tankCapacityL != null ? Number(dev.tankCapacityL) : null,
      totals: { distanceKm: calc.totalDistanceKm, estLiters: calc.totalEstLiters, avgRateL100Km: rate },
      days: calc.rows,
    };
  }

  async eventsReport(deviceId: string, from: Date, to: Date, actor: any, types?: string[]) {
    await this.ensureDeviceAccess(deviceId, actor);
    const where: any = { deviceId, occurredAt: { gte: from, lte: to } };
    if (types && types.length > 0) {
      where.type = { in: types as any };
    }
    return this.prisma.event.findMany({
      where,
      orderBy: { occurredAt: 'asc' },
    });
  }

  // Template-aware export dispatcher. Looks at the template ID, picks the
  // right data shaper + exporter, and returns { buffer, filename } so the
  // controller can attach a meaningful Content-Disposition. The legacy
  // /reports/trip/:deviceId/{excel,pdf} endpoints stay alive (they call
  // exportExcel / exportPdf below) for any external consumer still using
  // them, but the UI routes through here exclusively.
  async exportTemplate(
    tplId: ReportTemplateId,
    deviceId: string,
    from: Date,
    to: Date,
    format: 'excel' | 'pdf',
    actor: any,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const tpl = REPORT_TEMPLATES[tplId];
    const dev = await this.ensureDeviceAccess(deviceId, actor);
    const device: DeviceHeader = {
      name: dev.name,
      plateNumber: dev.plateNumber,
      imei: dev.imei,
    };
    const range: ReportRange = { from, to };
    const plate = dev.plateNumber || dev.name.replace(/\s+/g, '-') || dev.id.slice(0, 8);
    const stamp = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
    const ext = format === 'excel' ? 'xlsx' : 'pdf';
    const filename = `${tpl.fileStem}-${plate}-${stamp}.${ext}`;

    let buffer: Buffer;
    if (tpl.kind === 'engine') {
      const data = await this.engineSessionsReport(deviceId, from, to, actor);
      buffer = format === 'excel'
        ? await engineSessionsExcel(device, range, data.sessions, data.totals)
        : await engineSessionsPdf(device, range, data.sessions, data.totals);
    } else if (tpl.kind === 'trip') {
      const data = await this.tripSegmentsReport(deviceId, from, to, actor);
      buffer = format === 'excel'
        ? await tripSegmentsExcel(device, range, data.segments, data.totals)
        : await tripSegmentsPdf(device, range, data.segments, data.totals);
    } else if (tpl.kind === 'idle') {
      const data = await this.idlePeriodsReport(deviceId, from, to, actor);
      buffer = format === 'excel'
        ? await idlePeriodsExcel(device, range, data.periods, data.totals)
        : await idlePeriodsPdf(device, range, data.periods, data.totals);
    } else if (tpl.kind === 'mileage') {
      const data = await this.dailySummaryReport(deviceId, from, to, actor);
      buffer = format === 'excel'
        ? await mileageExcel(device, range, data.days, data.totals)
        : await mileagePdf(device, range, data.days, data.totals);
    } else if (tpl.kind === 'utilization') {
      const data = await this.dailySummaryReport(deviceId, from, to, actor);
      buffer = format === 'excel'
        ? await utilizationExcel(device, range, data.days, data.totals, data.hasIgnition)
        : await utilizationPdf(device, range, data.days, data.totals, data.hasIgnition);
    } else if (tpl.kind === 'fuel_consumption') {
      const data = await this.fuelConsumptionReport(deviceId, from, to, actor);
      const fc: FuelConsumptionData = {
        rateL100Km: data.rateL100Km,
        tankCapacityL: data.tankCapacityL,
        totals: { distanceKm: data.totals.distanceKm, estLiters: data.totals.estLiters },
        days: data.days,
      };
      buffer = format === 'excel'
        ? await fuelConsumptionExcel(device, range, fc)
        : await fuelConsumptionPdf(device, range, fc);
    } else {
      // events kind — covers driver, overspeed, panic, geofence, safety,
      // ignition, offline, power, tamper. tpl.filter narrows the type set;
      // safety passes undefined to grab everything in the window.
      const evTpl = tpl as { filter?: string[]; title: string };
      const events = await this.eventsReport(deviceId, from, to, actor, evTpl.filter);
      const meta = {
        title: evTpl.title,
        subtitle: evTpl.filter
          ? `Шүүлт: ${evTpl.filter.join(', ')}`
          : 'Бүх төрлийн дохиолол',
      };
      buffer = format === 'excel'
        ? await eventsExcel(meta, device, range, events)
        : await eventsPdf(meta, device, range, events);
    }
    return { buffer, filename };
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
    shiftId?: string,
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

    // Shift filter applies at the device level via the device's
    // current driver assignment. A device with no driver, or whose
    // driver isn't on the requested shift, is excluded — same model
    // the idle billing report uses, kept consistent so a manager who
    // expects "this driver in this shift" sees the same row set.
    const deviceWhere: any = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId ?? undefined };
    if (shiftId) deviceWhere.driver = { shiftId };

    const devices = await this.prisma.device.findMany({
      where: deviceWhere,
      select: {
        id: true, name: true, plateNumber: true, vehicleType: true,
        driver: {
          select: {
            id: true, fullName: true, employeeId: true,
            shift: { select: { id: true, name: true, color: true } },
          },
        },
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
    hardenWorkbook(wb); // formula-injection guard (audit M2)
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

  // ── Historical proximity report ────────────────────────────
  // "Which vehicles were within R meters of point (lat, lng) between
  // [from, to]?" Backs the Oyu Tolgoi requirement for proximity search
  // and is used for incident investigation ("who was near the panic
  // event location") and operational analysis ("how many trucks
  // visited refuelling bay #3 today"). Uses Haversine in raw SQL on
  // the positions hypertable so we don't ship a million rows through
  // the API just to filter them in JS. A bounding-box pre-filter keeps
  // TimescaleDB chunk pruning effective even on year-long ranges.
  async proximityReport(
    actor: { role: Role; companyId: string | null },
    from: Date,
    to: Date,
    lat: number,
    lng: number,
    radiusM: number,
  ) {
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new NotFoundException('Invalid coordinates');
    }
    const clampedRadius = Math.max(10, Math.min(50_000, radiusM));

    // Pad the bbox by 20% so we never miss a candidate on the boundary
    // (especially relevant near the poles where the cos(lat) lookup
    // gets numerically unstable).
    const latPad = (clampedRadius / 111_000) * 1.2;
    const lngPad = (clampedRadius / (111_000 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)))) * 1.2;

    const isSuper = actor.role === 'SUPER_ADMIN';
    // For non-SUPER_ADMIN we filter by company_id; for SUPER_ADMIN we pass
    // any valid UUID alongside `isSuper=true` so the OR short-circuits
    // without forcing the planner to cast an empty string to uuid (which
    // would error during planning even though the branch is unreachable).
    const companyId = actor.companyId ?? '00000000-0000-0000-0000-000000000000';

    const rows = await this.prisma.$queryRaw<
      Array<{
        device_id: string;
        time: Date;
        latitude: number;
        longitude: number;
        speed: number | null;
        distance_m: number;
        device_name: string;
        plate_number: string | null;
        imei: string;
      }>
    >`
      SELECT
        p.device_id,
        p.time,
        p.latitude,
        p.longitude,
        p.speed,
        d.name AS device_name,
        d."plateNumber" AS plate_number,
        d.imei,
        2 * 6371000 * asin(sqrt(
          power(sin(radians((p.latitude - ${lat}) / 2)), 2) +
          cos(radians(${lat})) * cos(radians(p.latitude)) *
          power(sin(radians((p.longitude - ${lng}) / 2)), 2)
        )) AS distance_m
      FROM positions p
      JOIN devices d ON d.id = p.device_id
      WHERE p.time BETWEEN ${from} AND ${to}
        AND (${isSuper} OR p.company_id = ${companyId}::uuid)
        AND p.latitude BETWEEN ${lat - latPad} AND ${lat + latPad}
        AND p.longitude BETWEEN ${lng - lngPad} AND ${lng + lngPad}
        AND 2 * 6371000 * asin(sqrt(
          power(sin(radians((p.latitude - ${lat}) / 2)), 2) +
          cos(radians(${lat})) * cos(radians(p.latitude)) *
          power(sin(radians((p.longitude - ${lng}) / 2)), 2)
        )) <= ${clampedRadius}
      ORDER BY p.time ASC
      LIMIT 5000;
    `;

    // Roll the row-level hits up to a per-device summary so the UI can
    // show "5 vehicles passed within range; truck #42 came closest at
    // 12m". The full row list is also returned for the table view.
    const perDevice = new Map<
      string,
      {
        deviceId: string;
        deviceName: string;
        plateNumber: string | null;
        imei: string;
        hits: number;
        minDistanceM: number;
        firstSeenAt: Date;
        lastSeenAt: Date;
      }
    >();
    for (const r of rows) {
      const existing = perDevice.get(r.device_id);
      if (!existing) {
        perDevice.set(r.device_id, {
          deviceId: r.device_id,
          deviceName: r.device_name,
          plateNumber: r.plate_number,
          imei: r.imei,
          hits: 1,
          minDistanceM: Number(r.distance_m),
          firstSeenAt: r.time,
          lastSeenAt: r.time,
        });
      } else {
        existing.hits += 1;
        existing.minDistanceM = Math.min(existing.minDistanceM, Number(r.distance_m));
        if (r.time < existing.firstSeenAt) existing.firstSeenAt = r.time;
        if (r.time > existing.lastSeenAt) existing.lastSeenAt = r.time;
      }
    }

    return {
      query: { lat, lng, radiusM: clampedRadius, from, to },
      truncated: rows.length >= 5000,
      summary: [...perDevice.values()].sort((a, b) => a.minDistanceM - b.minDistanceM),
      hits: rows.map((r) => ({
        deviceId: r.device_id,
        deviceName: r.device_name,
        plateNumber: r.plate_number,
        imei: r.imei,
        time: r.time,
        lat: Number(r.latitude),
        lng: Number(r.longitude),
        speed: r.speed != null ? Number(r.speed) : null,
        distanceM: Number(r.distance_m),
      })),
    };
  }

  async proximityExportExcel(
    actor: { role: Role; companyId: string | null },
    from: Date,
    to: Date,
    lat: number,
    lng: number,
    radiusM: number,
  ): Promise<Buffer> {
    const data = await this.proximityReport(actor, from, to, lat, lng, radiusM);
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet('Summary');
    summary.columns = [
      { header: 'Vehicle', key: 'deviceName', width: 28 },
      { header: 'Plate', key: 'plateNumber', width: 14 },
      { header: 'IMEI', key: 'imei', width: 20 },
      { header: 'Hits', key: 'hits', width: 8 },
      { header: 'Min distance (m)', key: 'minDistanceM', width: 16 },
      { header: 'First seen', key: 'firstSeenAt', width: 22 },
      { header: 'Last seen', key: 'lastSeenAt', width: 22 },
    ];
    for (const row of data.summary) {
      summary.addRow({
        ...row,
        minDistanceM: Math.round(row.minDistanceM),
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      });
    }

    const hits = wb.addWorksheet('Hits');
    hits.columns = [
      { header: 'Time', key: 'time', width: 22 },
      { header: 'Vehicle', key: 'deviceName', width: 28 },
      { header: 'Plate', key: 'plateNumber', width: 14 },
      { header: 'Lat', key: 'lat', width: 12 },
      { header: 'Lng', key: 'lng', width: 12 },
      { header: 'Distance (m)', key: 'distanceM', width: 14 },
      { header: 'Speed', key: 'speed', width: 8 },
    ];
    for (const row of data.hits) {
      hits.addRow({
        ...row,
        time: row.time.toISOString(),
        distanceM: Math.round(row.distanceM),
      });
    }

    hardenWorkbook(wb); // formula-injection guard (audit M2)
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ── Idle billing ────────────────────────────────────────────────
  // Aggregates DriverScore.idleS over the requested window, multiplies
  // by the per-hour tariff supplied by the caller, and returns one row
  // per driver plus a grand total. Surfaces a financial number ops can
  // bill back to the operating site for unproductive engine-on time.
  async idleBilling(
    actor: { role: Role; companyId: string | null },
    from: Date,
    to: Date,
    tariffPerHour: number,
    shiftId?: string,
  ): Promise<{
    from: string;
    to: string;
    tariffPerHour: number;
    shiftId: string | null;
    rows: Array<{
      driverId: string;
      driverName: string;
      employeeId: string | null;
      shiftName: string | null;
      idleS: number;
      idleHours: number;
      amount: number;
    }>;
    totals: { idleS: number; idleHours: number; amount: number };
  }> {
    const where: any = { date: { gte: from, lte: to } };
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId ?? undefined;
    // Shift filter joins through Driver. We push the predicate into
    // the relational filter so PG does the work and we don't ship
    // unwanted rows over the wire.
    if (shiftId) where.driver = { shiftId };

    const scores = await this.prisma.driverScore.findMany({
      where,
      select: {
        driverId: true,
        idleS: true,
        driver: {
          select: {
            fullName: true,
            employeeId: true,
            shift: { select: { name: true } },
          },
        },
      },
    });

    const byDriver = new Map<
      string,
      { driverName: string; employeeId: string | null; shiftName: string | null; idleS: number }
    >();
    for (const s of scores) {
      const cur = byDriver.get(s.driverId) ?? {
        driverName: s.driver?.fullName ?? '—',
        employeeId: s.driver?.employeeId ?? null,
        shiftName: s.driver?.shift?.name ?? null,
        idleS: 0,
      };
      cur.idleS += s.idleS;
      byDriver.set(s.driverId, cur);
    }

    const rows = Array.from(byDriver.entries())
      .map(([driverId, v]) => {
        const idleHours = v.idleS / 3600;
        return {
          driverId,
          driverName: v.driverName,
          employeeId: v.employeeId,
          shiftName: v.shiftName,
          idleS: v.idleS,
          idleHours: Math.round(idleHours * 100) / 100,
          amount: Math.round(idleHours * tariffPerHour),
        };
      })
      .sort((a, b) => b.idleS - a.idleS);

    const totals = rows.reduce(
      (acc, r) => {
        acc.idleS += r.idleS;
        acc.idleHours += r.idleHours;
        acc.amount += r.amount;
        return acc;
      },
      { idleS: 0, idleHours: 0, amount: 0 },
    );
    totals.idleHours = Math.round(totals.idleHours * 100) / 100;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      tariffPerHour,
      shiftId: shiftId ?? null,
      rows,
      totals,
    };
  }

  // ── Driver scorecard (PDF, on-demand) ──────────────────────────
  // One driver, one month: aggregate DriverScore rows + Trip totals
  // and render a single-page PDF the manager can attach to the monthly
  // review. The cron-scheduled "1st of month, e-mail to driver" loop
  // is deferred (roadmap Эрэмбэ 2 v2) — what's here today is the
  // hand-pulled version that exercises the same data path.
  async driverScorecard(
    actor: { role: Role; companyId: string | null },
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<{
    driver: { id: string; fullName: string; employeeId: string | null };
    period: { from: string; to: string };
    totals: {
      distanceKm: number;
      drivingHours: number;
      idleHours: number;
      harshAccel: number;
      harshBrake: number;
      harshCorner: number;
      speedingEvents: number;
    };
    score: number;
    daily: Array<{ date: string; score: number; distanceKm: number }>;
  }> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, fullName: true, employeeId: true, companyId: true },
    });
    if (!driver) throw new Error('Driver not found');
    if (actor.role !== 'SUPER_ADMIN' && driver.companyId !== actor.companyId) {
      throw new Error('Forbidden');
    }
    const scores = await this.prisma.driverScore.findMany({
      where: { driverId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    const totals = scores.reduce(
      (acc, s) => {
        acc.distanceKm += s.distanceKm;
        acc.drivingHours += s.durationS / 3600;
        acc.idleHours += s.idleS / 3600;
        acc.harshAccel += s.harshAccel;
        acc.harshBrake += s.harshBrake;
        acc.harshCorner += s.harshCorner;
        acc.speedingEvents += s.speedingEvents;
        return acc;
      },
      {
        distanceKm: 0, drivingHours: 0, idleHours: 0,
        harshAccel: 0, harshBrake: 0, harshCorner: 0, speedingEvents: 0,
      },
    );
    const score = scores.length === 0
      ? 100
      : scores.reduce((s, r) => s + r.score, 0) / scores.length;
    return {
      driver: { id: driver.id, fullName: driver.fullName, employeeId: driver.employeeId },
      period: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        distanceKm: Math.round(totals.distanceKm * 10) / 10,
        drivingHours: Math.round(totals.drivingHours * 10) / 10,
        idleHours: Math.round(totals.idleHours * 10) / 10,
        harshAccel: totals.harshAccel,
        harshBrake: totals.harshBrake,
        harshCorner: totals.harshCorner,
        speedingEvents: totals.speedingEvents,
      },
      score: Math.round(score * 10) / 10,
      daily: scores.map((s) => ({
        date: s.date.toISOString().slice(0, 10),
        score: Math.round(s.score * 10) / 10,
        distanceKm: Math.round(s.distanceKm * 10) / 10,
      })),
    };
  }

  async driverScorecardPdf(
    actor: { role: Role; companyId: string | null },
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<Buffer> {
    const data = await this.driverScorecard(actor, driverId, from, to);
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Fleex — Жолоочийн scorecard', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('gray').text(
        `${data.driver.fullName}${data.driver.employeeId ? ' · ' + data.driver.employeeId : ''}`,
        { align: 'center' },
      );
      doc.fillColor('black');
      doc.moveDown();

      const kv = (k: string, v: string) => {
        doc.font('Helvetica-Bold').text(k + ': ', { continued: true });
        doc.font('Helvetica').text(v);
      };
      kv('Хугацаа', `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);
      doc.moveDown(0.5);

      doc.fontSize(28).fillColor(data.score >= 80 ? '#059669' : data.score >= 60 ? '#d97706' : '#dc2626')
        .text(`Дундаж оноо: ${data.score.toFixed(1)} / 100`, { align: 'center' });
      doc.fillColor('black').fontSize(11);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('Хураангуй');
      doc.font('Helvetica');
      kv('Нийт зам', `${data.totals.distanceKm} км`);
      kv('Хөдөлгөөнд', `${data.totals.drivingHours} ц`);
      kv('Зогссон (idle)', `${data.totals.idleHours} ц`);
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').text('Зөрчлүүд (тоо)');
      doc.font('Helvetica');
      kv('Гэнэт хурдалсан', String(data.totals.harshAccel));
      kv('Гэнэт тоормосолсон', String(data.totals.harshBrake));
      kv('Гэнэт эргэсэн', String(data.totals.harshCorner));
      kv('Хурд хэтрэлт', String(data.totals.speedingEvents));

      doc.end();
    });
  }

  async idleBillingExcel(
    actor: { role: Role; companyId: string | null },
    from: Date,
    to: Date,
    tariffPerHour: number,
    shiftId?: string,
  ): Promise<Buffer> {
    const data = await this.idleBilling(actor, from, to, tariffPerHour, shiftId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Idle billing');
    ws.columns = [
      { header: 'Жолооч', key: 'driverName', width: 30 },
      { header: 'Ажилтны ID', key: 'employeeId', width: 14 },
      { header: 'Ээлж', key: 'shiftName', width: 18 },
      { header: 'Idle (цаг)', key: 'idleHours', width: 12 },
      { header: 'Тариф (₮/цаг)', key: 'tariff', width: 14 },
      { header: 'Дүн (₮)', key: 'amount', width: 16 },
    ];
    for (const r of data.rows) {
      ws.addRow({
        driverName: r.driverName,
        employeeId: r.employeeId ?? '',
        shiftName: r.shiftName ?? '—',
        idleHours: r.idleHours,
        tariff: tariffPerHour,
        amount: r.amount,
      });
    }
    ws.addRow({});
    ws.addRow({
      driverName: 'НИЙТ',
      idleHours: data.totals.idleHours,
      amount: data.totals.amount,
    }).font = { bold: true };
    hardenWorkbook(wb); // formula-injection guard (audit M2)
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
}

// Streaming helper kept for future use when reports outgrow Buffer.
export function bufferToStream(buf: Buffer): Readable {
  return Readable.from(buf);
}
