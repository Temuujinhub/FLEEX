import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role, Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getPlan, isPlanKey, isUnlimited, PLAN_CATALOG, type PlanDef } from './plan-catalog';

type Actor = { id?: string; role: Role; companyId: string | null };

const DAY_MS = 86_400_000;
const DUE_SOON_DAYS = 7; // warn this many days before the next payment is due
const NEAR_CAP_RATIO = 0.9; // warn at 90% of the device/user cap

export interface BillingWarning {
  level: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
}

// Per-company billing view: plan, lifecycle status, usage vs caps, days until
// the next payment, and any warnings the UI should surface.
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Reads ─────────────────────────────────────────────────────
  async summary(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN' && !actor.companyId) {
      throw new ForbiddenException('No company context');
    }
    // SUPER_ADMIN with no company context has no single subscription to show.
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

    // No subscription row → the company is "unmanaged" (grandfathered). We never
    // block unmanaged companies; the operator opts a company into billing by
    // assigning a plan.
    if (!sub) {
      return {
        managed: false,
        planKey: null as string | null,
        status: null as string | null,
        usage: { devices, users },
        warnings: [
          { level: 'info', code: 'unmanaged', message: 'Багц оноогоогүй байна — хязгаарлалт идэвхгүй.' },
        ] as BillingWarning[],
      };
    }

    const plan = getPlan(sub.planKey);
    const deviceLimit = this.effectiveDeviceLimit(sub, plan);
    const userLimit = plan.maxUsers;
    const now = new Date();
    const dueAt = sub.currentPeriodEnd ?? sub.trialEndsAt ?? null;
    const daysUntilDue = dueAt ? Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS) : null;

    return {
      managed: true,
      planKey: sub.planKey,
      planName: plan.name,
      status: sub.status,
      startedAt: sub.startedAt,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      daysUntilDue,
      plan: this.planView(plan, deviceLimit),
      usage: {
        devices, users,
        deviceLimit, userLimit,
        devicePct: pctOf(devices, deviceLimit),
        userPct: pctOf(users, userLimit),
      },
      warnings: this.warnings(sub, plan, deviceLimit, devices, users, daysUntilDue),
    };
  }

  listPlans() {
    return Object.values(PLAN_CATALOG)
      .sort((a, b) => a.order - b.order)
      .map((p) => this.planView(p, p.maxDevices));
  }

  private planView(p: PlanDef, deviceLimit: number) {
    return {
      key: p.key, name: p.name, blurb: p.blurb,
      maxDevices: deviceLimit, maxUsers: p.maxUsers, retentionDays: p.retentionDays,
      reports: p.reports, scheduledReports: p.scheduledReports, channels: p.channels,
      multiProtocol: p.multiProtocol, pricePerDeviceMonth: p.pricePerDeviceMonth,
      billingPeriodDays: p.billingPeriodDays,
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
      out.push({ level: 'critical', code: 'inactive', message: `Захиалга идэвхгүй (${sub.status}).` });
    } else if (sub.status === 'PAST_DUE') {
      out.push({ level: 'critical', code: 'past_due', message: 'Төлбөр хугацаа хэтэрсэн — багцаа сунгана уу.' });
    } else if (daysUntilDue != null && daysUntilDue <= DUE_SOON_DAYS) {
      out.push({
        level: 'warning', code: 'due_soon',
        message: sub.status === 'TRIAL'
          ? `Туршилт ${daysUntilDue <= 0 ? 'дууссан' : `${daysUntilDue} хоногийн дараа дуусна`}.`
          : `Дараагийн төлбөр ${daysUntilDue <= 0 ? 'өнөөдөр' : `${daysUntilDue} хоногийн дараа`} төлөгдөнө.`,
      });
    }
    if (!isUnlimited(deviceLimit)) {
      if (devices > deviceLimit) {
        out.push({ level: 'critical', code: 'device_over', message: `Машины тоо багцын хязгаараас (${deviceLimit}) хэтэрсэн (${devices}).` });
      } else if (devices >= deviceLimit * NEAR_CAP_RATIO) {
        out.push({ level: 'warning', code: 'device_near', message: `Машины тоо хязгаарт ойртсон (${devices}/${deviceLimit}).` });
      }
    }
    if (!isUnlimited(plan.maxUsers) && users > plan.maxUsers) {
      out.push({ level: 'warning', code: 'user_over', message: `Хэрэглэгчийн тоо хязгаараас (${plan.maxUsers}) хэтэрсэн (${users}).` });
    }
    return out;
  }

  // ── Enforcement ───────────────────────────────────────────────
  // Called from DevicesService.create. Unmanaged companies (no subscription)
  // are never blocked; a SUSPENDED/CANCELLED sub blocks new devices; otherwise
  // the device cap is enforced. PAST_DUE is a soft state (warned, not blocked)
  // so a billing lapse never strands live vehicles already on the system —
  // but it does stop the fleet from GROWING until paid.
  async assertCanAddDevice(companyId: string): Promise<void> {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } }).catch(() => null);
    if (!sub) return; // unmanaged → no cap
    if (sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') {
      throw new ForbiddenException('Захиалга идэвхгүй байна — шинэ төхөөрөмж нэмэх боломжгүй.');
    }
    const plan = getPlan(sub.planKey);
    const limit = this.effectiveDeviceLimit(sub, plan);
    if (isUnlimited(limit)) return;
    const count = await this.prisma.device.count({ where: { companyId } });
    if (count >= limit) {
      const verb = sub.status === 'PAST_DUE' ? 'төлбөрөө төлж ' : '';
      throw new ForbiddenException(
        `"${plan.name}" багцын машины хязгаарт (${limit}) хүрсэн. Илүү машин нэмэхийн тулд ${verb}багцаа ахиулна уу.`,
      );
    }
  }

  // ── Admin actions (SUPER_ADMIN) ───────────────────────────────
  async setPlan(actor: Actor, companyId: string, planKey: string, deviceLimitOverride?: number | null) {
    this.requireSuperAdmin(actor);
    if (!isPlanKey(planKey)) throw new BadRequestException(`Unknown plan: ${planKey}`);
    const plan = PLAN_CATALOG[planKey];
    const existing = await this.prisma.subscription.findUnique({ where: { companyId } });
    const now = new Date();
    // Activating a paid plan with no period yet → start one billing period.
    const periodEnd = existing?.currentPeriodEnd ?? new Date(now.getTime() + plan.billingPeriodDays * DAY_MS);
    const data = {
      planKey,
      status: existing?.status === 'PAST_DUE' || existing?.status === 'SUSPENDED' ? existing.status : ('ACTIVE' as const),
      currentPeriodEnd: periodEnd,
      deviceLimitOverride: deviceLimitOverride ?? null,
    };
    return this.prisma.subscription.upsert({
      where: { companyId },
      create: { companyId, ...data, startedAt: now },
      update: data,
    });
  }

  // Records a received payment and extends the paid period from the later of
  // (now, currentPeriodEnd), so paying early doesn't lose remaining days.
  async recordPayment(
    actor: Actor, companyId: string,
    body: { amount?: number; method?: string; reference?: string; planKey?: string; periods?: number },
  ) {
    this.requireSuperAdmin(actor);
    const existing = await this.prisma.subscription.findUnique({ where: { companyId } });
    const planKey = body.planKey && isPlanKey(body.planKey) ? body.planKey : existing?.planKey ?? 'basic';
    const plan = getPlan(planKey);
    const now = new Date();
    const periods = Math.max(1, Math.min(36, Math.floor(body.periods ?? 1)));
    const base = existing?.currentPeriodEnd && existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now;
    const periodEnd = new Date(base.getTime() + periods * plan.billingPeriodDays * DAY_MS);

    const [sub] = await this.prisma.$transaction([
      this.prisma.subscription.upsert({
        where: { companyId },
        create: { companyId, planKey, status: 'ACTIVE', startedAt: now, currentPeriodEnd: periodEnd },
        update: { planKey, status: 'ACTIVE', currentPeriodEnd: periodEnd },
      }),
      this.prisma.subscriptionPayment.create({
        data: {
          companyId, planKey,
          amount: body.amount ?? 0,
          periodStart: base, periodEnd,
          method: body.method ?? 'manual',
          reference: body.reference ?? null,
          recordedByUserId: actor.id ?? null,
        },
      }),
    ]);
    this.logger.log(`Payment recorded: company=${companyId} plan=${planKey} until=${periodEnd.toISOString()}`);
    return sub;
  }

  async payments(actor: Actor, companyId: string) {
    if (actor.role !== 'SUPER_ADMIN' && actor.companyId !== companyId) throw new ForbiddenException();
    return this.prisma.subscriptionPayment.findMany({
      where: { companyId }, orderBy: { createdAt: 'desc' }, take: 200,
    });
  }

  private requireSuperAdmin(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('SUPER_ADMIN only');
  }

  // ── Cron: lifecycle transitions ───────────────────────────────
  // Daily: move ACTIVE/TRIAL subscriptions whose period/trial has ended into
  // PAST_DUE so the UI nags and new-device adds get the past-due message.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async markPastDue() {
    const now = new Date();
    const res = await this.prisma.subscription.updateMany({
      where: {
        status: { in: ['ACTIVE', 'TRIAL'] },
        currentPeriodEnd: { not: null, lt: now },
      },
      data: { status: 'PAST_DUE' },
    });
    if (res.count > 0) this.logger.log(`Subscriptions moved to PAST_DUE: ${res.count}`);
    return res.count;
  }
}

function pctOf(count: number, limit: number): number | null {
  if (limit < 0) return null; // unlimited
  if (limit === 0) return 100;
  return Math.round((count / limit) * 100);
}
