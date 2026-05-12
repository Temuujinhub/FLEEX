import { BadRequestException, Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@Roles(Role.VIEWER)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  private range(from: string, to: string): { from: Date; to: Date } {
    const f = new Date(from);
    const t = new Date(to);
    if (isNaN(f.getTime()) || isNaN(t.getTime())) throw new BadRequestException('Invalid dates');
    if (t.getTime() - f.getTime() > 366 * 86400_000) throw new BadRequestException('Range > 12 months');
    return { from: f, to: t };
  }

  @Get('trip/:deviceId')
  @Audit('report.trip', { resourceType: 'device', resourceIdParam: 'deviceId' })
  trip(@Param('deviceId') id: string, @Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    const r = this.range(from, to);
    return this.svc.tripReport(id, r.from, r.to, req.user);
  }

  @Get('events/:deviceId')
  @Audit('report.events', { resourceType: 'device', resourceIdParam: 'deviceId' })
  events(@Param('deviceId') id: string, @Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    const r = this.range(from, to);
    return this.svc.eventsReport(id, r.from, r.to, req.user);
  }

  @Get('trip/:deviceId/excel')
  @Audit('report.trip.excel', { resourceType: 'device', resourceIdParam: 'deviceId' })
  async excel(
    @Param('deviceId') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const r = this.range(from, to);
    const buf = await this.svc.exportExcel(id, r.from, r.to, req.user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="trip-${id}.xlsx"`);
    res.send(buf);
  }

  @Get('trip/:deviceId/pdf')
  @Audit('report.trip.pdf', { resourceType: 'device', resourceIdParam: 'deviceId' })
  async pdf(
    @Param('deviceId') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const r = this.range(from, to);
    const buf = await this.svc.exportPdf(id, r.from, r.to, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="trip-${id}.pdf"`);
    res.send(buf);
  }
}
