import { Controller, Get, Param, Query, Req, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PositionsService } from './positions.service';

@Controller('positions')
@Roles(Role.VIEWER)
export class PositionsController {
  constructor(private readonly svc: PositionsService) {}

  @Get('latest')
  @Audit('positions.latest')
  latest(@Req() req: any) {
    return this.svc.latest(req.user);
  }

  // Per-device distance roll-up for the caller's whole fleet over [from,to].
  // Defaults to "today" when the range is missing/invalid so the mobile
  // summary can call it with no params.
  @Get('summary')
  @Audit('positions.summary')
  summary(@Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fromD = from ? new Date(from) : startOfToday;
    const toD = to ? new Date(to) : now;
    const safeFrom = isNaN(fromD.getTime()) ? startOfToday : fromD;
    const safeTo = isNaN(toD.getTime()) ? now : toD;
    return this.svc.fleetSummary(req.user, safeFrom, safeTo);
  }

  @Get(':deviceId/history')
  @Audit('positions.history', { resourceType: 'device', resourceIdParam: 'deviceId' })
  history(
    @Param('deviceId') deviceId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit = '5000',
    @Req() req: any,
  ) {
    const fromD = new Date(from);
    const toD = new Date(to);
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) {
      throw new BadRequestException('Invalid from/to');
    }
    const n = Number.parseInt(limit, 10);
    const safeLimit = Number.isFinite(n) && n > 0 ? n : 5000;
    return this.svc.history(deviceId, req.user, fromD, toD, safeLimit);
  }

  @Get(':deviceId/daily')
  @Audit('positions.daily', { resourceType: 'device', resourceIdParam: 'deviceId' })
  daily(
    @Param('deviceId') deviceId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
  ) {
    return this.svc.dailySummary(deviceId, req.user, new Date(from), new Date(to));
  }
}
