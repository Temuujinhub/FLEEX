import { Role } from '@prisma/client';

// The authenticated principal as resolved by JwtStrategy.validate(). `driverId`
// is populated only when the user is linked to a Driver record (see
// schema.prisma User.driverId).
export interface Actor {
  id?: string;
  role: Role;
  companyId: string | null;
  driverId?: string | null;
}

// A UUID that can never match a real row. Used so a DRIVER with no linked
// Driver record matches nothing instead of everything — least privilege fails
// closed (audit R-1 / docs/SECURITY-MULTI-TENANT-2026-06.md §P2).
export const NO_DRIVER_MATCH = '00000000-0000-0000-0000-000000000000';

export function isDriverActor(actor: Actor): boolean {
  return actor.role === 'DRIVER';
}

// The driverId a DRIVER actor is scoped to (or the no-match sentinel when
// unlinked). Only meaningful for DRIVER actors.
export function driverScopeId(actor: Actor): string {
  return actor.driverId ?? NO_DRIVER_MATCH;
}

/**
 * Adds tenant scope, plus driver scope for DRIVER actors, to a Prisma `where`
 * on a model that carries both `companyId` and a `driverId` column (Device,
 * Trip). SUPER_ADMIN is global and left untouched. Mutates and returns `where`.
 */
export function applyActorScope(actor: Actor, where: Record<string, any> = {}): Record<string, any> {
  if (actor.role === 'SUPER_ADMIN') return where;
  where.companyId = actor.companyId;
  if (actor.role === 'DRIVER') where.driverId = driverScopeId(actor);
  return where;
}

/**
 * Whether a DRIVER actor may access a resource assigned to `ownerDriverId`.
 * Non-DRIVER actors are unaffected here — their tenant check is done
 * separately. A DRIVER must be linked and own the resource.
 */
export function driverMayAccess(actor: Actor, ownerDriverId: string | null | undefined): boolean {
  if (actor.role !== 'DRIVER') return true;
  return actor.driverId != null && actor.driverId === ownerDriverId;
}
