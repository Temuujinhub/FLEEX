import { BadRequestException, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { ReportsService, REPORT_TEMPLATES, isReportTemplateId, type ReportTemplateId } from './reports.service';
import { ScorecardCronService } from './scorecard-cron.service';
import { FuelAnalyticsService } from './fuel-analytics.service';

// Reports expose fleet-wide analytics, personal driver performance and
// historical location/surveillance data — none of which is "read-only
// dashboard" content. Floor is DISPATCHER ("reads everything" per the RBAC
// design); VIEWER and DRIVER no longer reach reports. Financial idle-billing
// is raised further to FLEET_MANAGER on its own handlers below.
@Controller('reports')
@Roles(Role.DISPATCHER)
export class ReportsController {
  constructor(
    private readonly svc: ReportsService,
    private readonly scorecardCron: ScorecardCronService,
    private readonly fuel: FuelAnalyticsService,
  ) {}

  // Fuel analytics (R2): refuelling + drain/theft for a device over a window.
  @Get('fuel/:deviceId')
  @Audit('report.fuel', { resourceType: 'device', resourceIdParam: 'deviceId' })
  fuelReport(@Param('deviceId') id: string, @Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    const r = this.range(from, to);
    return this.fuel.analyze(id, r.from, r.to, req.user);
  }

  // Manual trigger for the monthly scorecard mailer. SUPER_ADMIN only,
  // used to backfill ("send last month again") and to smoke-test the
  // mailing path without waiting until the 1st of the month at 02:00.
  // Idempotent: the cron uses a per-(company, year-month) Redis key
  // and re-running this endpoint will skip companies already sent.
  @Post('driver-scorecard/run-monthly')
  @Roles(Role.SUPER_ADMIN)
  @Audit('report.driver_scorecard.run_monthly')
  async runMonthlyScorecards() {
    return this.scorecardCron.runMonth();
  }

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

  // ── Per-template data endpoints (new) ──────────────────────────
  // The UI uses these to render template-specific result panels:
  // engine sessions (Мото цаг), trip segments (Зорчилт), idle periods
  // (Зогсолт). Generic positions data still flows through /reports/trip
  // for the chart and the legacy export route.

  @Get('engine-sessions/:deviceId')
  @Audit('report.engine_sessions', { resourceType: 'device', resourceIdParam: 'deviceId' })
  engineSessions(@Param('deviceId') id: string, @Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    const r = this.range(from, to);
    return this.svc.engineSessionsReport(id, r.from, r.to, req.user);
  }

  @Get('trip-segments/:deviceId')
  @Audit('report.trip_segments', { resourceType: 'device', resourceIdParam: 'deviceId' })
  tripSegments(@Param('deviceId') id: string, @Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    const r = this.range(from, to);
    return this.svc.tripSegmentsReport(id, r.from, r.to, req.user);
  }

  @Get('idle-periods/:deviceId')
  @Audit('report.idle_periods', { resourceType: 'device', resourceIdParam: 'deviceId' })
  idlePeriods(@Param('deviceId') id: string, @Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    const r = this.range(from, to);
    return this.svc.idlePeriodsReport(id, r.from, r.to, req.user);
  }

  // Template-aware export. Replaces the old per-format /reports/trip/...
  // endpoints for UI-driven downloads — each template now gets a workbook
  // shaped to match what the user saw on screen (engine sessions, trip
  // segments, idle periods, filtered events) with a filename like
  // engine-hours-2804UBYa-2026-05-28_2026-06-04.xlsx.
  @Get('template/:tplId/:deviceId/:format')
  @Audit('report.template_export', { resourceType: 'device', resourceIdParam: 'deviceId' })
  async templateExport(
    @Param('tplId') tplId: string,
    @Param('deviceId') deviceId: string,
    @Param('format') format: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (!isReportTemplateId(tplId)) {
      throw new BadRequestException(`Unknown report template: ${tplId}`);
    }
    if (format !== 'excel' && format !== 'pdf') {
      throw new BadRequestException(`Unknown format: ${format} (use excel|pdf)`);
    }
    const r = this.range(from, to);
    const { buffer, filename } = await this.svc.exportTemplate(
      tplId as ReportTemplateId,
      deviceId,
      r.from,
      r.to,
      format,
      req.user,
    );
    res.setHeader(
      'Content-Type',
      format === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  // Template catalogue — surfaces filter/title metadata to the frontend so
  // the UI doesn't have to duplicate the filter arrays. Kept open to any
  // signed-in reports user; no sensitive data.
  @Get('templates')
  templates() {
    return Object.entries(REPORT_TEMPLATES).map(([id, t]) => ({
      id,
      kind: t.kind,
      title: t.title,
      filter: (t as any).filter ?? null,
    }));
  }

  // Eco-driving leaderboard. Weights are supplied as repeated `w=TYPE:NN`
  // query params so the GET stays cacheable; missing types default to 0.
  @Get('driver-scores')
  @Audit('report.driver_scores')
  driverScores(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('w') w: string | string[] | undefined,
    @Query('shiftId') shiftId: string | undefined,
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
    return this.svc.driverScores(req.user, r.from, r.to, weights, shiftId || undefined);
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
  // Driver scorecard PDF — pulled on demand from the driver profile.
  // The full "1st-of-month auto-email" loop is roadmap Эрэмбэ 2 v2;
  // this endpoint is what the v2 cron job will call internally, so
  // shipping it first means the UI feature is usable today.
  @Get('driver-scorecard/:driverId')
  @Audit('report.driver_scorecard', { resourceType: 'driver', resourceIdParam: 'driverId' })
  driverScorecard(
    @Param('driverId') driverId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
  ) {
    const r = this.range(from, to);
    return this.svc.driverScorecard(req.user, driverId, r.from, r.to);
  }

  @Get('driver-scorecard/:driverId/pdf')
  @Audit('report.driver_scorecard.pdf', { resourceType: 'driver', resourceIdParam: 'driverId' })
  async driverScorecardPdf(
    @Param('driverId') driverId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const r = this.range(from, to);
    const buf = await this.svc.driverScorecardPdf(req.user, driverId, r.from, r.to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="scorecard-${driverId}-${from}_${to}.pdf"`);
    res.send(buf);
  }

  @Get('idle-billing')
  @Roles(Role.FLEET_MANAGER)
  @Audit('report.idle_billing')
  idleBilling(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('tariff') tariff: string,
    @Query('shiftId') shiftId: string | undefined,
    @Req() req: any,
  ) {
    const r = this.range(from, to);
    const t = Number(tariff);
    if (!Number.isFinite(t) || t < 0) throw new BadRequestException('tariff must be a non-negative number');
    return this.svc.idleBilling(req.user, r.from, r.to, t, shiftId || undefined);
  }

  @Get('idle-billing/excel')
  @Roles(Role.FLEET_MANAGER)
  @Audit('report.idle_billing.excel')
  async idleBillingExcel(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('tariff') tariff: string,
    @Query('shiftId') shiftId: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const r = this.range(from, to);
    const t = Number(tariff);
    if (!Number.isFinite(t) || t < 0) throw new BadRequestException('tariff must be a non-negative number');
    const buf = await this.svc.idleBillingExcel(req.user, r.from, r.to, t, shiftId || undefined);
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
