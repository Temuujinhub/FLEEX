// Phase 2 — subscription plans, usage limits, invoices & manual payments.
import { BillingService } from '../src/billing/billing.service';
import { getPlan, withinLimit, suggestPlan, PLAN_CATALOG } from '../src/billing/plan-catalog';

const DAY = 86_400_000;
const superAdmin = { id: 'u0', role: 'SUPER_ADMIN' as const, companyId: null };
const admin = { id: 'u1', role: 'COMPANY_ADMIN' as const, companyId: 'c1' };

const svcWith = (prisma: any) => new BillingService(prisma as any);

describe('plan-catalog', () => {
  it('falls back to starter for an unknown key', () => {
    expect(getPlan('nope').key).toBe('starter');
    expect(getPlan('pro').key).toBe('pro');
  });
  it('treats -1 as unlimited; enforces banded caps', () => {
    expect(withinLimit(9999, PLAN_CATALOG.enterprise.maxDevices)).toBe(true);
    expect(withinLimit(11, PLAN_CATALOG.starter.maxDevices)).toBe(false); // starter = 10
    expect(withinLimit(10, PLAN_CATALOG.starter.maxDevices)).toBe(true);
  });
  it('suggests the smallest fitting tier by device count', () => {
    expect(suggestPlan(8).key).toBe('starter');
    expect(suggestPlan(40).key).toBe('business');
    expect(suggestPlan(90).key).toBe('pro');
    expect(suggestPlan(500).key).toBe('enterprise');
  });
});

describe('BillingService.getForCompany', () => {
  it('reports unmanaged with a suggested plan when no subscription exists', async () => {
    const svc = svcWith({
      subscription: { findUnique: async () => null },
      device: { count: async () => 8 },
      user: { count: async () => 3 },
    });
    const out: any = await svc.getForCompany('c1');
    expect(out.managed).toBe(false);
    expect(out.suggestedPlan).toBe('starter');
  });

  it('computes usage + near-cap warning for a managed plan', async () => {
    const svc = svcWith({
      subscription: {
        findUnique: async () => ({
          planKey: 'pro', status: 'ACTIVE', deviceLimitOverride: null,
          startedAt: new Date(), trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 20 * DAY),
        }),
      },
      device: { count: async () => 95 },
      user: { count: async () => 5 },
    });
    const out: any = await svc.getForCompany('c1');
    expect(out.usage.deviceLimit).toBe(100);
    expect(out.warnings.some((w: any) => w.code === 'device_near')).toBe(true);
  });
});

describe('BillingService.assertCanAddDevice', () => {
  const make = (sub: any, count: number) =>
    svcWith({ subscription: { findUnique: async () => sub }, device: { count: async () => count } });

  it('allows when unmanaged', async () => {
    await expect(make(null, 9999).assertCanAddDevice('c1')).resolves.toBeUndefined();
  });
  it('blocks at the starter cap (10)', async () => {
    await expect(make({ planKey: 'starter', status: 'ACTIVE' }, 10).assertCanAddDevice('c1')).rejects.toThrow();
  });
  it('allows under the cap', async () => {
    await expect(make({ planKey: 'business', status: 'ACTIVE' }, 20).assertCanAddDevice('c1')).resolves.toBeUndefined();
  });
  it('blocks when suspended', async () => {
    await expect(make({ planKey: 'enterprise', status: 'SUSPENDED' }, 0).assertCanAddDevice('c1')).rejects.toThrow();
  });
});

describe('BillingService.createInvoice', () => {
  function mock(captured: any, sub: any = null, devices = 30) {
    return svcWith({
      company: { findUnique: async () => ({ id: 'c1' }) },
      subscription: { findUnique: async () => sub },
      device: { count: async () => devices },
      invoice: {
        count: async () => 0,
        create: async (a: any) => { captured.create = a.data; return { id: 'inv1', ...a.data }; },
      },
    });
  }

  it('prices a flat monthly tier × months and numbers the invoice', async () => {
    const cap: any = {};
    const inv: any = await mock(cap).createInvoice(superAdmin, 'c1', { planKey: 'business', months: 2 });
    expect(cap.create.amount).toBe(1_600_000); // 800k × 2
    expect(cap.create.months).toBe(2);
    expect(cap.create.status).toBe('SENT');
    expect(inv.invoiceNumber).toMatch(/^FLX-\d{4}-0001$/);
  });

  it('rejects an invalid duration (e.g. 13 months)', async () => {
    await expect(mock({}).createInvoice(superAdmin, 'c1', { planKey: 'pro', months: 13 })).rejects.toThrow();
  });

  it('allows 1–11 months and 1/2/3 years', async () => {
    for (const m of [1, 11, 12, 24, 36]) {
      await expect(mock({}).createInvoice(superAdmin, 'c1', { planKey: 'starter', months: m })).resolves.toBeTruthy();
    }
  });

  it('honours an explicit amount override (custom/discount)', async () => {
    const cap: any = {};
    await mock(cap).createInvoice(superAdmin, 'c1', { planKey: 'enterprise', months: 12, amount: 9_000_000 });
    expect(cap.create.amount).toBe(9_000_000);
  });

  it('rejects a non-super actor', async () => {
    await expect(mock({}).createInvoice(admin, 'c1', { months: 1 })).rejects.toThrow();
  });
});

describe('BillingService.markInvoicePaid', () => {
  it('marks paid and extends the subscription to the invoice period', async () => {
    const periodEnd = new Date(Date.now() + 60 * DAY);
    let upsertArg: any;
    const svc = svcWith({
      invoice: {
        findUnique: async () => ({
          id: 'inv1', status: 'SENT', companyId: 'c1', planKey: 'business',
          amount: 1_600_000, invoiceNumber: 'FLX-2606-0001',
          periodStart: new Date(), periodEnd,
        }),
        update: async (a: any) => ({ id: 'inv1', ...a.data }),
      },
      subscription: { upsert: async (a: any) => { upsertArg = a; return { id: 's1', ...a.update }; } },
      subscriptionPayment: { create: async (a: any) => ({ id: 'p1', ...a.data }) },
      $transaction: async (ops: any[]) => Promise.all(ops),
    });
    const sub: any = await svc.markInvoicePaid(superAdmin, 'inv1', { bankReference: 'TXN999' });
    expect(sub.status).toBe('ACTIVE');
    expect(new Date(upsertArg.update.currentPeriodEnd).getTime()).toBe(periodEnd.getTime());
  });

  it('refuses to pay an already-paid invoice', async () => {
    const svc = svcWith({ invoice: { findUnique: async () => ({ id: 'inv1', status: 'PAID' }) } });
    await expect(svc.markInvoicePaid(superAdmin, 'inv1', {})).rejects.toThrow();
  });
});
