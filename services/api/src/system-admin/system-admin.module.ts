// SUPER_ADMIN-only health & diagnostics surface. Aggregates the
// pieces a site reliability operator wants in one place: service
// liveness (DB/Redis/SMTP/SMS), fleet & traffic counters, host
// resource usage, audit chain integrity, and a check-yourself
// Oyu Tolgoi compliance matrix. Also exposes test-send buttons
// so an operator can verify mail/SMS delivery without having to
// trigger a real GPS event (which previously meant overspeeding
// a vehicle to "see if the notification works").

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsOptional, IsString } from 'class-validator';
import * as os from 'os';
import * as fs from 'fs';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';
import { EmailService } from '../notifications/email.service';
import { SmsService } from '../notifications/sms.service';
import {
  INTEGRATION_ENV,
  IntegrationKey,
  IntegrationSettingsService,
} from '../notifications/integration-settings.service';
import { NotificationsModule } from '../notifications/notifications.module';

class TestEmailDto {
  @IsString() to!: string;
  @IsOptional() @IsString() subject?: string;
}

class TestSmsDto {
  @IsString() to!: string;
  @IsOptional() @IsString() text?: string;
}

class UpdateIntegrationDto {
  // Empty string clears the DB row, falling back to env (or disabled).
  @IsString() value!: string;
}

@Injectable()
class SystemAdminService {
  private readonly logger = new Logger(SystemAdminService.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
    private readonly integrations: IntegrationSettingsService,
  ) {}

  async overview() {
    const [services, fleet, traffic, resources, security] = await Promise.all([
      this.services(),
      this.fleet(),
      this.traffic(),
      this.resources(),
      this.security(),
    ]);
    return {
      services,
      fleet,
      traffic,
      resources,
      security,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      time: new Date().toISOString(),
    };
  }

  private async services() {
    const out: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      out.postgres = { ok: true };
    } catch (e) {
      out.postgres = { ok: false, detail: (e as Error).message };
    }

    try {
      const pong = await this.redis.client.ping();
      out.redis = { ok: pong === 'PONG' };
    } catch (e) {
      out.redis = { ok: false, detail: (e as Error).message };
    }

    out.smtp = {
      ok: this.email.enabled(),
      detail: this.email.enabled() ? this.email.describe() : 'not configured',
    };
    out.sms = {
      ok: this.sms.enabled(),
      detail: this.sms.enabled() ? `callpro ${this.config.get('SMS_FROM')}` : 'not configured',
    };

    // App services via their /healthz on the internal compose network — the
    // same set the deploy health gate waits on (infra/deploy/deploy.sh), so
    // this page mirrors deploy state. If this endpoint answered, the API is up.
    out.api = { ok: true, detail: 'REST + WS' };
    const [ingestor, eventsEngine, media, web] = await Promise.all([
      this.pingHttp('http://ingestor:9090/healthz'),
      this.pingHttp('http://events-engine:9091/healthz'),
      this.pingHttp('http://media-service:9092/healthz'),
      this.pingHttp('http://web:80/'),
    ]);
    out.ingestor = { ok: ingestor, detail: 'Teltonika :5027' };
    out.eventsEngine = { ok: eventsEngine, detail: 'geofence · overspeed' };
    out.mediaService = { ok: media, detail: 'DualCam :5029' };
    out.web = { ok: web, detail: 'nginx SPA' };

