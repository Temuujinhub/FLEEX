import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    const checks: Record<string, string> = { api: 'ok' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'ok';
    } catch (e) {
      checks.postgres = `error: ${(e as Error).message}`;
    }
    try {
      const pong = await this.redis.client.ping();
      checks.redis = pong === 'PONG' ? 'ok' : 'unexpected';
    } catch (e) {
      checks.redis = `error: ${(e as Error).message}`;
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
