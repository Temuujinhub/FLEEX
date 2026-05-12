import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeviceStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async list(actor: { role: Role; companyId: string | null }, opts: { groupId?: string; status?: DeviceStatus; search?: string }) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.groupId) where.groupId = opts.groupId;
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
      include: { group: { select: { id: true, name: true } }, driver: { select: { id: true, fullName: true } } },
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
      include: { group: true, driver: true },
    });
    if (!d) throw new NotFoundException();
    this.ensureSameTenant(actor, d.companyId);
    const online = Boolean(await this.redis.client.exists(`ingestor:online:${d.imei}`));
    return { ...d, online };
  }

  async create(
    actor: { role: Role; companyId: string | null },
    dto: {
      imei: string;
      name: string;
      companyId?: string;
      groupId?: string;
      model?: string;
      simNumber?: string;
      plateNumber?: string;
      vin?: string;
      speedLimit?: number;
    },
  ) {
    const companyId = actor.role === 'SUPER_ADMIN' ? dto.companyId ?? actor.companyId : actor.companyId;
    if (!companyId) throw new ForbiddenException('No company context');
    const created = await this.prisma.device.create({
      data: { ...dto, companyId },
    });
    // Invalidate ingestor cache so the next position is accepted.
    await this.redis.client.del(`ingestor:dev:${created.imei}`);
    return created;
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: any) {
    const target = await this.prisma.device.findUnique({ where: { id } });
    if (!target) throw new NotFoundException();
    this.ensureSameTenant(actor, target.companyId);
    const updated = await this.prisma.device.update({ where: { id }, data: dto });
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

  private ensureSameTenant(actor: { role: Role; companyId: string | null }, companyId: string | null) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.companyId !== companyId) throw new ForbiddenException('Cross-tenant access denied');
  }
}
