import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeviceStatus, FuelType, Role, VehicleType } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async list(
    actor: { role: Role; companyId: string | null },
    opts: { groupId?: string; garageId?: string; vehicleType?: VehicleType; status?: DeviceStatus; search?: string },
  ) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.groupId) where.groupId = opts.groupId;
    if (opts.garageId) where.garageId = opts.garageId;
    if (opts.vehicleType) where.vehicleType = opts.vehicleType;
    if (opts.status) where.status = opts.status;
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { imei: { contains: opts.search } },
        { plateNumber: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    const devices = await this.prisma.device.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        // Super admin sees devices across all tenants and needs the owning
        // company to disambiguate the list (e.g. before transferring
        // ownership). For non-super actors it's a no-op extra column.
        company: { select: { id: true, name: true, slug: true } },
        group:  { select: { id: true, name: true } },
        garage: { select: { id: true, name: true } },
        driver: { select: { id: true, fullName: true } },
      },
    });

    // Fold in Redis online state so the UI can render "online/offline" badges
    // without an additional round trip per row.
    const pipe = this.redis.client.pipeline();
    for (const d of devices) pipe.exists(`ingestor:online:${d.imei}`);
    const onlines = await pipe.exec();
    return devices.map((d, idx) => ({
      ...d,
      online: Boolean(onlines?.[idx]?.[1]),
    }));
  }

  async get(id: string, actor: { role: Role; companyId: string | null }) {
    const d = await this.prisma.device.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, slug: true } },
        group: true,
        garage: true,
        driver: true,
      },
    });
    if (!d) throw new NotFoundException();
    this.ensureSameTenant(actor, d.companyId);
    const online = Boolean(await this.redis.client.exists(`ingestor:online:${d.imei}`));
    return { ...d, online };
  }

  // Accept the full vehicle profile DTO; date strings come over the wire so
  // we coerce the insurance fields explicitly. Garage / group ownership is
  // validated against the actor's tenant when present.
  async create(
    actor: { role: Role; companyId: string | null },
    dto: Record<string, any> & { imei: string; name: string },
  ) {
    const companyId = actor.role === 'SUPER_ADMIN' ? dto.companyId ?? actor.companyId : actor.companyId;
    if (!companyId) throw new ForbiddenException('No company context');

    await this.ensureChildOwnership(actor, companyId, { groupId: dto.groupId, garageId: dto.garageId });

    const data = this.coerceVehicleFields(dto, companyId);
    // Prisma's typed input is too strict for a dynamic optional-field payload;
    // class-validator already enforced the shape at the controller layer.
    const created = await this.prisma.device.create({ data: data as any });
    await this.redis.client.del(`ingestor:dev:${created.imei}`);
    return created;
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: Record<string, any>) {
    const target = await this.prisma.device.findUnique({ where: { id } });
    if (!target) throw new NotFoundException();
    this.ensureSameTenant(actor, target.companyId);
    await this.ensureChildOwnership(actor, target.companyId, { groupId: dto.groupId, garageId: dto.garageId });

    const data = this.coerceVehicleFields(dto, target.companyId, /* isUpdate */ true);
    const updated = await this.prisma.device.update({ where: { id }, data: data as any });
    if (dto.imei && dto.imei !== target.imei) {
      await this.redis.client.del(`ingestor:dev:${target.imei}`);
      await this.redis.client.del(`ingestor:dev:${updated.imei}`);
    }
    return updated;
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const target = await this.prisma.device.findUnique({ where: { id } });
    if (!target) throw new NotFoundException();
    this.ensureSameTenant(actor, target.companyId);
    await this.prisma.device.delete({ where: { id } });
    await this.redis.client.del(`ingestor:dev:${target.imei}`);
    return { ok: true };
  }

  // Move a device (and all of its tenant-scoped child rows) from one company
  // to another. SUPER_ADMIN only — multi-tenant isolation means a regular
  // company admin must never be able to lob a device into someone else's
  // tenant. Group / garage / driver / custom-field values are dropped
  // because they belong to the source tenant's catalogue and don't make
  // sense in the destination. The IMEI is global so it stays put.
  async transfer(
    id: string,
    actor: { role: Role; companyId: string | null },
    dto: { companyId: string },
  ) {
    if (actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only SUPER_ADMIN can transfer devices');

    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (device.companyId === dto.companyId) {
      throw new BadRequestException('Device already belongs to this company');
    }

    const target = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!target) throw new NotFoundException('Target company not found');
    if (!target.isActive) throw new BadRequestException('Target company is disabled');

    const toCompanyId = target.id;

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // 1. The device row itself. Group / garage / driver belong to the
        //    source tenant — null them out so the destination admin starts
        //    from a clean slate.
        const next = await tx.device.update({
          where: { id },
          data: {
            companyId: toCompanyId,
            groupId: null,
            garageId: null,
            driverId: null,
          },
          include: {
            company: { select: { id: true, name: true, slug: true } },
            group:   { select: { id: true, name: true } },
            garage:  { select: { id: true, name: true } },
            driver:  { select: { id: true, fullName: true } },
          },
        });

        // 2. Telemetry & ops history that carry their own companyId for
        //    tenant-scoped queries. Each row keeps its deviceId — only the
        //    tenant pointer moves.
        await tx.event.updateMany({
          where: { deviceId: id },
          // Geofence references belong to the source tenant; the destination
          // can't see those geofences, so the FK has to be cleared.
          data: { companyId: toCompanyId, geofenceId: null },
        });
        await tx.sensor.updateMany({ where: { deviceId: id }, data: { companyId: toCompanyId } });
        await tx.serviceTask.updateMany({ where: { deviceId: id }, data: { companyId: toCompanyId } });
        await tx.trip.updateMany({ where: { deviceId: id }, data: { companyId: toCompanyId } });

        // 3. The positions hypertable is intentionally `@@ignore`'d from
        //    the Prisma Client (see schema comment) — use raw SQL.
        await tx.$executeRaw`UPDATE positions SET company_id = ${toCompanyId}::uuid WHERE device_id = ${id}::uuid`;

        // 4. CustomFieldValue rows reference `CustomField`s that belong to
        //    the source tenant. The destination won't have those field
        //    definitions, so the orphaned values are useless — drop them.
        await tx.customFieldValue.deleteMany({ where: { entityId: id } });

        // 5. Any notification rules in the source tenant referencing this
        //    device need the id pulled out of their `deviceIds` array, or
        //    they'd silently keep firing for a device that no longer
        //    belongs to them.
        await tx.$executeRaw`
          UPDATE notification_rules
          SET "deviceIds" = array_remove("deviceIds", ${id}::uuid)
          WHERE ${id}::uuid = ANY("deviceIds")
        `;

        return next;
      },
      { timeout: 30_000, maxWait: 5_000 },
    );

    // Bust the ingestor's device cache so the next incoming packet picks
    // up the new companyId instead of attributing positions to the old
    // tenant for the first few seconds after transfer.
    await this.redis.client.del(`ingestor:dev:${device.imei}`);

    return updated;
  }

  // ── Bulk Excel import ────────────────────────────────────────
  async importExcel(actor: { role: Role; companyId: string | null }, buffer: Buffer) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const companyId = actor.companyId!;
    const [groups, garages] = await Promise.all([
      this.prisma.deviceGroup.findMany({ where: { companyId } }),
      this.prisma.garage.findMany({ where: { companyId } }),
    ]);
    const groupByName  = new Map(groups.map((g) => [g.name.toLowerCase(), g.id]));
    const garageByName = new Map(garages.map((g) => [g.name.toLowerCase(), g.id]));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel файл хоосон байна');

    const headers: Record<number, string> = {};
    ws.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.value ?? '').trim().toLowerCase();
    });

    const created: any[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (row.cellCount === 0 || !row.hasValues) continue;
      const rec: Record<string, any> = {};
      row.eachCell((cell, col) => {
        const key = MAP_DEVICE[headers[col]];
        if (!key) return;
        let v: any = cell.value;
        if (v && typeof v === 'object' && 'text' in (v as any)) v = (v as any).text;
        if (v == null || v === '') return;
        rec[key] = v;
      });

      const imei = String(rec.imei ?? '').trim();
      const name = String(rec.name ?? '').trim();
      if (!/^\d{14,16}$/.test(imei)) { errors.push({ row: r, message: 'IMEI 14-16 оронтой тоо байх ёстой' }); continue; }
      if (name.length < 2) { errors.push({ row: r, message: 'Машины нэр шаардлагатай' }); continue; }

      // Enum normalisation (uppercase, validate against enum)
      if (rec.vehicleType) {
        const t = String(rec.vehicleType).toUpperCase().replace(/[^A-Z_]/g, '_');
        rec.vehicleType = (VehicleType as any)[t] ? (t as VehicleType) : undefined;
      }
      if (rec.fuelType) {
        const t = String(rec.fuelType).toUpperCase().replace(/[^A-Z_]/g, '_');
        rec.fuelType = (FuelType as any)[t] ? (t as FuelType) : undefined;
      }

      // Map group / garage names → IDs
      if (rec._groupName) {
        const gid = groupByName.get(String(rec._groupName).toLowerCase());
        if (gid) rec.groupId = gid;
        delete rec._groupName;
      }
      if (rec._garageName) {
        const gid = garageByName.get(String(rec._garageName).toLowerCase());
        if (gid) rec.garageId = gid;
        delete rec._garageName;
      }

      // Date coercion
      for (const dk of ['insuranceUntil1', 'insuranceUntil2']) {
        if (rec[dk] && !(rec[dk] instanceof Date)) {
          const d = new Date(rec[dk]);
          if (!Number.isNaN(d.getTime())) rec[dk] = d;
          else delete rec[dk];
        }
      }
      // Numeric coercion (Excel can give cells as strings)
      for (const k of [
        'chassisLengthMm', 'chassisWidthMm', 'chassisHeightMm',
        'payloadKg', 'grossWeightKg', 'seatCount',
        'axleCount', 'wheelCount',
      ]) {
        if (rec[k] != null) {
          const n = parseInt(String(rec[k]), 10);
          if (!Number.isNaN(n)) rec[k] = n; else delete rec[k];
        }
      }
      for (const k of ['tankCapacityL', 'fuelConsumptionL100Km', 'speedLimit']) {
        if (rec[k] != null) {
          const n = parseFloat(String(rec[k]));
          if (!Number.isNaN(n)) rec[k] = n; else delete rec[k];
        }
      }

      try {
        const d = await this.prisma.device.create({
          data: { ...rec, imei, name, companyId } as any,
        });
        created.push({ id: d.id, name: d.name, imei: d.imei });
      } catch (e: any) {
        errors.push({ row: r, message: e?.message ?? 'Хадгалах үед алдаа' });
      }
    }
    return { createdCount: created.length, errorCount: errors.length, created, errors };
  }

  async writeTemplate(res: Response) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Vehicles');
    ws.columns = [
      { header: 'IMEI *',              key: 'imei',            width: 18 },
      { header: 'Машины нэр *',        key: 'name',            width: 22 },
      { header: 'Улсын дугаар',        key: 'plateNumber',     width: 14 },
      { header: 'VIN',                 key: 'vin',             width: 22 },
      { header: 'Модель',              key: 'model',           width: 16 },
      { header: 'SIM-ийн дугаар',      key: 'simNumber',       width: 14 },
      { header: 'Машины төрөл',        key: 'vehicleType',     width: 16 },
      { header: 'Дэд төрөл',           key: 'vehicleSubtype',  width: 18 },
      { header: 'Өнгө (HEX)',          key: 'color',           width: 10 },
      { header: 'Гранж',               key: 'garage',          width: 16 },
      { header: 'Алба нэгж',           key: 'group',           width: 18 },
      { header: 'Урт (мм)',            key: 'chassisLengthMm', width: 10 },
      { header: 'Өргөн (мм)',          key: 'chassisWidthMm',  width: 10 },
      { header: 'Өндөр (мм)',          key: 'chassisHeightMm', width: 10 },
      { header: 'Даац (кг)',           key: 'payloadKg',       width: 10 },
      { header: 'Нийт жин (кг)',       key: 'grossWeightKg',   width: 12 },
      { header: 'Зорчигч',             key: 'seatCount',       width: 8 },
      { header: 'Тэнхлэг',             key: 'axleCount',       width: 8 },
      { header: 'Дугуй',               key: 'wheelCount',      width: 8 },
      { header: 'Түлшний төрөл',       key: 'fuelType',        width: 14 },
      { header: 'Түлшний зэрэг',       key: 'fuelGrade',       width: 12 },
      { header: 'Бакны хэмжээ (Л)',    key: 'tankCapacityL',   width: 12 },
      { header: 'Нормт зарцуулалт (Л/100км)', key: 'fuelConsumptionL100Km', width: 14 },
      { header: 'Хурдны хязгаар (км/ц)',     key: 'speedLimit',            width: 12 },
      { header: 'Даатгал №1',                key: 'insuranceContract1',    width: 18 },
      { header: 'Даатгал №1 хүчинтэй',       key: 'insuranceUntil1',       width: 14 },
    ];
    ws.addRow({
      imei: '352093081234567', name: 'Самосвал №14', plateNumber: '1234УБА', vin: 'XLR000000000XX001',
      model: 'FMC650', simNumber: '+97699112233',
      vehicleType: 'HAUL_TRUCK', vehicleSubtype: 'БелАЗ 75131', color: '#f59e0b',
      garage: 'Гол гранж', group: 'Тээвэр-А',
      chassisLengthMm: 14000, chassisWidthMm: 6000, chassisHeightMm: 7200,
      payloadKg: 130000, grossWeightKg: 240000, seatCount: 2, axleCount: 2, wheelCount: 6,
      fuelType: 'DIESEL', fuelGrade: 'DT-Л', tankCapacityL: 1800, fuelConsumptionL100Km: 250, speedLimit: 60,
      insuranceContract1: 'INS-2025-0001', insuranceUntil1: new Date('2026-12-31'),
    });
    ws.getRow(1).font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="fleex-vehicles-template.xlsx"');
    const buf = await wb.xlsx.writeBuffer();
    res.send(Buffer.from(buf));
  }

  // ── helpers ─────────────────────────────────────────────────

  // Date strings coming from JSON need to become Dates for Prisma; empty
  // strings should become null instead of '' (Postgres would otherwise
  // accept '' for text columns which we don't want). Numeric fields stay
  // as-is — class-validator already coerced them in the DTO layer.
  private coerceVehicleFields(dto: Record<string, any>, companyId: string, isUpdate = false) {
    const out: Record<string, any> = { ...dto };

    for (const dateField of ['insuranceUntil1', 'insuranceUntil2']) {
      if (out[dateField] != null && out[dateField] !== '') {
        out[dateField] = new Date(out[dateField]);
      } else if (dateField in out) {
        out[dateField] = null;
      }
    }
    for (const k of Object.keys(out)) {
      if (out[k] === '') out[k] = null;
    }
    if (!isUpdate) out.companyId = companyId;
    // companyId is set via FK on Device; the actor-provided value (if any)
    // was already validated above.
    if (isUpdate) delete out.companyId;
    return out;
  }

  private async ensureChildOwnership(
    actor: { role: Role; companyId: string | null },
    companyId: string | null,
    refs: { groupId?: string | null; garageId?: string | null },
  ) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (refs.groupId) {
      const g = await this.prisma.deviceGroup.findUnique({ where: { id: refs.groupId } });
      if (!g || g.companyId !== companyId) throw new ForbiddenException('Group not owned by tenant');
    }
    if (refs.garageId) {
      const g = await this.prisma.garage.findUnique({ where: { id: refs.garageId } });
      if (!g || g.companyId !== companyId) throw new ForbiddenException('Garage not owned by tenant');
    }
  }

  private ensureSameTenant(actor: { role: Role; companyId: string | null }, companyId: string | null) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.companyId !== companyId) throw new ForbiddenException('Cross-tenant access denied');
  }
}

