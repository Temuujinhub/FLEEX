/**
 * P3 — WebSocket ticket auth (audit H-7 / R-3).
 *
 * Verifies the JWT no longer needs to travel in the WS URL: AuthService mints a
 * single-use, short-lived ticket into Redis, and the gateway consumes it
 * atomically (GETDEL) on connect. The legacy ?token path is kept for rollout.
 */
import 'reflect-metadata';
import { AuthService } from '../src/auth/auth.service';
import { LiveGateway } from '../src/websocket/live.gateway';

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
});

describe('LiveGateway.handleConnection', () => {
  const makeClient = () => ({ send: jest.fn(), close: jest.fn(), readyState: 1 });
  const makeGateway = (getdel: jest.Mock, verify: jest.Mock) => {
    const redis = { client: { getdel }, duplicate: jest.fn() };
    const jwt = { verify };
    const config = { get: jest.fn() };
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

  it('still accepts a legacy ?token JWT (backward compatible)', async () => {
    const verify = jest.fn().mockReturnValue({ sub: 'u2', role: 'VIEWER', companyId: 'c2' });
    const gw = makeGateway(jest.fn(), verify);
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws?token=jwt', headers: {} });

    expect(verify).toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'hello', userId: 'u2' }));
    expect(client.close).not.toHaveBeenCalled();
  });

  it('closes when neither ticket nor token is supplied (4001)', async () => {
    const gw = makeGateway(jest.fn(), jest.fn());
    const client = makeClient();

    await gw.handleConnection(client as any, { url: '/ws', headers: {} });

    expect(client.close).toHaveBeenCalledWith(4001, 'no token');
  });
});
