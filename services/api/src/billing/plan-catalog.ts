// Subscription plan catalogue. Lives in code (not the DB) so limits/features
// can be tuned without a migration — the DB only records which plan key a
// company is on (Subscription.planKey). Prices are operator-tunable placeholders
// (0 = "set by sales / contact"); the enforcement logic never depends on price.
//
// UNLIMITED (-1) means "no cap" for device/user counts.

export type PlanKey = 'trial' | 'basic' | 'pro' | 'enterprise';

export const UNLIMITED = -1;

export interface PlanDef {
  key: PlanKey;
  name: string; // Mongolian display name
  blurb: string;
  maxDevices: number; // -1 = unlimited
  maxUsers: number; // -1 = unlimited
  retentionDays: number; // position-history retention the tier promises
  reports: 'basic' | 'all'; // 'basic' = trip/events only; 'all' = full catalogue
  scheduledReports: boolean; // R1 scheduled/email reports
  channels: string[]; // allowed NotificationChannel values
  multiProtocol: boolean; // Queclink / API access
  pricePerDeviceMonth: number; // ₮, operator-tunable; 0 = contact sales / free
  billingPeriodDays: number; // length of one paid period (trial uses trial days)
  order: number;
}

const ALL_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WEBHOOK', 'TELEGRAM', 'PUSH', 'WHATSAPP', 'VIBER'];

export const PLAN_CATALOG: Record<PlanKey, PlanDef> = {
  trial: {
    key: 'trial', name: 'Туршилт', blurb: '14 хоног үнэгүй туршина',
    maxDevices: 3, maxUsers: 2, retentionDays: 7,
    reports: 'basic', scheduledReports: false, channels: ['IN_APP'],
    multiProtocol: false, pricePerDeviceMonth: 0, billingPeriodDays: 14, order: 0,
  },
  basic: {
    key: 'basic', name: 'Basic', blurb: 'Жижиг флот — үндсэн хяналт',
    maxDevices: 25, maxUsers: 10, retentionDays: 90,
    reports: 'basic', scheduledReports: false, channels: ['IN_APP', 'EMAIL', 'SMS'],
    multiProtocol: false, pricePerDeviceMonth: 0, billingPeriodDays: 30, order: 1,
  },
  pro: {
    key: 'pro', name: 'Pro', blurb: 'Бүх тайлан + бүх мэдэгдлийн суваг',
    maxDevices: 100, maxUsers: 50, retentionDays: 365,
    reports: 'all', scheduledReports: true, channels: ALL_CHANNELS,
    multiProtocol: false, pricePerDeviceMonth: 0, billingPeriodDays: 30, order: 2,
  },
  enterprise: {
    key: 'enterprise', name: 'Enterprise', blurb: 'Хязгааргүй + API/Queclink',
    maxDevices: UNLIMITED, maxUsers: UNLIMITED, retentionDays: 730,
    reports: 'all', scheduledReports: true, channels: ALL_CHANNELS,
    multiProtocol: true, pricePerDeviceMonth: 0, billingPeriodDays: 30, order: 3,
  },
};

export function isPlanKey(s: string): s is PlanKey {
  return Object.prototype.hasOwnProperty.call(PLAN_CATALOG, s);
}

// Resolve a plan, falling back to trial for an unknown/legacy key.
export function getPlan(key: string | null | undefined): PlanDef {
  return key && isPlanKey(key) ? PLAN_CATALOG[key] : PLAN_CATALOG.trial;
}

export function isUnlimited(n: number): boolean {
  return n < 0;
}

// True when `count` is allowed under `limit` (-1 = unlimited).
export function withinLimit(count: number, limit: number): boolean {
  return isUnlimited(limit) || count <= limit;
}
