import { TenantStore } from './tenant-context';

// Models that carry a companyId column (see schema.prisma). A non-SUPER_ADMIN
// actor must only ever touch rows in their own company, so the guard injects
// companyId on these models for the collection/bulk operations below. Position
// is omitted — it's a TimescaleDB hypertable accessed only via raw SQL (already
// hand-scoped), never through the Prisma model API.
export const TENANT_MODELS = new Set<string>([
  'AuditLog',
  'CustomField',
  'Device',
  'DeviceGroup',
  'DeviceHealthRule',
  'DeviceImage',
  'Driver',
  'DriverScore',
  'Event',
  'Garage',
  'Geofence',
  'NotificationRule',
  'Place',
  'Sensor',
  'ServiceTask',
  'Shift',
  'SupportTicket',
  'Trip',
  'User',
]);

// Collection / bulk actions whose `where` accepts a non-unique companyId.
// findUnique / update / delete (singular) take a unique where and are
// intentionally left to the services' existing post-fetch ensureSameTenant()
// checks — which the cross-tenant e2e suite covers. create() sets companyId
// explicitly in service code.
export const GUARDED_ACTIONS = new Set<string>([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

export interface GuardParams {
  model?: string;
  action: string;
  args?: any;
}

/**
 * Defense-in-depth tenant guard (audit R-2 / P1). When a request-scoped actor
 * is present and is not SUPER_ADMIN, forces `where.companyId` to the actor's
 * company on tenant-scoped models for collection/bulk operations — so a service
 * method that forgets `where: { companyId }` cannot leak across tenants. It is
 * additive: by-id reads still rely on the services' post-fetch checks, and raw
 * ($queryRaw) queries bypass Prisma middleware and stay hand-scoped.
 *
 * Pure and synchronous so it can be unit-tested without a database; the Prisma
 * $use middleware simply calls it and forwards the (possibly mutated) params.
 */
export function applyTenantGuard<T extends GuardParams>(params: T, store: TenantStore | undefined): T {
  if (!store) return params; // outside a request → system query, no scope
  if (store.role === 'SUPER_ADMIN') return params; // global reader by design
  if (!store.companyId) return params; // no tenant to scope to
  if (!params.model || !TENANT_MODELS.has(params.model)) return params;
  if (!GUARDED_ACTIONS.has(params.action)) return params;

  params.args = params.args ?? {};
  params.args.where = { ...(params.args.where ?? {}), companyId: store.companyId };
  return params;
}
