import { Controller, Get, Logger } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    // Unauthenticated endpoint: never return raw driver error strings (they can
    // disclose DB host/version/connection details). Log detail server-side,
    // expose only ok/error to the caller (audit L3).
    const checks: Record<string, string> = { api: 'ok' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'ok';
    } catch (e) {
      this.logger.warn(`postgres health check failed: ${(e as Error).message}`);
      checks.postgres = 'error';
    }
    try {
      const pong = await this.redis.client.ping();
      checks.redis = pong === 'PONG' ? 'ok' : 'unexpected';
    } catch (e) {
      this.logger.warn(`redis health check failed: ${(e as Error).message}`);
      checks.redis = 'error';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    return { status: ok ? 'ok' : 'degraded', checks, time: new Date().toISOString() };
  }

  @Public()
  @Get('/')
  root() {
    return { name: 'Fleex API', status: 'running' };
  }
}
