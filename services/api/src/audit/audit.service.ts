import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Append-only audit log with hash chaining. Each new row's `hash` =
// sha256(prevHash || canonical(payload)). If anyone tampers with a row,
// every row after it stops verifying. We expose verifyChain() for periodic
// checks; the system also fast-fails noisy writes if the chain is broken.
export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  companyId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
  outcome?: 'success' | 'failure' | 'denied';
}

const GENESIS = '0'.repeat(64);

// Postgres advisory lock key that serializes all audit appends so concurrent
// writers can't read the same tail hash and fork the chain. Arbitrary fixed
// constant ("AUDI"); must be stable across instances.
const AUDIT_ADVISORY_LOCK = 0x41554449;

// Canonical fields a chained row hashes over. Used by BOTH record() and
// verifyChain() so the two can never drift — the values stored must be the
// exact values hashed, including a JS-fixed occurredAt (never the DB default).
interface AuditCanonicalFields {
  actorId: string | null;
  actorEmail: string | null;
  companyId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  outcome: string;
  occurredAt: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    // occurredAt is fixed here and written explicitly so the stored value is
    // byte-for-byte the value folded into the hash (the DB default now() would
    // differ and break verification).
    const occurredAt = new Date();
    const fields: AuditCanonicalFields = {
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      companyId: entry.companyId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      metadata: entry.metadata ?? null,
      outcome: entry.outcome ?? 'success',
      occurredAt: occurredAt.toISOString(),
    };
    const canonical = canonicalize(fields);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialize appends. The lock is transaction-scoped and released on
        // commit/rollback, and the tail is read from the DB inside the lock so
        // this is correct even across multiple API instances.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_ADVISORY_LOCK}::bigint)`;
        const last = await tx.auditLog.findFirst({
          orderBy: { id: 'desc' },
          select: { hash: true },
        });
        const prevHash = last?.hash ?? GENESIS;
        const hash = sha256(prevHash + canonical);
        await tx.auditLog.create({
          data: {
            occurredAt,
            actorId: fields.actorId,
            actorEmail: fields.actorEmail,
            companyId: fields.companyId,
            action: fields.action,
            resourceType: fields.resourceType,
            resourceId: fields.resourceId,
            ipAddress: fields.ipAddress,
            userAgent: fields.userAgent,
            before: fields.before as any,
            after: fields.after as any,
            metadata: fields.metadata as any,
            outcome: fields.outcome,
            prevHash,
            hash,
          },
        });
      });
    } catch (err) {
      // Audit failures must be loud. We don't fail the request, but operators
      // need to know about it immediately.
      this.logger.error(`Audit write failed for action=${entry.action}: ${(err as Error).message}`);
    }
  }

  // Walk the chain and return the first id (if any) where hashes don't match.
  async verifyChain(limit = 10_000): Promise<{ ok: boolean; brokenAtId?: bigint }> {
    let prev = GENESIS;
    let scanned = 0;

    // We page through ascending id; if the table is huge, limit gives the
    // caller a knob to scan the latest N entries instead.
    const total = await this.prisma.auditLog.count();
    const skip = Math.max(0, total - limit);
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { id: 'asc' },
      skip,
      take: limit,
    });

    for (const row of rows) {
      if (scanned === 0 && skip > 0) {
        prev = row.prevHash; // start the verification from where we joined
      }
      const recomputed = sha256(
        prev +
          canonicalize({
            actorId: row.actorId,
            actorEmail: row.actorEmail,
            companyId: row.companyId,
            action: row.action,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            ipAddress: row.ipAddress,
            userAgent: row.userAgent,
            before: row.before,
            after: row.after,
            metadata: row.metadata,
            outcome: row.outcome,
            occurredAt: row.occurredAt.toISOString(),
          } satisfies AuditCanonicalFields),
      );
      if (recomputed !== row.hash || row.prevHash !== prev) {
        return { ok: false, brokenAtId: row.id };
      }
      prev = row.hash;
      scanned++;
    }
    return { ok: true };
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// Stable JSON encoding so the same logical payload always hashes to the same
// digest regardless of key order.
function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(null);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalize((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
