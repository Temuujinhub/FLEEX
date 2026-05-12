import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Single ioredis client used for cache + general-purpose calls. For Pub/Sub
// (subscribe) we create a second connection in the WebSocket gateway, since
// a subscribed connection can't run normal commands.
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://redis:6379/0';
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      reconnectOnError(err) {
        return err.message.includes('READONLY');
      },
    });
  }

  async onModuleInit() {
    await this.client.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  duplicate() {
    return this.client.duplicate();
  }
}
