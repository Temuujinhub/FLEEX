/**
 * P3 — WebSocket ticket auth (audit H-7 / R-3).
 *
 * Verifies the JWT no longer needs to travel in the WS URL: AuthService mints a
 * single-use, short-lived ticket into Redis, and the gateway consumes it
 * atomically (GETDEL) on connect. The legacy ?token path is kept for rollout.
 */
import 'reflect-metadata';
import { AuthService } from '../src/auth/auth.service';
import { LiveGateway, shouldDeliver } from '../src/websocket/live.gateway';

describe('AuthService.createWsTicket', () => {
  it('stores a single-use 30s ticket in Redis and returns it', async () => {
    const redis = { client: { set: jest.fn().mockResolvedValue('OK') } };
    const auth = new AuthService({} as any, {} as any, {} as any, {} as any, redis as any);

    const res = await auth.createWsTicket({ id: 'u1', role: 'COMPANY_ADMIN', companyId: 'c1' });

    expect(res.expiresIn).toBe(30);
    expect(typeof res.ticket).toBe('string');
    expect(res.ticket.length).toBeGreaterThanOrEqual(32);
    expect(redis.client.set).toHaveBeenCalledWith(
      `ws:ticket:${res.ticket}`,
      JSON.stringify({ sub: 'u1', role: 'COMPANY_ADMIN', companyId: 'c1' }),
      'EX',
      30,
    );
  });

  it("embeds the driver's assigned device ids for a DRIVER ticket (H3)", async () => {
    const redis = { client: { set: jest.fn().mockResolvedValue('OK') } };
    const prisma = { device: { findMany: jest.fn().mockResolvedValue([{ id: 'veh-1' }, { id: 'veh-2' }]) } };
    const auth = new AuthService(prisma as any, {} as any, {} as any, {} as any, redis as any);

    const res = await auth.createWsTicket({ id: 'u', role: 'DRIVER', companyId: 'c1', driverId: 'drv-1' });

    const stored = JSON.parse(redis.client.set.mock.calls[0][1]);
    expect(stored.deviceIds).toEqual(['veh-1', 'veh-2']);
    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'c1', driverId: 'drv-1' }) }),
    );
    expect(res.ticket.length).toBeGreaterThanOrEqual(32);
  });
});

describe('shouldDeliver (WS fanout filter, audit H3)', () => {
  const base = {
    role: 'COMPANY_ADMIN',
    companyId: 'A',
    deviceFilter: new Set<string>(),
    driverDeviceIds: null as Set<string> | null,
  };

  it('blocks another company; allows own company', () => {
    expect(shouldDeliver({ ...base }, 'B', 'd1')).toBe(false);
    expect(shouldDeliver({ ...base }, 'A', 'd1')).toBe(true);
  });

  it('SUPER_ADMIN sees every company', () => {
    expect(shouldDeliver({ ...base, role: 'SUPER_ADMIN', companyId: null }, 'B', 'd1')).toBe(true);
  });

  it('DRIVER sees only assigned vehicles, never company-wide envelopes', () => {
    const ctx = { ...base, role: 'DRIVER', driverDeviceIds: new Set(['d1']) };
    expect(shouldDeliver(ctx, 'A', 'd1')).toBe(true);
    expect(shouldDeliver(ctx, 'A', 'd2')).toBe(false); // peer vehicle
    expect(shouldDeliver(ctx, 'A', null)).toBe(false); // deviceId-less company alert
  });

  it('unlinked DRIVER (empty set) receives nothing', () => {
    const ctx = { ...base, role: 'DRIVER', driverDeviceIds: new Set<string>() };
    expect(shouldDeliver(ctx, 'A', 'd1')).toBe(false);
  });

  it('client deviceFilter narrows further (UX, not security)', () => {
    const ctx = { ...base, deviceFilter: new Set(['d1']) };
    expect(shouldDeliver(ctx, 'A', 'd1')).toBe(true);
    expect(shouldDeliver(ctx, 'A', 'd2')).toBe(false);
  });
});

