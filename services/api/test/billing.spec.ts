// Phase 2 — subscription plans, usage limits & manual payments.
import { BillingService } from '../src/billing/billing.service';
import { getPlan, withinLimit, PLAN_CATALOG } from '../src/billing/plan-catalog';

const DAY = 86_400_000;
const superAdmin = { id: 'u0', role: 'SUPER_ADMIN' as const, companyId: null };
const admin = { id: 'u1', role: 'COMPANY_ADMIN' as const, companyId: 'c1' };

function svcWith(prisma: any) {
  return new BillingService(prisma as any);
}

describe('plan-catalog', () => {
  it('falls back to trial for an unknown key', () => {
    expect(getPlan('nope').key).toBe('trial');
    expect(getPlan('pro').key).toBe('pro');
  });
  it('treats -1 as unlimited in withinLimit', () => {
    expect(withinLimit(9999, PLAN_CATALOG.enterprise.maxDevices)).toBe(true);
    expect(withinLimit(26, PLAN_CATALOG.basic.maxDevices)).toBe(false);
    expect(withinLimit(25, PLAN_CATALOG.basic.maxDevices)).toBe(true);
  });
});

describe('BillingService.getForCompany', () => {
  it('reports unmanaged when no subscription row exists (no caps)', async () => {
    const svc = svcWith({
      subscription: { findUnique: async () => null },
      device: { count: async () => 40 },
      user: { count: async () => 5 },
    });
    const out: any = await svc.getForCompany('c1');
    expect(out.managed).toBe(false);
    expect(out.warnings[0].code).toBe('unmanaged');
  });

  it('computes usage and a near-cap warning for a managed plan', async () => {
    const svc = svcWith({
      subscription: {
        findUnique: async () => ({
          planKey: 'pro', status: 'ACTIVE', deviceLimitOverride: null,
          startedAt: new Date(), trialEndsAt: null,
          currentPeriodEnd: new Date(Date.now() + 20 * DAY),
        }),
      },
      device: { count: async () => 95 },
      user: { count: async () => 5 },
    });
    const out: any = await svc.getForCompany('c1');
    expect(out.managed).toBe(true);
    expect(out.usage.deviceLimit).toBe(100);
    expect(out.usage.devicePct).toBe(95);
    expect(out.warnings.some((w: any) => w.code === 'device_near')).toBe(true);
  });
});

describe('BillingService.assertCanAddDevice', () => {
  const make = (sub: any, count: number) =>
    svcWith({ subscription: { findUnique: async () => sub }, device: { count: async () => count } });

  it('allows when unmanaged', async () => {
    await expect(make(null, 9999).assertCanAddDevice('c1')).resolves.toBeUndefined();
  });
  it('allows under the cap', async () => {
    await expect(make({ planKey: 'basic', status: 'ACTIVE' }, 10).assertCanAddDevice('c1')).resolves.toBeUndefined();
  });
  it('blocks at the cap', async () => {
    await expect(make({ planKey: 'basic', status: 'ACTIVE' }, 25).assertCanAddDevice('c1')).rejects.toThrow();
  });
  it('blocks when suspended regardless of count', async () => {
    await expect(make({ planKey: 'enterprise', status: 'SUSPENDED' }, 0).assertCanAddDevice('c1')).rejects.toThrow();
  });
  it('honours a per-company override', async () => {
    await expect(make({ planKey: 'basic', status: 'ACTIVE', deviceLimitOverride: 5 }, 5).assertCanAddDevice('c1')).rejects.toThrow();
  });
});

describe('BillingService.recordPayment', () => {
  it('extends the period from the later of now/current end and sets ACTIVE', async () => {
    let upsertArg: any;
    const existingEnd = new Date(Date.now() + 5 * DAY); // 5 days left
    const svc = svcWith({
      subscription: {
        findUnique: async () => ({ planKey: 'basic', status: 'ACTIVE', currentPeriodEnd: existingEnd }),
        upsert: async (a: any) => { upsertArg = a; return { id: 's1', ...a.update }; },
      },
      subscriptionPayment: { create: async (a: any) => ({ id: 'p1', ...a.data }) },
      $transaction: async (ops: any[]) => Promise.all(ops),
    });
    await svc.recordPayment(superAdmin, 'c1', { amount: 100000, planKey: 'basic' });
    expect(upsertArg.update.status).toBe('ACTIVE');
    // basic = 30-day period added on top of the remaining 5 → ~35 days out.
    const end = new Date(upsertArg.update.currentPeriodEnd).getTime();
    const expected = existingEnd.getTime() + 30 * DAY;
    expect(Math.abs(end - expected)).toBeLessThan(2 * DAY);
  });

  it('rejects a non-super actor', async () => {
    const svc = svcWith({});
    await expect(svc.recordPayment(admin, 'c1', {})).rejects.toThrow();
  });
});