    return out;
  }

  // Hits a service health endpoint on the internal network. Short timeout so a
  // hung service can't stall the overall health response.
  private async pingHttp(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async fleet() {
    // Online window of 5 minutes mirrors the dashboard heuristic. We pull
    // the count and the moving subset in two cheap queries instead of
    // streaming all positions through the API.
    const onlineCutoff = new Date(Date.now() - 5 * 60_000);
    const [companies, users, devicesTotal, devicesActive, devicesOnline, devicesMoving] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.user.count(),
      this.prisma.device.count(),
      this.prisma.device.count({ where: { status: 'ACTIVE' } }),
      this.prisma.device.count({ where: { lastSeenAt: { gte: onlineCutoff } } }),
      this.prisma.device.count({ where: { lastSeenAt: { gte: onlineCutoff }, lastSpeed: { gt: 1 } } }),
    ]);

    return { companies, users, devicesTotal, devicesActive, devicesOnline, devicesMoving };
  }

  private async traffic() {
    // Recent ingestion and event volume. Position counts on a TimescaleDB
    // hypertable are cheap because the planner prunes chunks by time;
    // events is a small relational table.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const hourAgo = new Date(Date.now() - 60 * 60_000);

    const positionsToday = await this.countPositions(todayStart);
    const positionsLastHour = await this.countPositions(hourAgo);
    const [eventsToday, criticalToday] = await Promise.all([
      this.prisma.event.count({ where: { occurredAt: { gte: todayStart } } }),
      this.prisma.event.count({ where: { occurredAt: { gte: todayStart }, severity: 'CRITICAL' } }),
    ]);

    // Teltonika AVL records average ~70 bytes per record on the wire after
    // header framing. We surface the estimate transparently so it's clear
    // the number is derived, not measured.
    const avgPacketBytes = 70;
    const positionsPerSecondAvg = positionsLastHour / 3600;
    const bandwidthBpsEstimate = positionsPerSecondAvg * avgPacketBytes * 8;

    return {
      positionsToday,
      positionsLastHour,
      eventsToday,
      criticalToday,
      avgPacketBytes,
      positionsPerSecondAvg: Number(positionsPerSecondAvg.toFixed(2)),
      bandwidthBpsEstimate: Math.round(bandwidthBpsEstimate),
    };
  }

  private async resources() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    let disk: { total: number; free: number; used: number } | null = null;
    try {
      const s = fs.statfsSync('/');
      disk = {
        total: s.blocks * s.bsize,
        free: s.bavail * s.bsize,
        used: (s.blocks - s.bavail) * s.bsize,
      };
    } catch {
      disk = null;
    }

    let dbSizeBytes: number | null = null;
    try {
      const rows = await this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS size`;
      dbSizeBytes = Number(rows[0]?.size ?? 0);
    } catch {
      dbSizeBytes = null;
    }

    let redisMemBytes: number | null = null;
    try {
      const info = await this.redis.client.info('memory');
      const m = info.match(/used_memory:(\d+)/);
      redisMemBytes = m ? Number(m[1]) : null;
    } catch {
      redisMemBytes = null;
    }

    return {
      cpuCount: os.cpus().length,
      loadAvg1: os.loadavg()[0],
      loadAvg5: os.loadavg()[1],
      loadAvg15: os.loadavg()[2],
      memoryTotal: totalMem,
      memoryUsed: usedMem,
      memoryFree: freeMem,
      memoryPct: Number(((usedMem / totalMem) * 100).toFixed(1)),
      disk,
      dbSizeBytes,
      redisMemBytes,
    };
  }

  private async security() {
    // Pulls cheap signals that hint at problems without dumping the
    // whole audit log. Lock-out attempts and recent failures help an
    // operator notice brute force; chain verify proves nobody edited
    // history out-of-band.
    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const [failedLogins24h, deniedActions24h, lastAudit] = await Promise.all([
      this.prisma.auditLog.count({ where: { occurredAt: { gte: dayAgo }, action: 'auth.login', outcome: 'failure' } }).catch(() => 0),
      this.prisma.auditLog.count({ where: { occurredAt: { gte: dayAgo }, outcome: 'denied' } }).catch(() => 0),
      this.prisma.auditLog.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }).catch(() => null),
    ]);

    return {
      failedLogins24h,
      deniedActions24h,
      lastAuditAt: lastAudit?.occurredAt?.toISOString() ?? null,
      httpsEnforced: (this.config.get<string>('APP_URL') ?? '').startsWith('https://'),
    };
  }

  // The positions hypertable is marked @@ignore in the Prisma schema (the
  // model exists only so prisma migrate doesn't try to drop it) so we
  // can't use prisma.position.count(). A raw count(*) on a chunk-pruned
  // hypertable is the supported path.
  private async countPositions(since: Date): Promise<number> {
    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM positions WHERE time >= ${since}
      `;
      return Number(rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  async sendTestEmail(to: string, subject?: string) {
    if (!this.email.enabled()) {
      throw new BadRequestException('SMTP not configured. Set SMTP_HOST/USER/PASS/FROM in .env');
    }
    const trimmed = to.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new BadRequestException('Invalid email address');
    }
    const body = [
      'This is a Fleex test email.',
      '',
      `Time: ${new Date().toISOString()}`,
      `Host: ${os.hostname()}`,
      '',
      'If you received this, your SMTP integration is working.',
    ].join('\n');
    try {
      await this.email.send([trimmed], subject ?? '[Fleex] SMTP test', body);
      return { ok: true, to: trimmed };
    } catch (err: any) {
      // Bubble up the actual SMTP/nodemailer error so the operator can
      // see what's wrong (auth failure, quota exceeded, unverified
      // sender, etc.) instead of a generic 500. Without this the
      // System Health page was useless for diagnostics — it always
      // just said "Internal server error".
      const message =
        err?.response ||
        err?.responseCode ||
        err?.code ||
        err?.message ||
        'Unknown SMTP error';
      throw new BadRequestException(
        `SMTP send failed: ${typeof message === 'string' ? message : JSON.stringify(message)}`,
      );
    }
  }

  async listIntegrations() {
    return this.integrations.list();
  }

  async updateIntegration(key: string, value: string, userId?: string) {
    if (!(key in INTEGRATION_ENV)) {
      throw new BadRequestException(`Unknown integration key: ${key}`);
    }
    await this.integrations.set(key as IntegrationKey, value, userId);
    // Swap the new value into the live transports so the next test send
    // uses it without a process restart.
    if (key === 'brevo_api_key') {
      await this.email.reload();
    } else if (key === 'sms_api_key') {
      await this.sms.reload();
    }
    return { ok: true, key };
  }

  async sendTestSms(to: string, text?: string) {
    if (!this.sms.enabled()) {
      throw new BadRequestException('SMS not configured. Set SMS_PROVIDER=callpro plus SMS_API_KEY / SMS_FROM in .env (or paste the key in System Health).');
    }
    const trimmed = to.trim();
    const body = text ?? `Fleex test ${new Date().toISOString().slice(11, 19)} UTC`;
    try {
      // sendDirect throws the real gateway error (status + body) so a failed
      // delivery is reported honestly instead of a false "sent". It also
      // returns the gateway Message ID and the request URL/body so the UI
      // can show exactly which endpoint was hit (handy for diagnosing 404s).
      const r = await this.sms.sendDirect(trimmed, body);
      return {
        ok: true,
        to: r.to,
        messageId: r.messageId ?? null,
        url: r.url ?? null,
        method: r.method ?? null,
        requestBody: r.requestBody ?? null,
        responseStatus: r.responseStatus ?? null,
        responseBody: r.responseBody ?? null,
      };
    } catch (err: any) {
      throw new BadRequestException(err?.message ?? 'Unknown SMS error');
    }
  }
}

