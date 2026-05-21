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

  // Eco-driving leaderboard. Weights are supplied as repeated `w=TYPE:NN`
  // query params so the GET stays cacheable; missing types default to 0.
  @Get('driver-scores')
  @Audit('report.driver_scores')
  driverScores(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('w') w: string | string[] | undefined,
    @Req() req: any,
  ) {
    const r = this.range(from, to);
    const weights: Record<string, number> = {};
    const items = Array.isArray(w) ? w : w ? [w] : [];
    for (const item of items) {
      const [k, v] = item.split(':');
      const n = Number(v);
      if (k && !Number.isNaN(n)) weights[k] = n;
    }
    return this.svc.driverScores(req.user, r.from, r.to, weights);
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

  // Historical proximity report — "which vehicles passed within radiusM
  // meters of (lat, lng) between from and to". Backs the OT requirement
  // and the incident-investigation workflow ("who was near the panic
  // event?"). Returns a per-device summary alongside the full hit list.
  @Get('proximity')
  @Audit('report.proximity')
  proximity(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radiusM') radiusM: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
  ) {
    const r = this.range(from, to);
    const latN = Number(lat);
    const lngN = Number(lng);
    const radiusN = Number(radiusM);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN) || !Number.isFinite(radiusN)) {
      throw new BadRequestException('lat, lng, radiusM must be numbers');
    }
    return this.svc.proximityReport(req.user, r.from, r.to, latN, lngN, radiusN);
  }

  // Idle billing — sums DriverScore.idleS per driver across the window
  // and multiplies by the supplied tariff. tariff is a query param so
  // the same data is queryable at any rate without persisting tariff
  // config (companies can vary it per site / per contract).
  @Get('idle-billing')
  @Audit('report.idle_billing')
  idleBilling(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('tariff') tariff: string,
    @Req() req: any,
  ) {
    const r = this.range(from, to);
    const t = Number(tariff);
    if (!Number.isFinite(t) || t < 0) throw new BadRequestException('tariff must be a non-negative number');
    return this.svc.idleBilling(req.user, r.from, r.to, t);
  }

  @Get('idle-billing/excel')
  @Audit('report.idle_billing.excel')
  async idleBillingExcel(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('tariff') tariff: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const r = this.range(from, to);
    const t = Number(tariff);
    if (!Number.isFinite(t) || t < 0) throw new BadRequestException('tariff must be a non-negative number');
    const buf = await this.svc.idleBillingExcel(req.user, r.from, r.to, t);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="idle-billing-${from}_${to}.xlsx"`);
    res.send(buf);
  }

  @Get('proximity/excel')
  @Audit('report.proximity.excel')
  async proximityExcel(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radiusM') radiusM: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const r = this.range(from, to);
    const latN = Number(lat);
    const lngN = Number(lng);
    const radiusN = Number(radiusM);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN) || !Number.isFinite(radiusN)) {
      throw new BadRequestException('lat, lng, radiusM must be numbers');
    }
    const buf = await this.svc.proximityExportExcel(req.user, r.from, r.to, latN, lngN, radiusN);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="proximity-${Date.now()}.xlsx"`);
    res.send(buf);
  }
}
