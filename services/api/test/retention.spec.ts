import { RetentionEnforcementService } from '../src/billing/retention-enforcement.service';

// ConfigService stub.
const cfg = (map: Record<string, string | undefined> = {}) => ({ get: (k: string) => map[k] }) as any;

function make(map: Record<string, string | undefined>, opts: { count?: number } = {}) {
  const calls = { deletes: 0, executed: [] as string[] };
  const prisma = {
    subscription: { findMany: async () => [{ companyId: 'c1', planKey: 'starter' }] },
    $queryRaw: async () => [{ count: BigInt(opts.count ?? 0) }],
    $executeRaw: async () => { calls.deletes += 1; return 0; },
  } as any;
  return { svc: new RetentionEnforcementService(prisma, cfg(map)), calls };
}

describe('RetentionEnforcementService', () => {
  it('dry-run by default: counts overdue rows but deletes nothing', async () => {
    const { svc, calls } = make({}, { count: 5000 });
    const report: any = await svc.runDaily();
    expect(report[0].rows).toBe(5000);
    expect(report[0].deleted).toBe(0);
    expect(calls.deletes).toBe(0); // no DELETE issued
  });

  it('preview is always read-only even when enforcing is on', async () => {
    const { svc, calls } = make({ RETENTION_ENFORCE: 'on' }, { count: 3000 });
    const out: any = await svc.preview();
    expect(out.enforcing).toBe(true);
    expect(out.tenants[0].rows).toBe(3000);
    expect(out.tenants[0].deleted).toBe(0);
    expect(calls.deletes).toBe(0); // preview never deletes
  });

  it('enforces deletion when RETENTION_ENFORCE=on and rows exist', async () => {
    const { svc, calls } = make({ RETENTION_ENFORCE: 'on' }, { count: 100 });
    await svc.runDaily();
    expect(calls.deletes).toBeGreaterThan(0); // DELETE was issued
  });

  it('clamps the window to the safety floor (starter 180d but floor 9999d → cutoff older than any data)', async () => {
    // With a floor larger than the plan window, the effective retention is the
    // floor — so the cutoff is far in the past and nothing is overdue.
    const { svc } = make({ RETENTION_FLOOR_DAYS: '9999' }, { count: 0 });
    const out: any = await svc.preview();
    expect(out.floorDays).toBe(9999);
    expect(out.tenants[0].retentionDays).toBe(9999); // max(180, 9999)
  });
});
