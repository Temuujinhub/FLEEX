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
    return this.svc.history(deviceId, req.user, fromD, toD, parseInt(limit, 10));
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
