import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeviceStatus, Role, VehicleType } from '@prisma/client';
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
      include: { group: true, garage: true, driver: true },
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