// Excel header (lower-cased) → Device field. _groupName / _garageName are
// resolved to ids in importExcel(). Anything unlisted is ignored on import.
const MAP_DEVICE: Record<string, string> = {
  'imei':                          'imei',
  'imei *':                        'imei',
  'машины нэр':                    'name',
  'машины нэр *':                  'name',
  'нэр':                           'name',
  'улсын дугаар':                  'plateNumber',
  'vin':                           'vin',
  'модель':                        'model',
  'sim-ийн дугаар':                'simNumber',
  'sim':                           'simNumber',
  'машины төрөл':                  'vehicleType',
  'төрөл':                         'vehicleType',
  'дэд төрөл':                     'vehicleSubtype',
  'өнгө':                          'color',
  'өнгө (hex)':                    'color',
  'гранж':                         '_garageName',
  'алба нэгж':                     '_groupName',
  'алба':                          '_groupName',
  'хэлтэс':                        '_groupName',
  'урт (мм)':                      'chassisLengthMm',
  'өргөн (мм)':                    'chassisWidthMm',
  'өндөр (мм)':                    'chassisHeightMm',
  'даац (кг)':                     'payloadKg',
  'нийт жин (кг)':                 'grossWeightKg',
  'зорчигч':                       'seatCount',
  'тэнхлэг':                       'axleCount',
  'дугуй':                         'wheelCount',
  'түлшний төрөл':                 'fuelType',
  'түлшний зэрэг':                 'fuelGrade',
  'бакны хэмжээ (л)':              'tankCapacityL',
  'нормт зарцуулалт (л/100км)':    'fuelConsumptionL100Km',
  'хурдны хязгаар (км/ц)':         'speedLimit',
  'даатгал №1':                    'insuranceContract1',
  'даатгал №1 хүчинтэй':           'insuranceUntil1',
  'даатгал №2':                    'insuranceContract2',
  'даатгал №2 хүчинтэй':           'insuranceUntil2',
};
