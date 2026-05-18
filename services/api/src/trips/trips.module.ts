import { Module, Controller, Get, Param, Query, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role, TripStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Trips are persisted by a background trip-detector in the events engine
// (engine-on → engine-off, with min thresholds). This controller serves
// the trip list / detail to the operator UI; we keep the API read-only
// because trips are a derived view, not authored by the user.

@Injectable()
class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: { role: Role; companyId: string | null },
    opts: { deviceId?: string; driverId?: string; from?: Date; to?: Date; status?: TripStatus; limit: number },
  ) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.deviceId) where.deviceId = opts.deviceId;
    if (opts.driverId) where.driverId = opts.driverId;
    if (opts.status) where.status = opts.status;
    if (opts.from || opts.to) where.startedAt = { gte: opts.from, lte: opts.to };
    return this.prisma.trip.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: opts.limit,
      include: { driver: { select: { id: true, fullName: true } } },
    });
  }

  async get(id: string, actor: { role: Role; companyId: string | null }) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: { driver: { select: { id: true, fullName: true } } },
    });
    if (!trip) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && trip.companyId !== actor.companyId) throw new ForbiddenException();
    return trip;
  }
}

@Controller('trips')
@Roles(Role.VIEWER)
class TripsController {
  constructor(private readonly svc: TripsService) {}

  @Get()
  @Audit('trip.list')
  list(
    @Req() req: any,
    @Query('deviceId') deviceId?: string,
    @Query('driverId') driverId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: TripStatus,
    @Query('limit') limit = '200',
  ) {
    return this.svc.list(req.user, {
      deviceId,
      driverId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      status,
      limit: Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000),
    });
  }

  @Get(':id')
  @Audit('trip.read', { resourceType: 'trip', resourceIdParam: 'id' })
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, req.user);
  }
}

@Module({
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}
