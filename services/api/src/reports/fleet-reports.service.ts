import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { hardenWorkbook } from './report-exporters';

// Company-scoped ("fleet-wide") reports — the Wialon-parity batch 2. Unlike the
// device-template reports (one vehicle, schedulable via R1), these aggregate
// across the whole tenant for a date range, so they live behind their own
// endpoints (like proximity / idle-billing) and export to Excel on demand.
//
// Tenant isolation: every query is filtered by the actor's companyId unless the
// actor is SUPER_ADMIN. The shared `scoped()` helper centralises that so a new
// report can't accidentally leak across tenants.

type Actor = { role: Role; companyId: string | null };

@Injectable()
export class FleetReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Resolves the tenant filter. A non-super actor with no company can see
  // nothing (returns null → callers short-circuit to an empty report).
  private scoped(actor: Actor): { isSuper: boolean; companyId: string | null } | null {
    if (actor.role === 'SUPER_ADMIN') return { isSuper: true, companyId: actor.companyId ?? null };
    if (!actor.companyId) return null;
    return { isSuper: false, companyId: actor.companyId };
  }

  // ── Maintenance / Service (Засвар үйлчилгээ) ──────────────────
  // Service tasks scheduled OR completed within the window, plus any still-open
  // task that is already overdue. Effective status marks PLANNED/IN_PROGRESS
  // tasks whose scheduledAt is in the past as OVERDUE so the report flags work
  // that slipped even if the row's stored status wasn't updated yet.
  async maintenance(actor: Actor, from: Date, to: Date, now: Date = new Date()) {
    const s = this.scoped(actor);
    if (!s) return this.emptyMaintenance(from, to);

    const where: any = {
      OR: [
        { scheduledAt: { gte: from, lte: to } },
        { completedAt: { gte: from, lte: to } },
        { status: { in: ['PLANNED', 'IN_PROGRESS', 'OVERDUE'] }, scheduledAt: { lt: now } },
      ],
    };
    if (!s.isSuper) where.companyId = s.companyId;

    const tasks = await this.prisma.serviceTask.findMany({
      where,
      orderBy: [{ scheduledAt: 'asc' }],
      take: 5000,
      select: {
        id: true, title: true, kind: true, status: true, cost: true, unplanned: true,
        scheduledAt: true, completedAt: true, performedBy: true,
        device: { select: { name: true, plateNumber: true } },
      },
    });

    const rows = tasks.map((t) => {
      const overdue =
        t.status !== 'COMPLETED' && t.status !== 'CANCELLED' &&
        t.scheduledAt != null && t.scheduledAt < now;
      return {
        id: t.id,
        device: t.device?.name ?? '—',
        plateNumber: t.device?.plateNumber ?? null,
        title: t.title,
        kind: t.kind,
        status: t.status,
        effectiveStatus: overdue ? 'OVERDUE' : t.status,
        cost: t.cost ?? 0,
        unplanned: t.unplanned,
        scheduledAt: t.scheduledAt,
        completedAt: t.completedAt,
        performedBy: t.performedBy ?? null,
      };
    });

    const totals = {
      total: rows.length,
      completed: rows.filter((r) => r.status === 'COMPLETED').length,
      overdue: rows.filter((r) => r.effectiveStatus === 'OVERDUE').length,
      planned: rows.filter((r) => r.effectiveStatus === 'PLANNED' || r.effectiveStatus === 'IN_PROGRESS').length,
      totalCost: Math.round(rows.reduce((acc, r) => acc + (r.cost || 0), 0)),
    };
    return { from, to, totals, rows };
  }

  private emptyMaintenance(from: Date, to: Date) {
    return { from, to, totals: { total: 0, completed: 0, overdue: 0, planned: 0, totalCost: 0 }, rows: [] as any[] };
  }

  // ── Fleet summary (Флотын нэгдсэн дүн) ────────────────────────
  // One row per vehicle for the window: distance, moving/idle/engine time and
  // max speed, aggregated in a single windowed SQL pass over the positions
  // hypertable (LAG partitioned by device). On-demand only.
  async fleetSummary(actor: Actor, from: Date, to: Date) {
    const s = this.scoped(actor);
    if (!s) return { from, to, totals: { vehicles: 0, distanceKm: 0, movingHours: 0, idleHours: 0 }, rows: [] as any[] };
    const companyId = s.companyId ?? '00000000-0000-0000-0000-000000000000';

    const raw = await this.prisma.$queryRaw<
      Array<{
        device_id: string; device_name: string; plate_number: string | null;
        meters: number | null; moving_sec: number | null; idle_sec: number | null;
        max_speed: number | null; last_seen: Date | null; samples: bigint;
      }>
    >`
      WITH pts AS (
        SELECT p.device_id, p.time, p.latitude, p.longitude, p.speed, p.ignition,
               LAG(p.latitude)  OVER (PARTITION BY p.device_id ORDER BY p.time) AS plat,
               LAG(p.longitude) OVER (PARTITION BY p.device_id ORDER BY p.time) AS plng,
               LAG(p.time)      OVER (PARTITION BY p.device_id ORDER BY p.time) AS ptime
        FROM positions p
        WHERE p.time BETWEEN ${from} AND ${to}
          AND (${s.isSuper} OR p.company_id = ${companyId}::uuid)
      )
      SELECT pts.device_id,
        d.name AS device_name,
        d."plateNumber" AS plate_number,
        SUM(CASE WHEN plat IS NULL THEN 0 ELSE
          2 * 6371000 * asin(sqrt(
            power(sin(radians((latitude - plat) / 2)), 2) +
            cos(radians(plat)) * cos(radians(latitude)) *
            power(sin(radians((longitude - plng) / 2)), 2)
          )) END) AS meters,
        SUM(CASE WHEN ptime IS NOT NULL AND EXTRACT(EPOCH FROM (pts.time - ptime)) < 1800
                  AND speed > 3 THEN EXTRACT(EPOCH FROM (pts.time - ptime)) ELSE 0 END) AS moving_sec,
        SUM(CASE WHEN ptime IS NOT NULL AND EXTRACT(EPOCH FROM (pts.time - ptime)) < 1800
                  AND speed <= 3 AND ignition IS TRUE THEN EXTRACT(EPOCH FROM (pts.time - ptime)) ELSE 0 END) AS idle_sec,
        MAX(speed) AS max_speed,
        MAX(pts.time) AS last_seen,
        COUNT(*) AS samples
      FROM pts
      JOIN devices d ON d.id = pts.device_id
      GROUP BY pts.device_id, d.name, d."plateNumber"
      ORDER BY meters DESC NULLS LAST
      LIMIT 2000;
    `;

    const rows = raw.map((r) => ({
      deviceId: r.device_id,
      device: r.device_name,
      plateNumber: r.plate_number,
      distanceKm: Math.round((Number(r.meters ?? 0) / 1000) * 10) / 10,
      movingHours: Math.round((Number(r.moving_sec ?? 0) / 3600) * 10) / 10,
      idleHours: Math.round((Number(r.idle_sec ?? 0) / 3600) * 10) / 10,
      maxSpeed: Math.round(Number(r.max_speed ?? 0)),
      lastSeen: r.last_seen,
      samples: Number(r.samples),
    }));
    const totals = {
      vehicles: rows.length,
      distanceKm: Math.round(rows.reduce((a, r) => a + r.distanceKm, 0) * 10) / 10,
      movingHours: Math.round(rows.reduce((a, r) => a + r.movingHours, 0) * 10) / 10,
      idleHours: Math.round(rows.reduce((a, r) => a + r.idleHours, 0) * 10) / 10,
    };
    return { from, to, totals, rows };
  }

  // ── GPRS / data traffic (Дата урсгал) ─────────────────────────
  // Per-device cellular usage summed over the year-months that overlap the
  // window (GprsCounter is bucketed monthly). Bytes are BigInt in the DB →
  // returned as MB numbers.
  async gprs(actor: Actor, from: Date, to: Date) {
    const s = this.scoped(actor);
    if (!s) return { from, to, totals: { devices: 0, mb: 0, packets: 0 }, rows: [] as any[] };

    const fromYm = from.toISOString().slice(0, 7);
    const toYm = to.toISOString().slice(0, 7);
    const where: any = { yearMonth: { gte: fromYm, lte: toYm } };
    if (!s.isSuper) where.device = { companyId: s.companyId };

    const counters = await this.prisma.gprsCounter.findMany({
      where,
      select: {
        deviceId: true, yearMonth: true, bytesRx: true, bytesTx: true, packetCount: true,
        device: { select: { name: true, plateNumber: true } },
      },
    });

    const byDevice = new Map<string, { device: string; plateNumber: string | null; bytes: bigint; packets: number; months: number }>();
    for (const c of counters) {
      const cur = byDevice.get(c.deviceId) ?? {
        device: c.device?.name ?? '—', plateNumber: c.device?.plateNumber ?? null,
        bytes: 0n, packets: 0, months: 0,
      };
      cur.bytes += (c.bytesRx ?? 0n) + (c.bytesTx ?? 0n);
      cur.packets += c.packetCount ?? 0;
      cur.months += 1;
      byDevice.set(c.deviceId, cur);
    }

    const rows = [...byDevice.entries()]
      .map(([deviceId, v]) => ({
        deviceId, device: v.device, plateNumber: v.plateNumber,
        mb: Math.round((Number(v.bytes) / 1_048_576) * 100) / 100,
        packets: v.packets, months: v.months,
      }))
      .sort((a, b) => b.mb - a.mb);
    const totals = {
      devices: rows.length,
      mb: Math.round(rows.reduce((a, r) => a + r.mb, 0) * 100) / 100,
      packets: rows.reduce((a, r) => a + r.packets, 0),
    };
    return { from, to, fromYm, toYm, totals, rows };
  }

  // ── Command log (Командын түүх) ───────────────────────────────
  // Operator commands issued to the tenant's devices in the window. Command.id
  // is BigInt → stringified for JSON.
  async commandLog(actor: Actor, from: Date, to: Date) {
    const s = this.scoped(actor);
    if (!s) return { from, to, totals: { total: 0, delivered: 0, failed: 0, pending: 0 }, rows: [] as any[] };

    const where: any = { createdAt: { gte: from, lte: to } };
    if (!s.isSuper) where.device = { companyId: s.companyId };

    const cmds = await this.prisma.command.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: {
        id: true, type: true, status: true, attempts: true, result: true,
        createdAt: true, sentAt: true, deliveredAt: true,
        device: { select: { name: true, plateNumber: true } },
      },
    });

    const rows = cmds.map((c) => ({
      id: c.id.toString(),
      device: c.device?.name ?? '—',
      plateNumber: c.device?.plateNumber ?? null,
      type: c.type,
      status: c.status,
      attempts: c.attempts,
      result: c.result ?? null,
      createdAt: c.createdAt,
      sentAt: c.sentAt,
      deliveredAt: c.deliveredAt,
    }));
    const totals = {
      total: rows.length,
      delivered: rows.filter((r) => r.status === 'DELIVERED' || r.status === 'SENT').length,
      failed: rows.filter((r) => r.status === 'FAILED').length,
      pending: rows.filter((r) => r.status === 'PENDING').length,
    };
    return { from, to, totals, rows };
  }

  // ── Excel exporters ───────────────────────────────────────────
  async maintenanceExcel(actor: Actor, from: Date, to: Date): Promise<Buffer> {
    const data = await this.maintenance(actor, from, to);
    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet('Хураангуй');
    attachFleetHeader(sum, 'Засвар үйлчилгээ', from, to);
    sum.addRows([
      ['Нийт ажил', data.totals.total],
      ['Хийгдсэн', data.totals.completed],
      ['Хугацаа хэтэрсэн', data.totals.overdue],
      ['Төлөвлөсөн / хийгдэж буй', data.totals.planned],
      ['Нийт зардал (₮)', data.totals.totalCost],
    ]);
    sum.getColumn(1).width = 28; sum.getColumn(2).width = 18;
    const ws = wb.addWorksheet('Tasks');
    ws.columns = [
      { header: 'Машин', key: 'device', width: 24 },
      { header: 'Улсын дугаар', key: 'plate', width: 14 },
      { header: 'Ажил', key: 'title', width: 30 },
      { header: 'Төрөл', key: 'kind', width: 14 },
      { header: 'Төлөв', key: 'status', width: 14 },
      { header: 'Товлосон', key: 'sched', width: 21 },
      { header: 'Хийгдсэн', key: 'done', width: 21 },
      { header: 'Зардал (₮)', key: 'cost', width: 12 },
      { header: 'Гүйцэтгэгч', key: 'by', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of data.rows) {
      ws.addRow({
        device: r.device, plate: r.plateNumber ?? '', title: r.title, kind: r.kind,
        status: r.effectiveStatus, sched: fmtDt(r.scheduledAt), done: fmtDt(r.completedAt),
        cost: r.cost, by: r.performedBy ?? '',
      });
    }
    return toBuffer(wb);
  }

  async fleetSummaryExcel(actor: Actor, from: Date, to: Date): Promise<Buffer> {
    const data = await this.fleetSummary(actor, from, to);
    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet('Хураангуй');
    attachFleetHeader(sum, 'Флотын нэгдсэн дүн', from, to);
    sum.addRows([
      ['Машины тоо', data.totals.vehicles],
      ['Нийт зам (км)', data.totals.distanceKm],
      ['Нийт хөдөлгөөн (ц)', data.totals.movingHours],
      ['Нийт сул зогсолт (ц)', data.totals.idleHours],
    ]);
    sum.getColumn(1).width = 26; sum.getColumn(2).width = 16;
    const ws = wb.addWorksheet('Fleet');
    ws.columns = [
      { header: 'Машин', key: 'device', width: 26 },
      { header: 'Улсын дугаар', key: 'plate', width: 14 },
      { header: 'Зам (км)', key: 'km', width: 12 },
      { header: 'Хөдөлгөөн (ц)', key: 'mov', width: 14 },
      { header: 'Сул зогсолт (ц)', key: 'idle', width: 16 },
      { header: 'Дээд хурд (км/ц)', key: 'spd', width: 16 },
      { header: 'Сүүлд холбогдсон', key: 'seen', width: 21 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of data.rows) {
      ws.addRow({
        device: r.device, plate: r.plateNumber ?? '', km: r.distanceKm, mov: r.movingHours,
        idle: r.idleHours, spd: r.maxSpeed, seen: fmtDt(r.lastSeen),
      });
    }
    return toBuffer(wb);
  }

  async gprsExcel(actor: Actor, from: Date, to: Date): Promise<Buffer> {
    const data = await this.gprs(actor, from, to);
    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet('Хураангуй');
    attachFleetHeader(sum, 'Дата урсгал (GPRS)', from, to);
    sum.addRows([
      ['Машины тоо', data.totals.devices],
      ['Нийт дата (MB)', data.totals.mb],
      ['Нийт пакет', data.totals.packets],
    ]);
    sum.getColumn(1).width = 22; sum.getColumn(2).width = 16;
    const ws = wb.addWorksheet('GPRS');
    ws.columns = [
      { header: 'Машин', key: 'device', width: 26 },
      { header: 'Улсын дугаар', key: 'plate', width: 14 },
      { header: 'Дата (MB)', key: 'mb', width: 12 },
      { header: 'Пакет', key: 'pkt', width: 12 },
      { header: 'Сар', key: 'months', width: 8 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of data.rows) {
      ws.addRow({ device: r.device, plate: r.plateNumber ?? '', mb: r.mb, pkt: r.packets, months: r.months });
    }
    return toBuffer(wb);
  }

  async commandLogExcel(actor: Actor, from: Date, to: Date): Promise<Buffer> {
    const data = await this.commandLog(actor, from, to);
    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet('Хураангуй');
    attachFleetHeader(sum, 'Командын түүх', from, to);
    sum.addRows([
      ['Нийт команд', data.totals.total],
      ['Хүргэгдсэн', data.totals.delivered],
      ['Амжилтгүй', data.totals.failed],
      ['Хүлээгдэж буй', data.totals.pending],
    ]);
    sum.getColumn(1).width = 22; sum.getColumn(2).width = 14;
    const ws = wb.addWorksheet('Commands');
    ws.columns = [
      { header: 'Огноо', key: 'at', width: 21 },
      { header: 'Машин', key: 'device', width: 24 },
      { header: 'Команд', key: 'type', width: 18 },
      { header: 'Төлөв', key: 'status', width: 12 },
      { header: 'Оролдлого', key: 'att', width: 10 },
      { header: 'Хүргэгдсэн', key: 'delivered', width: 21 },
      { header: 'Хариу', key: 'result', width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of data.rows) {
      ws.addRow({
        at: fmtDt(r.createdAt), device: r.device, type: r.type, status: r.status,
        att: r.attempts, delivered: fmtDt(r.deliveredAt), result: r.result ?? '',
      });
    }
    return toBuffer(wb);
  }
}

// ── shared helpers ────────────────────────────────────────────
function fmtDt(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '';
}

function attachFleetHeader(ws: ExcelJS.Worksheet, title: string, from: Date, to: Date) {
  ws.mergeCells('A1', 'D1');
  ws.getCell('A1').value = `Fleex — ${title}`;
  ws.getCell('A1').font = { size: 14, bold: true };
  ws.mergeCells('A2', 'D2');
  ws.getCell('A2').value = `Хугацаа: ${fmtDt(from)} → ${fmtDt(to)}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };
  ws.addRow([]);
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  wb.creator = 'Fleex';
  wb.created = new Date();
  hardenWorkbook(wb);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
