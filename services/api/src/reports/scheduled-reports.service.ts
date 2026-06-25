import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Role, ReportCadence } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { ReportsService, isReportTemplateId, REPORT_TEMPLATES, type ReportTemplateId } from './reports.service';

type Actor = { id?: string; role: Role; companyId: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Pure scheduling helpers (unit-tested) ─────────────────────────────────
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Whether a scheduled report should run on `now`. The cron fires daily, so the
 * cadence is gated on the day-of-week / day-of-month and de-duplicated by
 * "already ran today" (lastRunAt same calendar day as now).
 */
export function isReportDue(cadence: ReportCadence, lastRunAt: Date | null, now: Date): boolean {
  switch (cadence) {
    case 'DAILY':
      return !lastRunAt || !sameDay(lastRunAt, now);
    case 'WEEKLY':
      return now.getDay() === 1 && (!lastRunAt || !sameDay(lastRunAt, now)); // Monday
    case 'MONTHLY':
      return now.getDate() === 1 && (!lastRunAt || !sameDay(lastRunAt, now)); // 1st
    default:
      return false;
  }
}

/** The [from,to) window a cadence covers when it runs on `now`. */
export function reportPeriod(cadence: ReportCadence, now: Date): { from: Date; to: Date } {
  const today0 = startOfDay(now);
  switch (cadence) {
    case 'DAILY':
      return { from: addDays(today0, -1), to: today0 }; // yesterday
    case 'WEEKLY':
      return { from: addDays(today0, -7), to: today0 }; // last 7 days
    case 'MONTHLY':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 1),
      }; // previous calendar month
    default:
      return { from: addDays(today0, -1), to: today0 };
  }
}

@Injectable()
export class ScheduledReportsService {
  private readonly logger = new Logger(ScheduledReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly email: EmailService,
  ) {}

  // ── CRUD (tenant-scoped) ────────────────────────────────────────────────
  list(actor: Actor) {
    const where = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId };
    return this.prisma.scheduledReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { device: { select: { id: true, name: true, plateNumber: true } } },
    });
  }

  async create(
    actor: Actor,
    dto: {
      name: string;
      templateId: string;
      deviceId: string;
      cadence: ReportCadence;
      format?: string;
      recipients: string[];
      active?: boolean;
    },
  ) {
    const companyId = actor.role === 'SUPER_ADMIN' ? null : actor.companyId;
    if (!companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('No company context');
    this.validate(dto);
    // The device must belong to the actor's tenant.
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    if (actor.role !== 'SUPER_ADMIN' && device.companyId !== actor.companyId) {
      throw new ForbiddenException('Cross-tenant device');
    }
    return this.prisma.scheduledReport.create({
      data: {
        companyId: device.companyId,
        name: dto.name,
        templateId: dto.templateId,
        deviceId: dto.deviceId,
        cadence: dto.cadence,
        format: dto.format === 'pdf' ? 'pdf' : 'excel',
        recipients: dto.recipients,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, actor: Actor, dto: Partial<{ name: string; cadence: ReportCadence; format: string; recipients: string[]; active: boolean }>) {
    const existing = await this.getOwned(id, actor);
    if (dto.recipients) this.validateRecipients(dto.recipients);
    return this.prisma.scheduledReport.update({
      where: { id: existing.id },
      data: {
        name: dto.name,
        cadence: dto.cadence,
        format: dto.format ? (dto.format === 'pdf' ? 'pdf' : 'excel') : undefined,
        recipients: dto.recipients,
        active: dto.active,
      },
    });
  }

  async remove(id: string, actor: Actor) {
    const existing = await this.getOwned(id, actor);
    await this.prisma.scheduledReport.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  // Manual "send now" — runs one report immediately regardless of cadence.
  async runNow(id: string, actor: Actor) {
    const sr = await this.getOwned(id, actor);
    const period = reportPeriod(sr.cadence, new Date());
    await this.deliver(sr, period.from, period.to);
    return { ok: true, sent: sr.recipients.length };
  }

  // ── Cron: fire due reports daily at 06:00 ───────────────────────────────
  @Cron('0 6 * * *')
  async runScheduled() {
    if (!this.email.enabled()) {
      this.logger.warn('Email transport disabled — skipping scheduled reports');
      return;
    }
    const now = new Date();
    const due = await this.prisma.scheduledReport.findMany({ where: { active: true } });
    let sent = 0;
    for (const sr of due) {
      if (!isReportDue(sr.cadence, sr.lastRunAt, now)) continue;
      const period = reportPeriod(sr.cadence, now);
      try {
        await this.deliver(sr, period.from, period.to);
        await this.prisma.scheduledReport.update({ where: { id: sr.id }, data: { lastRunAt: now } });
        sent++;
      } catch (e) {
        this.logger.error(`scheduled report ${sr.id} failed: ${(e as Error).message}`);
      }
    }
    if (sent > 0) this.logger.log(`Scheduled reports sent: ${sent}`);
  }

  // ── internals ───────────────────────────────────────────────────────────
  private async deliver(sr: { id: string; name: string; templateId: string; deviceId: string | null; companyId: string; format: string; recipients: string[] }, from: Date, to: Date) {
    if (!sr.deviceId) throw new BadRequestException('Scheduled report has no device');
    if (sr.recipients.length === 0) return;
    // System actor scoped to the report's company — exportTemplate re-checks the
    // device belongs to it. The Prisma tenant-guard is a no-op outside a request.
    const actor: Actor = { id: 'system', role: 'COMPANY_ADMIN', companyId: sr.companyId };
    const format = sr.format === 'pdf' ? 'pdf' : 'excel';
    const { buffer, filename } = await this.reports.exportTemplate(
      sr.templateId as ReportTemplateId,
      sr.deviceId,
      from,
      to,
      format,
      actor,
    );
    const tpl = REPORT_TEMPLATES[sr.templateId as ReportTemplateId];
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
    await this.email.sendWithAttachments(
      sr.recipients,
      `Fleex тайлан: ${sr.name}`,
      `«${tpl?.title ?? sr.templateId}» тайлан хавсаргав.\nХугацаа: ${fmtDate(from)} → ${fmtDate(to)}`,
      [
        {
          filename,
          content: buffer,
          contentType:
            format === 'pdf'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    );
  }

  private async getOwned(id: string, actor: Actor) {
    const sr = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!sr) throw new NotFoundException('Scheduled report not found');
    if (actor.role !== 'SUPER_ADMIN' && sr.companyId !== actor.companyId) {
      throw new ForbiddenException('Cross-tenant scheduled report');
    }
    return sr;
  }

  private validate(dto: { name: string; templateId: string; cadence: ReportCadence; recipients: string[] }) {
    if (!dto.name?.trim()) throw new BadRequestException('name required');
    if (!isReportTemplateId(dto.templateId)) throw new BadRequestException(`Unknown template: ${dto.templateId}`);
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(dto.cadence)) throw new BadRequestException('Invalid cadence');
    this.validateRecipients(dto.recipients);
  }

  private validateRecipients(recipients: string[]) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new BadRequestException('At least one recipient email required');
    }
    for (const r of recipients) {
      if (!EMAIL_RE.test(r)) throw new BadRequestException(`Invalid email: ${r}`);
    }
  }
}
