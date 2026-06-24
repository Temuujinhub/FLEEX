import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  companyId: string | null;
  role: string;
}

// Request-scoped actor context, populated by TenantContextInterceptor after
// authentication and read by the Prisma tenant-guard middleware. Outside a
// request (app bootstrap, demo seeding, scheduled jobs) there is no store, so
// the guard is a no-op and those system-level queries run unscoped.
export const tenantStore = new AsyncLocalStorage<TenantStore>();
