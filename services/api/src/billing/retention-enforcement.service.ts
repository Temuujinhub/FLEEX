import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { getPlan } from './plan-catalog';

// Per-plan data retention. Each plan keeps position history for plan.retentionDays
// (starter 180 · business/pro 365 · enterprise 730). A daily job trims a managed
// tenant's positions older than that window.
//
// SAFETY — this DELETES customer GPS history, so it is DRY-RUN BY DEFAULT:
//   RETENTION_ENFORCE unset|"dry"  → only counts + logs what WOULD be deleted.
//   RETENTION_ENFORCE "on"|"true"  → actually deletes (batched, capped).
// Unmanaged tenants are never trimmed (the global TimescaleDB retention policy
// still applies). A hard floor (RETENTION_FLOOR_DAYS, default 30) prevents a
// misconfigured plan from wiping recent data. Enabling deletion (and raising the
// global Timescale policy to 730d so enterprise is honoured) is the "infra
// ready" step — backups/disk must be confirmed first.

const DAY_MS = 86_400_000;
const DEFAULT_FLOOR_DAYS = 30;
const DELETE_BATCH = 10_000; // rows per DELETE
const MAX_ROWS_PER_COMPANY_RUN = 500_000; // backstop so one run can't churn forever

interface TenantTrim { companyId: string; planKey: string; retentionDays: number; cutoff: Date; rows: number; deleted: number }

@Injectable()
export class RetentionEnforcementService {
  private readonly logger = new Logger(RetentionEnforcementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private enforcing(): boolean {
    const v = (this.config.get<string>('RETENTION_ENFORCE') ?? '').toLowerCase();
    return v === 'on' || v === 'true' || v === '1' || v === 'enforce';
  }

  private floorDays(): number {
    const n = Number(this.config.get('RETENTION_FLOOR_DAYS'));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_FLOOR_DAYS;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDaily() {
    const enforce = this.enforcing();
    const report = await this.scan(enforce);
    const overdue = report.filter((r) => r.rows > 0);
    if (overdue.length === 0) {
      this.logger.log(`Retention scan: nothing beyond window (${enforce ? 'enforcing' : 'dry-run'})`);
      return report;
    }
    const totalRows = overdue.reduce((s, r) => s + r.rows, 0);
    const totalDel = overdue.reduce((s, r) => s + r.deleted, 0);
    this.logger.log(
      `Retention ${enforce ? 'enforce' : 'DRY-RUN'}: ${overdue.length} tenant(s), ` +
        `${totalRows} row(s) beyond window${enforce ? `, ${totalDel} deleted` : ' (none deleted — set RETENTION_ENFORCE=on)'}`,
    );
    return report;
  }

  // SUPER_ADMIN on-demand preview — always read-only (never deletes), so an
  // admin can gauge impact before enabling enforcement.
  async preview(): Promise<{ enforcing: boolean; floorDays: number; tenants: TenantTrim[] }> {
    return { enforcing: this.enforcing(), floorDays: this.floorDays(), tenants: await this.scan(false) };
  }

  // Walk managed tenants, count (and optionally delete) positions older than the
  // plan window. floor-clamped.
  private async scan(enforce: boolean): Promise<TenantTrim[]> {
    const subs = await this.prisma.subscription.findMany({ select: { companyId: true, planKey: true } }).catch(() => []);
    const floor = this.floorDays();
    const out: TenantTrim[] = [];
    for (const sub of subs) {
      const retentionDays = Math.max(getPlan(sub.planKey).retentionDays, floor);
      const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
      const rows = await this.countOlder(sub.companyId, cutoff);
      let deleted = 0;
      if (enforce && rows > 0) deleted = await this.deleteOlder(sub.companyId, cutoff);
      out.push({ companyId: sub.companyId, planKey: sub.planKey, retentionDays, cutoff, rows, deleted });
    }
    return out;
  }

  private async countOlder(companyId: string, cutoff: Date): Promise<number> {
    try {
      const r = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM positions WHERE company_id = ${companyId}::uuid AND time < ${cutoff}`;
      return Number(r[0]?.count ?? 0);
    } catch (err) {
      this.logger.warn(`countOlder(${companyId}): ${(err as Error).message}`);
      return 0;
    }
  }

  // Batched delete via ctid so each statement is bounded; stops at the per-run
  // cap. Returns rows removed.
  private async deleteOlder(companyId: string, cutoff: Date): Promise<number> {
    let total = 0;
    try {
      while (total < MAX_ROWS_PER_COMPANY_RUN) {
        const n = await this.prisma.$executeRaw`
          DELETE FROM positions WHERE ctid IN (
            SELECT ctid FROM positions WHERE company_id = ${companyId}::uuid AND time < ${cutoff} LIMIT ${DELETE_BATCH}
          )`;
        total += n;
        if (n < DELETE_BATCH) break; // drained
      }
      if (total > 0) this.logger.log(`Retention: company=${companyId} deleted ${total} position(s) older than ${cutoff.toISOString()}`);
    } catch (err) {
      this.logger.error(`deleteOlder(${companyId}): ${(err as Error).message}`);
    }
    return total;
  }
}
