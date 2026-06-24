/**
 * P1 — defense-in-depth Prisma tenant guard (audit R-2).
 *
 * Unit-tests the pure injection function the Prisma $use middleware calls. The
 * middleware reads the request-scoped actor from AsyncLocalStorage and forces
 * where.companyId on tenant models, so a service that forgets `where:
 * { companyId }` can't leak across tenants.
 */
import { applyTenantGuard } from '../src/common/tenant-guard';
import { TenantStore } from '../src/common/tenant-context';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const member: TenantStore = { companyId: COMPANY, role: 'COMPANY_ADMIN' };

describe('applyTenantGuard', () => {
  it('injects companyId for a non-super actor on a tenant model + collection op', () => {
    const p = applyTenantGuard<any>({ model: 'Device', action: 'findMany', args: {} }, member);
    expect(p.args.where).toEqual({ companyId: COMPANY });
  });

  it('preserves existing where filters while adding companyId', () => {
    const p = applyTenantGuard(
      { model: 'Trip', action: 'findMany', args: { where: { status: 'IN_PROGRESS' } } },
      member,
    );
    expect(p.args.where).toEqual({ status: 'IN_PROGRESS', companyId: COMPANY });
  });

  it('creates args/where when the call had none (e.g. count)', () => {
    const p = applyTenantGuard<any>({ model: 'Event', action: 'count' }, member);
    expect(p.args.where).toEqual({ companyId: COMPANY });
  });

  it('scopes bulk writes (updateMany / deleteMany)', () => {
    const u = applyTenantGuard<any>({ model: 'Sensor', action: 'updateMany', args: { data: {} } }, member);
    expect(u.args.where).toEqual({ companyId: COMPANY });
    const d = applyTenantGuard<any>({ model: 'Geofence', action: 'deleteMany', args: {} }, member);
    expect(d.args.where).toEqual({ companyId: COMPANY });
  });

  it('does NOT touch SUPER_ADMIN queries (global reader)', () => {
    const p = applyTenantGuard(
      { model: 'Device', action: 'findMany', args: { where: { name: 'x' } } },
      { companyId: null, role: 'SUPER_ADMIN' },
    );
    expect(p.args.where).toEqual({ name: 'x' });
  });

  it('does nothing outside a request (no store) — system queries run unscoped', () => {
    const p = applyTenantGuard<any>({ model: 'Device', action: 'findMany', args: {} }, undefined);
    expect(p.args).toEqual({});
  });

  it('leaves by-id ops (findUnique) to the post-fetch checks', () => {
    const p = applyTenantGuard(
      { model: 'Device', action: 'findUnique', args: { where: { id: 'abc' } } },
      member,
    );
    expect(p.args.where).toEqual({ id: 'abc' }); // companyId NOT added
  });

  it('ignores models without a companyId column', () => {
    const p = applyTenantGuard(
      { model: 'RefreshToken', action: 'findMany', args: { where: { userId: 'u' } } },
      member,
    );
    expect(p.args.where).toEqual({ userId: 'u' });
  });
});
