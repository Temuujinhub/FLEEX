// Company-scoped (fleet-wide) reports — batch 2. Exercises the JS rollup logic
// (status derivation, BigInt handling, per-device grouping, tenant scoping)
// with a mocked Prisma. The fleet-summary SQL aggregate is integration-tested
// elsewhere (raw $queryRaw).
import { FleetReportsService } from '../src/reports/fleet-reports.service';

const FROM = new Date('2026-06-01T00:00:00Z');
const TO = new Date('2026-06-30T23:59:59Z');
const NOW = new Date('2026-06-20T00:00:00Z');
const actor = { role: 'COMPANY_ADMIN' as const, companyId: 'c1' };

function svcWith(prisma: any) {
  return new FleetReportsService(prisma as any);
}

describe('FleetReportsService.maintenance', () => {
  it('marks a past-due open task OVERDUE and totals cost', async () => {
    const svc = svcWith({
      serviceTask: {
        findMany: async () => [
          { id: 't1', title: 'Тос солих', kind: 'OIL_CHANGE', status: 'PLANNED', cost: 50000, unplanned: false,
            scheduledAt: new Date('2026-06-10T00:00:00Z'), completedAt: null, performedBy: null,
            device: { name: 'Truck A', plateNumber: '1234' } },
          { id: 't2', title: 'Засвар', kind: 'REPAIR', status: 'COMPLETED', cost: 100000, unplanned: true,
            scheduledAt: new Date('2026-06-05T00:00:00Z'), completedAt: new Date('2026-06-06T00:00:00Z'), performedBy: 'Бат',
            device: { name: 'Truck B', plateNumber: '5678' } },
        ],
      },
    });
    const out = await svc.maintenance(actor, FROM, TO, NOW);
    expect(out.rows[0].effectiveStatus).toBe('OVERDUE'); // PLANNED + scheduledAt < now
    expect(out.rows[1].effectiveStatus).toBe('COMPLETED');
    expect(out.totals).toMatchObject({ total: 2, completed: 1, overdue: 1, totalCost: 150000 });
  });

  it('returns empty for a tenant-less non-super actor (no cross-tenant leak)', async () => {
    const svc = svcWith({ serviceTask: { findMany: async () => { throw new Error('should not query'); } } });
    const out = await svc.maintenance({ role: 'COMPANY_ADMIN', companyId: null }, FROM, TO, NOW);
    expect(out.totals.total).toBe(0);
    expect(out.rows).toEqual([]);
  });
});

describe('FleetReportsService.gprs', () => {
  it('sums Rx+Tx BigInt bytes into MB per device and sorts desc', async () => {
    const MB = 1_048_576n;
    const svc = svcWith({
      gprsCounter: {
        findMany: async () => [
          { deviceId: 'd1', yearMonth: '2026-06', bytesRx: MB, bytesTx: MB, packetCount: 10, device: { name: 'A', plateNumber: null } },
          { deviceId: 'd1', yearMonth: '2026-05', bytesRx: MB, bytesTx: 0n, packetCount: 5, device: { name: 'A', plateNumber: null } },
          { deviceId: 'd2', yearMonth: '2026-06', bytesRx: 0n, bytesTx: MB, packetCount: 3, device: { name: 'B', plateNumber: null } },
        ],
      },
    });
    const out = await svc.gprs(actor, FROM, TO);
    expect(out.rows[0]).toMatchObject({ device: 'A', mb: 3, packets: 15, months: 2 });
    expect(out.rows[1]).toMatchObject({ device: 'B', mb: 1 });
    expect(out.totals).toMatchObject({ devices: 2, mb: 4, packets: 18 });
  });
});

describe('FleetReportsService.commandLog', () => {
  it('stringifies BigInt ids and tallies statuses', async () => {
    const svc = svcWith({
      command: {
        findMany: async () => [
          { id: 123n, type: 'engine_block', status: 'DELIVERED', attempts: 1, result: 'ok',
            createdAt: new Date('2026-06-10T00:00:00Z'), sentAt: null, deliveredAt: new Date('2026-06-10T00:01:00Z'),
            device: { name: 'A', plateNumber: null } },
          { id: 124n, type: 'reset', status: 'FAILED', attempts: 3, result: 'timeout',
            createdAt: new Date('2026-06-11T00:00:00Z'), sentAt: null, deliveredAt: null,
            device: { name: 'B', plateNumber: null } },
        ],
      },
    });
    const out = await svc.commandLog(actor, FROM, TO);
    expect(out.rows[0].id).toBe('123');
    expect(typeof out.rows[0].id).toBe('string');
    expect(out.totals).toMatchObject({ total: 2, delivered: 1, failed: 1, pending: 0 });
  });
});
