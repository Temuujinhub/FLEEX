import { Module, Controller, Get, Param, Query, Req, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Driver scoring read-only API. The actual scoring rows are written by
// the events-engine (nightly job + on-the-fly counters as harsh events
// land). This controller is the read API that powers the eco-driving
// dashboard and the leaderboard widget.

@Injectable()
class EcoService {
  constructor(private readonly prisma: PrismaService) {}

  async leaderboard(
    actor: { role: Role; companyId: string | null },
    opts: { from?: Date; to?: Date; limit: number },
  ) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.from || opts.to) where.date = { gte: opts.from, lte: opts.to };

    // Aggregate per driver over the date range.
    const rows = await this.prisma.driverScore.groupBy({
      by: ['driverId'],
      where,
      _avg: { score: true },
      _sum: { distanceKm: true, durationS: true, harshAccel: true, harshBrake: true, harshCorner: true, speedingEvents: true, idleS: true },
      orderBy: { _avg: { score: 'desc' } },
      take: opts.limit,
    });

    // Look up driver names in one shot.
    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: rows.map((r) => r.driverId) } },
      select: { id: true, fullName: true, employeeId: true },
    });
    const byId = new Map(drivers.map((d) => [d.id, d]));

    return rows.map((r) => ({
      driverId: r.driverId,
      driver: byId.get(r.driverId) ?? null,
      avgScore: Math.round((r._avg.score ?? 100) * 10) / 10,
      distanceKm: r._sum.distanceKm ?? 0,
      durationS: r._sum.durationS ?? 0,
      harshAccel: r._sum.harshAccel ?? 0,
      harshBrake: r._sum.harshBrake ?? 0,
      harshCorner: r._sum.harshCorner ?? 0,
      speedingEvents: r._sum.speedingEvents ?? 0,
      idleS: r._sum.idleS ?? 0,
    }));
  }

  async driverHistory(
    driverId: string,
    actor: { role: Role; companyId: string | null },
    opts: { from?: Date; to?: Date },
  ) {
    const where: any = { driverId };
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.from || opts.to) where.date = { gte: opts.from, lte: opts.to };
    return this.prisma.driverScore.findMany({ where, orderBy: { date: 'desc' } });
  }
}

@Controller('eco')
@Roles(Role.VIEWER)
class EcoController {
  constructor(private readonly svc: EcoService) {}

  @Get('leaderboard')
  @Audit('eco.leaderboard')
  leaderboard(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit = '50',
  ) {
    return this.svc.leaderboard(req.user, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200),
    });
  }

  @Get('drivers/:id/history')
  @Audit('eco.driver-history')
  driverHistory(
    @Param('id') id: string,
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.driverHistory(
      id,
      req.user,
      { from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined },
    );
  }
}

@Module({
  controllers: [EcoController],
  providers: [EcoService],
})
export class EcoModule {}
