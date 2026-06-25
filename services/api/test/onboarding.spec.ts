import { OnboardingController } from '../src/onboarding/onboarding.controller';

// ConfigService stub: returns whatever map it's given.
const cfg = (map: Record<string, string | undefined>) => ({ get: (k: string) => map[k] }) as any;
const prisma = { device: { count: async () => 2 } } as any;
const req = { user: { companyId: 'c1' } };

describe('OnboardingController.connection', () => {
  it('uses ONBOARDING_SERVER_HOST when set and includes both protocol ports', async () => {
    const ctrl = new OnboardingController(cfg({ ONBOARDING_SERVER_HOST: 'gps.fleex.mn', INGESTOR_TCP_PORT: '5027' }), prisma);
    const out: any = await ctrl.connection(req);
    expect(out.serverHost).toBe('gps.fleex.mn');
    expect(out.ports.map((p: any) => p.protocol).sort()).toEqual(['queclink', 'teltonika']);
    expect(out.ports.find((p: any) => p.protocol === 'teltonika').port).toBe(5027);
    expect(out.deviceCount).toBe(2);
    expect(out.apns.length).toBeGreaterThan(0);
  });

  it('derives the host from APP_URL when no explicit host is set', async () => {
    const ctrl = new OnboardingController(cfg({ APP_URL: 'https://demo.fleex.mn/app' }), prisma);
    const out: any = await ctrl.connection(req);
    expect(out.serverHost).toBe('demo.fleex.mn');
  });

  it('falls back to fleex.mn when nothing is configured', async () => {
    const ctrl = new OnboardingController(cfg({}), prisma);
    const out: any = await ctrl.connection(req);
    expect(out.serverHost).toBe('fleex.mn');
    expect(out.ports.find((p: any) => p.protocol === 'teltonika').port).toBe(5027); // default
  });
});
