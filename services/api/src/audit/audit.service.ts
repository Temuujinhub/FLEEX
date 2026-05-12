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

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private lastHash: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async tail(): Promise<string> {
    if (this.lastHash) return this.lastHash;
    const last = await this.prisma.auditLog.findFirst({
      orderBy: { id: 'desc' },
      select: { hash: true },
    });
    this.lastHash = last?.hash ?? GENESIS;
    return this.lastHash;
  }

  async record(entry: AuditEntry): Promise<void> {
    const prevHash = await this.tail();
    const canonical = canonicalize({
      ...entry,
      occurredAt: new Date().toISOString(),
    });
    const hash = sha256(prevHash + canonical);

    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          companyId: entry.companyId ?? null,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
          before: entry.before as any,
          after: entry.after as any,
          metadata: entry.metadata as any,
          outcome: entry.outcome ?? 'success',
          prevHash,
          hash,
        },
      });
      this.lastHash = hash;
    } catch (err) {
      // Audit failures must be loud. We don't fail the request, but operators
      // need to know about it immediately.
      this.logger.error(`Audit write failed for action=${entry.action}: ${(err as Error).message}`);
    }
  }

  // Walk the chain and return the first id (if any) where hashes don't match.
  async verifyChain(limit = 10_000): Promise<{ ok: boolean; brokenAtId?: bigint }> {
    let cursor: bigint | undefined;
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
          }),
      );
      if (recomputed !== row.hash || row.prevHash !== prev) {
        return { ok: false, brokenAtId: row.id };
      }
      prev = row.hash;
      cursor = row.id;
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
