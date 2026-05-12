import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { RedisService } from '../common/redis.service';

interface LivePayload {
  deviceId: string;
  companyId: string;
  imei: string;
  lat: number;
  lng: number;
  speed: number;
  course: number;
  altitude: number;
  time: number;
  ignition?: boolean;
  eventIo?: number;
}

interface ClientCtx {
  userId: string;
  role: string;
  companyId: string | null;
  // Specific devices the client opted into; empty set means "all my company".
  deviceFilter: Set<string>;
}

// Live position gateway. Authenticates on the upgrade (?token=jwt), then
// subscribes to Redis Pub/Sub on `fleex.positions` and forwards filtered
// envelopes to each connected client.
//
// Path is /ws so nginx can proxy the upgrade.
@WebSocketGateway({ path: '/ws' })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveGateway.name);
  private sub!: Redis;
  private clients = new WeakMap<WebSocket, ClientCtx>();
  private pingTimer?: NodeJS.Timeout;

  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    this.sub = this.redis.duplicate();
    await this.sub.subscribe('fleex.positions');
    this.sub.on('message', (_channel, raw) => {
      let msg: LivePayload;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      this.fanout(msg);
    });

    const pingMs = Number(this.config.get('WS_PING_INTERVAL_MS') ?? 25_000);
    this.pingTimer = setInterval(() => {
      this.server.clients.forEach((c) => {
        if (c.readyState === WebSocket.OPEN) c.ping();
      });
    }, pingMs);
  }

  async onModuleDestroy() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    await this.sub?.quit().catch(() => undefined);
  }

  handleConnection(client: WebSocket, request: { url?: string; headers: Record<string, string | string[]> }) {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const token = url.searchParams.get('token') ?? extractBearer(request.headers.authorization);
      if (!token) {
        client.close(4001, 'no token');
        return;
      }
      const payload = this.jwt.verify(token);
      this.clients.set(client, {
        userId: payload.sub,
        role: payload.role,
        companyId: payload.companyId,
        deviceFilter: new Set<string>(),
      });
      client.send(JSON.stringify({ type: 'hello', userId: payload.sub }));
    } catch (e) {
      client.close(4001, 'invalid token');
    }
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(@MessageBody() body: { deviceIds?: string[] }, @ConnectedSocket() client: WebSocket) {
    const ctx = this.clients.get(client);
    if (!ctx) return;
    ctx.deviceFilter = new Set(body?.deviceIds ?? []);
    client.send(JSON.stringify({ type: 'subscribed', count: ctx.deviceFilter.size }));
  }

  private fanout(msg: LivePayload) {
    const data = JSON.stringify({ type: 'position', data: msg });
    this.server.clients.forEach((c) => {
      if (c.readyState !== WebSocket.OPEN) return;
      const ctx = this.clients.get(c);
      if (!ctx) return;
      // Tenant isolation: clients can only see their own company's traffic,
      // except SUPER_ADMIN which sees everything.
      if (ctx.role !== 'SUPER_ADMIN' && ctx.companyId !== msg.companyId) return;
      if (ctx.deviceFilter.size > 0 && !ctx.deviceFilter.has(msg.deviceId)) return;
      try {
        c.send(data);
      } catch (e) {
        this.logger.debug(`ws send failed: ${(e as Error).message}`);
      }
    });
  }
}

function extractBearer(h: string | string[] | undefined): string | null {
  if (!h) return null;
  const s = Array.isArray(h) ? h[0] : h;
  const m = /^Bearer (.+)$/i.exec(s);
  return m ? m[1] : null;
}
