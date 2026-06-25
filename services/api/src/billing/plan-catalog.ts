// Subscription plan catalogue — kept in sync with the public pricing on the
// landing page (services/web/src/pages/Landing.tsx PRICING). Lives in code (not
// the DB) so limits/prices can be tuned without a migration; the DB only stores
// which plan key a company is on. Pricing is a FLAT monthly fee per tier (not
// per-device); the device count determines which tier a company must be on and
// is the enforced limit. UNLIMITED (-1) = no cap.

export type PlanKey = 'starter' | 'business' | 'pro' | 'enterprise';

export const UNLIMITED = -1;

export interface PlanDef {
  key: PlanKey;
  name: string;
  deviceBand: string; // display, e.g. "1–10 машин"
  blurb: string;
  maxDevices: number; // -1 = unlimited
  maxUsers: number; // -1 = unlimited
  retentionDays: number;
  reports: 'basic' | 'all';
  scheduledReports: boolean;
  channels: string[]; // allowed NotificationChannel values
  monthlySmsQuota: number; // outbound SMS per calendar month (-1 = unlimited, 0 = none)
  multiProtocol: boolean; // CAN/OBD, Queclink/API
  monthlyPrice: number; // ₮ per month, flat per tier (0 = custom/contact)
  custom: boolean; // enterprise — price negotiated
  order: number;
}

const ALL_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WEBHOOK', 'TELEGRAM', 'PUSH', 'WHATSAPP', 'VIBER'];

export const PLAN_CATALOG: Record<PlanKey, PlanDef> = {
  starter: {
    key: 'starter', name: 'Starter', deviceBand: '1–10 машин',
    blurb: 'Жижиг флот — үндсэн хяналт',
    maxDevices: 10, maxUsers: 5, retentionDays: 180,
    reports: 'basic', scheduledReports: false, channels: ['IN_APP', 'EMAIL'],
    monthlySmsQuota: 0, // no SMS channel on starter
    multiProtocol: false, monthlyPrice: 200_000, custom: false, order: 0,
  },
  business: {
    key: 'business', name: 'Business', deviceBand: '11–50 машин',
    blurb: 'Бүх тайлан, AI оноо, API, RFID',
    maxDevices: 50, maxUsers: 20, retentionDays: 365,
    reports: 'all', scheduledReports: true, channels: ['IN_APP', 'EMAIL', 'SMS', 'TELEGRAM'],
    monthlySmsQuota: 1_000,
    multiProtocol: false, monthlyPrice: 800_000, custom: false, order: 1,
  },
  pro: {
    key: 'pro', name: 'Pro', deviceBand: '51–100 машин',
    blurb: 'CAN/OBD, алсын асаалт, видео, бүх суваг',
    maxDevices: 100, maxUsers: 50, retentionDays: 365,
    reports: 'all', scheduledReports: true, channels: ALL_CHANNELS,
    monthlySmsQuota: 5_000,
    multiProtocol: true, monthlyPrice: 1_500_000, custom: false, order: 2,
  },
  enterprise: {
    key: 'enterprise', name: 'Enterprise', deviceBand: '100+ машин',
    blurb: 'Хязгааргүй + on-premise/white-label/SLA',
    maxDevices: UNLIMITED, maxUsers: UNLIMITED, retentionDays: 730,
    reports: 'all', scheduledReports: true, channels: ALL_CHANNELS,
    monthlySmsQuota: UNLIMITED,
    multiProtocol: true, monthlyPrice: 0, custom: true, order: 3,
  },
};

export const PLAN_KEYS: PlanKey[] = ['starter', 'business', 'pro', 'enterprise'];

export function isPlanKey(s: string): s is PlanKey {
  return Object.prototype.hasOwnProperty.call(PLAN_CATALOG, s);
}

// Resolve a plan, falling back to starter for an unknown/legacy key.
export function getPlan(key: string | null | undefined): PlanDef {
  return key && isPlanKey(key) ? PLAN_CATALOG[key] : PLAN_CATALOG.starter;
}

export function isUnlimited(n: number): boolean {
  return n < 0;
}

export function withinLimit(count: number, limit: number): boolean {
  return isUnlimited(limit) || count <= limit;
}

// Smallest tier whose device cap fits `deviceCount` — used to suggest a plan.
export function suggestPlan(deviceCount: number): PlanDef {
  for (const k of PLAN_KEYS) {
    const p = PLAN_CATALOG[k];
    if (isUnlimited(p.maxDevices) || deviceCount <= p.maxDevices) return p;
  }
  return PLAN_CATALOG.enterprise;
}