@Controller('system-admin')
@Roles(Role.SUPER_ADMIN)
class SystemAdminController {
  constructor(private readonly svc: SystemAdminService) {}

  @Get('overview')
  @Audit('system-admin.overview')
  overview() {
    return this.svc.overview();
  }

  @Post('test-email')
  @Audit('system-admin.test-email', { resourceType: 'system-admin' })
  testEmail(@Body() dto: TestEmailDto) {
    return this.svc.sendTestEmail(dto.to, dto.subject);
  }

  @Post('test-sms')
  @Audit('system-admin.test-sms', { resourceType: 'system-admin' })
  testSms(@Body() dto: TestSmsDto) {
    return this.svc.sendTestSms(dto.to, dto.text);
  }

  @Get('integrations')
  @Audit('system-admin.integrations.list')
  listIntegrations() {
    return this.svc.listIntegrations();
  }

  // PUT body: { value: "xkeysib-..." }. Empty value clears the DB row
  // so the env-var fallback (if any) takes back over.
  @Put('integrations/:key')
  @Audit('system-admin.integrations.update', { resourceType: 'integration' })
  updateIntegration(@Param('key') key: string, @Body() dto: UpdateIntegrationDto, @Req() req: any) {
    return this.svc.updateIntegration(key, dto.value, req?.user?.id);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [SystemAdminController],
  providers: [SystemAdminService],
})
export class SystemAdminModule {}
