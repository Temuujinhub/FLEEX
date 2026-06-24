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

interface EventPayload {
  id: string;
  companyId: string;
  deviceId: string;
  geofenceId?: string | null;
  type: string;
  severity: string;
  lat?: number;
  lng?: number;
  speed?: number;
  message?: string;
  occurredAt: string;
}

interface ClientCtx {
  userId: string;
  role: string;
  companyId: string | null;
  // Specific devices the client opted into; empty set means "all my company".
  deviceFilter: Set<string>;
  // DRIVER least-privilege (audit H3): the vehicle ids this driver may see,
  // embedded in the ws-ticket at mint time (the gateway has no DB). null for
  // non-driver roles (no extra scoping); an empty set = linked to nothing →
  // receives nothing (fail closed).
  driverDeviceIds: Set<string> | null;
}

// Live gateway. Authenticates on the upgrade (?token=jwt), then subscribes to
// two Redis Pub/Sub channels and forwards filtered envelopes to clients:
//
//   • `fleex.positions` — emitted by the gps-ingestor on every parsed AVL
//     record. Forwarded as { type: 'position', data: ... }.
//   • `fleex.events`    — emitted by the events-engine on geofence
//     transitions and overspeed. Forwarded as { type: 'event', data: ... }.
//
// Tenant isolation is applied at fanout time using the `companyId` on each
// envelope: a client never sees traffic from another company.
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
    await this.sub.subscribe('fleex.positions', 'fleex.events');
    this.sub.on('message', (channel, raw) => {
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (channel === 'fleex.positions') {
        this.fanout('position', parsed as LivePayload, parsed.companyId, parsed.deviceId);
      } else if (channel === 'fleex.events') {
        const ev = parsed as EventPayload;
        // Events without a deviceId still scope to companyId; pass the device
        // id when present so per-device subscriptions get their alerts too.
        this.fanout('event', ev, ev.companyId, ev.deviceId);
      }
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

  async handleConnection(
    client: WebSocket,
    request: { url?: string; headers: Record<string, string | string[]> },
  ) {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');

      // Preferred path: a single-use ticket minted by POST /auth/ws-ticket.
      // Consumed atomically (GETDEL) so it can't be replayed, and the JWT
      // never appears in the WS URL / access logs (audit H-7 / R-3).
      const ticket = url.searchParams.get('ticket');
      if (ticket) {
        const raw = await this.redis.client.getdel(`ws:ticket:${ticket}`);
        if (!raw) {
          client.close(4001, 'invalid ticket');
          return;
        }
        const id = JSON.parse(raw) as {
          sub: string;
          role: string;
          companyId: string | null;
          deviceIds?: string[];
        };
        this.clients.set(client, {
          userId: id.sub,
          role: id.role,
          companyId: id.companyId,
          deviceFilter: new Set<string>(),
          driverDeviceIds: id.role === 'DRIVER' ? new Set(id.deviceIds ?? []) : null,
        });
        client.send(JSON.stringify({ type: 'hello', userId: id.sub }));
        return;
      }

      // Legacy JWT path. The ?token= query form is OFF by default (audit H4) —
      // it leaks the JWT into URLs / proxy logs; prefer ?ticket. The
      // Authorization header is log-safe and always accepted.
      const allowQueryToken =
        (this.config.get<string>('WS_ALLOW_TOKEN_QUERY') ?? 'false') === 'true';
      const token =
        extractBearer(request.headers.authorization) ??
        (allowQueryToken ? url.searchParams.get('token') : null);
      if (!token) {
        client.close(4001, 'no token');
        return;
      }
      const payload = this.jwt.verify(token, { algorithms: ['HS256'] });
      this.clients.set(client, {
        userId: payload.sub,
        role: payload.role,
        companyId: payload.companyId,
        deviceFilter: new Set<string>(),
        // The gateway can't resolve a driver's vehicles here (no DB), so a
        // DRIVER on the legacy path is fail-closed — they must use a ws-ticket
        // (which carries the device ids) to receive live data.
        driverDeviceIds: payload.role === 'DRIVER' ? new Set<string>() : null,
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

  private fanout(type: 'position' | 'event', payload: any, companyId: string, deviceId?: string | null) {
    const data = JSON.stringify({ type, data: payload });
    this.server.clients.forEach((c) => {
      if (c.readyState !== WebSocket.OPEN) return;
      const ctx = this.clients.get(c);
      if (!ctx) return;
      if (!shouldDeliver(ctx, companyId, deviceId)) return;
      try {
        c.send(data);
      } catch (e) {
        this.logger.debug(`ws send failed: ${(e as Error).message}`);
      }
    });
  }
}

// Decides whether a connected client should receive an envelope: tenant
// isolation (SUPER_ADMIN sees all), DRIVER least-privilege (audit H3 — only
// assigned vehicles, never company-wide), then the client's own device filter
// (a UX convenience, not a security boundary). Pure → unit-tested directly.
export function shouldDeliver(
  ctx: { role: string; companyId: string | null; deviceFilter: Set<string>; driverDeviceIds: Set<string> | null },
  companyId: string,
  deviceId?: string | null,
): boolean {
  if (ctx.role !== 'SUPER_ADMIN' && ctx.companyId !== companyId) return false;
  if (ctx.driverDeviceIds) {
    if (!deviceId || !ctx.driverDeviceIds.has(deviceId)) return false;
  }
  if (deviceId && ctx.deviceFilter.size > 0 && !ctx.deviceFilter.has(deviceId)) return false;
  return true;
}

function extractBearer(h: string | string[] | undefined): string | null {
  if (!h) return null;
  const s = Array.isArray(h) ? h[0] : h;
  const m = /^Bearer (.+)$/i.exec(s);
  return m ? m[1] : null;
}
