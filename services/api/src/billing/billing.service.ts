import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role, Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getPlan, isPlanKey, isUnlimited, PLAN_CATALOG, suggestPlan, type PlanDef } from './plan-catalog';

type Actor = { id?: string; role: Role; companyId: string | null };

const DAY_MS = 86_400_000;
const DUE_SOON_DAYS = 10; // warn this many days before / into the grace window
const GRACE_DAYS = 15; // prepaid: after the period ends, warn for ~15 days, then suspend
const NEAR_CAP_RATIO = 0.9;
// Allowed invoice durations: 1–11 months, or 1/2/3 years.
const ALLOWED_MONTHS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 36]);

export interface BillingWarning {
  level: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Reads ─────────────────────────────────────────────────────
  async summary(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN' && !actor.companyId) {
      throw new ForbiddenException('No company context');
    }
    if (actor.role === 'SUPER_ADMIN' && !actor.companyId) {
      return { managed: false, superAdmin: true, plans: this.listPlans() };
    }
    return this.getForCompany(actor.companyId!);
  }

  async getForCompany(companyId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } }).catch(() => null);
    const [devices, users] = await Promise.all([
      this.prisma.device.count({ where: { companyId } }),
      this.prisma.user.count({ where: { companyId } }),
    ]);

    if (!sub) {
      return {
        managed: false,
        planKey: null as string | null,
        status: null as string | null,
        suggestedPlan: suggestPlan(devices).key,
        usage: { devices, users },
        warnings: [{ level: 'info', code: 'unmanaged', message: 'Багц оноогоогүй байна — хязгаарлалт идэвхгүй.' }] as BillingWarning[],
      };
    }

    const plan = getPlan(sub.planKey);
    const deviceLimit = this.effectiveDeviceLimit(sub, plan);
    const now = new Date();
    const dueAt = sub.currentPeriodEnd ?? sub.trialEndsAt ?? null;
    const daysUntilDue = dueAt ? Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS) : null;

    return {
      managed: true,
      planKey: sub.planKey,
      planName: plan.name,
      status: sub.status,
      startedAt: sub.startedAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      daysUntilDue,
      graceDays: GRACE_DAYS,
      plan: this.planView(plan, deviceLimit),
      usage: {
        devices, users, deviceLimit, userLimit: plan.maxUsers,
        devicePct: pctOf(devices, deviceLimit), userPct: pctOf(users, plan.maxUsers),
      },
      warnings: this.warnings(sub, plan, deviceLimit, devices, users, daysUntilDue),
    };
  }

  listPlans() {
    return Object.values(PLAN_CATALOG).sort((a, b) => a.order - b.order).map((p) => this.planView(p, p.maxDevices));
  }

  private planView(p: PlanDef, deviceLimit: number) {
    return {
      key: p.key, name: p.name, deviceBand: p.deviceBand, blurb: p.blurb,
      maxDevices: deviceLimit, maxUsers: p.maxUsers, retentionDays: p.retentionDays,
      reports: p.reports, scheduledReports: p.scheduledReports, channels: p.channels,
      multiProtocol: p.multiProtocol, monthlyPrice: p.monthlyPrice, custom: p.custom,
    };
  }

  private effectiveDeviceLimit(sub: Subscription, plan: PlanDef): number {
    if (sub.deviceLimitOverride != null && sub.deviceLimitOverride > 0) return sub.deviceLimitOverride;
    return plan.maxDevices;
  }

  private warnings(
    sub: Subscription, plan: PlanDef, deviceLimit: number,
    devices: number, users: number, daysUntilDue: number | null,
  ): BillingWarning[] {
    const out: BillingWarning[] = [];
    if (sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') {
      out.push({ level: 'critical', code: 'inactive', message: `Захиалга идэвхгүй (${sub.status}) — төлбөрөө төлж сэргээнэ үү.` });
    } else if (sub.status === 'PAST_DUE') {
      const left = daysUntilDue == null ? null : GRACE_DAYS + daysUntilDue; // daysUntilDue ≤ 0 here
      out.push({
        level: 'critical', code: 'past_due',
        message: left != null && left > 0
          ? `Төлбөр хугацаа хэтэрсэн — ${left} хоногийн дотор төлөхгүй бол үйлчилгээ хаагдана.`
          : 'Төлбөр хугацаа хэтэрсэн — багцаа сунгана уу.',
      });
    } else if (daysUntilDue != null && daysUntilDue <= DUE_SOON_DAYS) {
      out.push({
        level: 'warning', code: 'due_soon',
        message: `Дараагийн төлбөр ${daysUntilDue <= 0 ? 'өнөөдөр' : `${daysUntilDue} хоногийн дараа`} төлөгдөнө.`,
      });
    }
    if (!isUnlimited(deviceLimit)) {
      if (devices > deviceLimit) {
        out.push({ level: 'critical', code: 'device_over', message: `Машины тоо багцын хязгаараас (${deviceLimit}) хэтэрсэн (${devices}). Дээд багц руу шилжинэ үү.` });
      } else if (devices >= deviceLimit * NEAR_CAP_RATIO) {
        out.push({ level: 'warning', code: 'device_near', message: `Машины тоо хязгаарт ойртсон (${devices}/${deviceLimit}).` });
      }
    }
    if (!isUnlimited(plan.maxUsers) && users > plan.maxUsers) {
      out.push({ level: 'warning', code: 'user_over', message: `Хэрэглэгчийн тоо хязгаараас (${plan.maxUsers}) хэтэрсэн (${users}).` });
    }
    return out;
  }

  // ── Enforcement (device cap; never hard-blocks live tracking) ──
  async assertCanAddDevice(companyId: string): Promise<void> {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } }).catch(() => null);
    if (!sub) return; // unmanaged → no cap
    if (sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') {
      throw new ForbiddenException('Захиалга идэвхгүй байна — шинэ төхөөрөмж нэмэхийн өмнө төлбөрөө сэргээнэ үү.');
    }
    const plan = getPlan(sub.planKey);
    const limit = this.effectiveDeviceLimit(sub, plan);
    if (isUnlimited(limit)) return;
    const count = await this.prisma.device.count({ where: { companyId } });
    if (count >= limit) {
      throw new ForbiddenException(`"${plan.name}" багцын машины хязгаарт (${limit}) хүрсэн. Илүү машин нэмэхийн тулд багцаа ахиулна уу.`);
    }
  }

  // ── Plan assignment ───────────────────────────────────────────
  async setPlan(actor: Actor, companyId: string, planKey: string, deviceLimitOverride?: number | null) {
    this.requireSuperAdmin(actor);
    if (!isPlanKey(planKey)) throw new BadRequestException(`Unknown plan: ${planKey}`);
    const existing = await this.prisma.subscription.findUnique({ where: { companyId } });
    const now = new Date();
    const data = {
      planKey,
      status: existing?.status ?? ('TRIAL' as const),
      currentPeriodEnd: existing?.currentPeriodEnd ?? null,
      deviceLimitOverride: deviceLimitOverride ?? null,
    };
    return this.prisma.subscription.upsert({
      where: { companyId },
      create: { companyId, ...data, startedAt: now },
      update: { planKey, deviceLimitOverride: deviceLimitOverride ?? null },
    });
  }

  // ── Invoices (нэхэмжлэх) ──────────────────────────────────────
  // Issue an invoice for a plan + duration. Its number is the bank-transfer
  // memo the customer pays with. Does NOT change the live subscription — that
  // happens on markInvoicePaid.
  async createInvoice(
    actor: Actor, companyId: string,
    body: { planKey?: string; months: number; amount?: number; note?: string },
  ) {
    // Self-serve: a COMPANY_ADMIN may issue an invoice for their OWN company
    // (to renew/upgrade and get a number to pay by). SUPER_ADMIN may issue for
    // any company. Marking PAID stays SUPER_ADMIN (bank reconciliation).
    this.requireBillingAccess(actor, companyId);
    const isSuper = actor.role === 'SUPER_ADMIN';
    const months = Math.floor(body.months);
    if (!ALLOWED_MONTHS.has(months)) {
      throw new BadRequestException('Хугацаа 1–11 сар эсвэл 1/2/3 жил байх ёстой.');
    }
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new NotFoundException('Company not found');

    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    const deviceCount = await this.prisma.device.count({ where: { companyId } });
    const planKey = body.planKey && isPlanKey(body.planKey) ? body.planKey : sub?.planKey ?? suggestPlan(deviceCount).key;
    const plan = getPlan(planKey);

    // Enterprise is a negotiated/contact plan — only an admin can issue its
    // invoice (the price isn't in the catalogue). A self-serving COMPANY_ADMIN
    // is steered to talk to sales instead of generating a 0₮ invoice.
    if (plan.custom && !isSuper) {
      throw new BadRequestException('Enterprise багцыг борлуулалтын багтай тохиролцоно уу — нэхэмжлэхийг админ үүсгэнэ.');
    }

    const now = new Date();
    const periodStart = sub?.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
    const periodEnd = addMonths(periodStart, months);
    // Amount: an admin may override (custom price / discount); a self-serving
    // COMPANY_ADMIN always pays the catalogue price × months (override ignored).
    const amount = isSuper && body.amount != null && body.amount >= 0
      ? body.amount
      : plan.custom ? 0 : plan.monthlyPrice * months;

    const invoiceNumber = await this.nextInvoiceNumber(now);
    return this.prisma.invoice.create({
      data: {
        invoiceNumber, companyId, planKey, months, deviceCount, amount,
        status: 'SENT', periodStart, periodEnd,
        dueAt: new Date(now.getTime() + 7 * DAY_MS),
        note: body.note ?? null, createdByUserId: actor.id ?? null,
      },
    });
  }

  // Reconciled against the bank by invoiceNumber → mark paid, which extends the
  // subscription through the invoice's period and activates it.
  async markInvoicePaid(actor: Actor, invoiceId: string, body: { bankReference?: string }) {
    this.requireSuperAdmin(actor);
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'SENT') throw new BadRequestException(`Нэхэмжлэх аль хэдийн "${inv.status}" төлөвтэй.`);

    const now = new Date();
    const [, sub] = await this.prisma.$transaction([
      this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt: now, bankReference: body.bankReference ?? null },
      }),
      this.prisma.subscription.upsert({
        where: { companyId: inv.companyId },
        create: { companyId: inv.companyId, planKey: inv.planKey, status: 'ACTIVE', startedAt: now, currentPeriodEnd: inv.periodEnd },
        update: { planKey: inv.planKey, status: 'ACTIVE', currentPeriodEnd: inv.periodEnd },
      }),
      this.prisma.subscriptionPayment.create({
        data: {
          companyId: inv.companyId, planKey: inv.planKey, amount: inv.amount,
          periodStart: inv.periodStart, periodEnd: inv.periodEnd,
          method: 'bank', reference: inv.invoiceNumber, recordedByUserId: actor.id ?? null,
        },
      }),
    ]);
    this.logger.log(`Invoice ${inv.invoiceNumber} paid → company=${inv.companyId} until=${inv.periodEnd.toISOString()}`);
    return sub;
  }

  async cancelInvoice(actor: Actor, invoiceId: string) {
    this.requireSuperAdmin(actor);
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === 'PAID') throw new BadRequestException('Төлөгдсөн нэхэмжлэхийг цуцлах боломжгүй.');
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLED' } });
  }

  async listInvoices(actor: Actor, companyId: string) {
    if (actor.role !== 'SUPER_ADMIN' && actor.companyId !== companyId) throw new ForbiddenException();
    return this.prisma.invoice.findMany({ where: { companyId }, orderBy: { issuedAt: 'desc' }, take: 200 });
  }

  // FLX-YYMM-#### — monotonic within the month; retried on the unique clash.
  private async nextInvoiceNumber(now: Date): Promise<string> {
    const yymm = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const prefix = `FLX-${yymm}-`;
    const count = await this.prisma.invoice.count({ where: { invoiceNumber: { startsWith: prefix } } });
    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }

  async payments(actor: Actor, companyId: string) {
    if (actor.role !== 'SUPER_ADMIN' && actor.companyId !== companyId) throw new ForbiddenException();
    return this.prisma.subscriptionPayment.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  private requireSuperAdmin(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('SUPER_ADMIN only');
  }

  // SUPER_ADMIN may act on any company; a COMPANY_ADMIN only on their own.
  private requireBillingAccess(actor: Actor, companyId: string) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.role === 'COMPANY_ADMIN' && actor.companyId === companyId) return;
    throw new ForbiddenException('Энэ байгууллагын төлбөрийг удирдах эрхгүй байна.');
  }

  // ── Plan feature-gates (reports / notification channels) ──────
  // Resolve the plan a company is on, or null when it's UNMANAGED (no
  // subscription). Unmanaged tenants are grandfathered everywhere in billing —
  // no device cap, no warnings — so feature-gates treat null as "ungated" too,
  // and only start enforcing once an admin assigns (or the tenant self-serves
  // onto) a plan. Live tracking is never blocked regardless.
  private async planFor(companyId: string | null | undefined): Promise<PlanDef | null> {
    if (!companyId) return null;
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } }).catch(() => null);
    return sub ? getPlan(sub.planKey) : null;
  }

  // Notification channels this company's plan permits. The dispatcher intersects
  // a rule's configured channels with this set. Returns null for unmanaged
  // tenants → caller leaves the rule's channels untouched (no gating).
  async allowedChannels(companyId: string | null | undefined): Promise<string[] | null> {
    return (await this.planFor(companyId))?.channels ?? null;
  }

  // 'basic' vs 'all' — used to gate advanced report templates. null = unmanaged.
  async reportsTier(companyId: string | null | undefined): Promise<'basic' | 'all' | null> {
    return (await this.planFor(companyId))?.reports ?? null;
  }

  // Throw unless the actor's plan unlocks the full report suite. SUPER_ADMIN and
  // unmanaged tenants (null tier) are always allowed; only a managed `basic`
  // plan is blocked.
  async assertReportsAll(actor: Actor): Promise<void> {
    if (actor.role === 'SUPER_ADMIN') return;
    const tier = await this.reportsTier(actor.companyId);
    if (tier === 'basic') {
      throw new ForbiddenException('Энэ тайлан зөвхөн Business+ багцад нээлттэй. Багцаа ахиулна уу.');
    }
  }

  // ── Cron: lifecycle transitions ───────────────────────────────
  // Daily: ACTIVE/TRIAL whose period has ended → PAST_DUE (grace, warned, not
  // blocked from tracking); PAST_DUE past the grace window → SUSPENDED.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runLifecycle() {
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - GRACE_DAYS * DAY_MS);
    const [pastDue, suspended] = await this.prisma.$transaction([
      this.prisma.subscription.updateMany({
        where: { status: { in: ['ACTIVE', 'TRIAL'] }, currentPeriodEnd: { not: null, lt: now } },
        data: { status: 'PAST_DUE' },
      }),
      this.prisma.subscription.updateMany({
        where: { status: 'PAST_DUE', currentPeriodEnd: { not: null, lt: graceCutoff } },
        data: { status: 'SUSPENDED' },
      }),
    ]);
    if (pastDue.count || suspended.count) {
      this.logger.log(`Lifecycle: ${pastDue.count} → PAST_DUE, ${suspended.count} → SUSPENDED`);
    }
    return { pastDue: pastDue.count, suspended: suspended.count };
  }
}

function pctOf(count: number, limit: number): number | null {
  if (limit < 0) return null;
  if (limit === 0) return 100;
  return Math.round((count / limit) * 100);
}

// Add calendar months to a date (handles year rollover; clamps day overflow via
// the Date API's own normalisation).
function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}