describe('LiveGateway.handleConnection', () => {
  const makeClient = () => ({ send: jest.fn(), close: jest.fn(), readyState: 1 });
  const makeGateway = (getdel: jest.Mock, verify: jest.Mock, cfg: Record<string, string> = {}) => {
    const redis = { client: { getdel }, duplicate: jest.fn() };
    const jwt = { verify };
    const config = { get: (k: string) => cfg[k] };
    return new LiveGateway(jwt as any, redis as any, config as any);
  };

  it('accepts a valid ticket, consumes it (GETDEL), and never reads the JWT', async () => {
    const getdel = jest
      .fn()
      .mockResolvedValue(JSON.stringify({ sub: 'u1', role: 'COMPANY_ADMIN', companyId: 'c1' }));
    const verify = jest.fn();
    const gw = makeGateway(getdel, verify);
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws?ticket=abc', headers: {} });

    expect(getdel).toHaveBeenCalledWith('ws:ticket:abc');
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'hello', userId: 'u1' }));
    expect(client.close).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled(); // ticket path must not touch the JWT
  });

  it('rejects an invalid/expired/replayed ticket (4001)', async () => {
    const getdel = jest.fn().mockResolvedValue(null);
    const gw = makeGateway(getdel, jest.fn());
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws?ticket=stale', headers: {} });

    expect(client.close).toHaveBeenCalledWith(4001, 'invalid ticket');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('rejects a legacy ?token= query JWT by default (audit H4: JWT-in-URL)', async () => {
    const verify = jest.fn().mockReturnValue({ sub: 'u2', role: 'VIEWER', companyId: 'c2' });
    const gw = makeGateway(jest.fn(), verify); // WS_ALLOW_TOKEN_QUERY unset → false
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws?token=jwt', headers: {} });

    expect(verify).not.toHaveBeenCalled(); // query token never even parsed
    expect(client.close).toHaveBeenCalledWith(4001, 'no token');
  });

  it('accepts a legacy ?token= query JWT only when WS_ALLOW_TOKEN_QUERY=true', async () => {
    const verify = jest.fn().mockReturnValue({ sub: 'u2', role: 'VIEWER', companyId: 'c2' });
    const gw = makeGateway(jest.fn(), verify, { WS_ALLOW_TOKEN_QUERY: 'true' });
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws?token=jwt', headers: {} });

    expect(verify).toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'hello', userId: 'u2' }));
    expect(client.close).not.toHaveBeenCalled();
  });

  it('accepts a JWT via the Authorization header (log-safe, always allowed)', async () => {
    const verify = jest.fn().mockReturnValue({ sub: 'u3', role: 'VIEWER', companyId: 'c3' });
    const gw = makeGateway(jest.fn(), verify);
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws', headers: { authorization: 'Bearer jwt' } });

    expect(verify).toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'hello', userId: 'u3' }));
    expect(client.close).not.toHaveBeenCalled();
  });

  it('a DRIVER on the legacy path is fail-closed (no DB to resolve vehicles)', async () => {
    const verify = jest.fn().mockReturnValue({ sub: 'drv', role: 'DRIVER', companyId: 'c4' });
    const gw = makeGateway(jest.fn(), verify, { WS_ALLOW_TOKEN_QUERY: 'true' });
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws?token=jwt', headers: {} });

    // Connects, but shouldDeliver with an empty driverDeviceIds set → nothing.
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'hello', userId: 'drv' }));
    expect(shouldDeliver({ role: 'DRIVER', companyId: 'c4', deviceFilter: new Set(), driverDeviceIds: new Set() }, 'c4', 'any')).toBe(false);
  });

  it('closes when neither ticket nor token is supplied (4001)', async () => {
    const gw = makeGateway(jest.fn(), jest.fn());
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws', headers: {} });

    expect(client.close).toHaveBeenCalledWith(4001, 'no token');
  });
});
