import { Module, Controller, Get, Post, Param, Query, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Read-only view of per-device monthly GPRS byte counters. Writes happen
// inside the ingestor (it increments bytesRx as each packet is decoded).
// Operators use this to predict SIM-plan overages and to spot devices
// that suddenly chat way more than usual.

@Injectable()
class GprsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: { role: Role; companyId: string | null },
    opts: { deviceId?: string; yearMonth?: string },
  ) {
    const where: any = {};
    if (opts.deviceId) where.deviceId = opts.deviceId;
    if (opts.yearMonth) where.yearMonth = opts.yearMonth;
    if (actor.role !== 'SUPER_ADMIN') where.device = { companyId: actor.companyId };

    return this.prisma.gprsCounter.findMany({
      where,
      orderBy: [{ yearMonth: 'desc' }, { deviceId: 'asc' }],
      include: { device: { select: { id: true, name: true, imei: true, simNumber: true } } },
      take: 500,
    });
  }

  async reset(deviceId: string, yearMonth: string, actor: { role: Role; companyId: string | null }) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.gprsCounter.upsert({
      where: { deviceId_yearMonth: { deviceId, yearMonth } },
      create: { deviceId, yearMonth, resetAt: new Date() },
      update: { bytesRx: 0n, bytesTx: 0n, packetCount: 0, resetAt: new Date() },
    });
  }
}

@Controller('gprs')
@Roles(Role.VIEWER)
class GprsController {
  constructor(private readonly svc: GprsService) {}

  @Get()
  @Audit('gprs.list')
  async list(
    @Req() req: any,
    @Query('deviceId') deviceId?: string,
    @Query('yearMonth') yearMonth?: string,
  ) {
    const rows = await this.svc.list(req.user, { deviceId, yearMonth });
    // BigInt -> string for JSON safety.
    return rows.map((r) => ({ ...r, bytesRx: r.bytesRx.toString(), bytesTx: r.bytesTx.toString() }));
  }

  @Post(':deviceId/reset/:yearMonth')
  @Roles(Role.FLEET_MANAGER)
  @Audit('gprs.reset', { resourceType: 'device', resourceIdParam: 'deviceId' })
  async reset(
    @Param('deviceId') deviceId: string,
    @Param('yearMonth') yearMonth: string,
    @Req() req: any,
  ) {
    const r = await this.svc.reset(deviceId, yearMonth, req.user);
    return { ...r, bytesRx: r.bytesRx.toString(), bytesTx: r.bytesTx.toString() };
  }
}

@Module({
  controllers: [GprsController],
  providers: [GprsService],
})
export class GprsModule {}
