import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

// Layer over the `integration_settings` table that gives EmailService /
// SmsService a single place to fetch vendor secrets. Resolution order:
//   1. DB row keyed by `key` (editable from the System Health UI)
//   2. Equivalent process env var (the historical .env path)
//   3. undefined
//
// Why this exists: editing /opt/fleex/.env on the production host
// required SSH access the SUPER_ADMIN didn't have, so a Brevo HTTPS
// API rotation meant filing a deploy ticket. With this table the
// rotation is a form submission.

export type IntegrationKey = 'brevo_api_key' | 'sms_api_key';

// Maps each DB key to the env var that historically held the same
// secret. Keep this exhaustive — the UI iterates this list.
export const INTEGRATION_ENV: Record<IntegrationKey, string> = {
  brevo_api_key: 'BREVO_API_KEY',
  sms_api_key: 'SMS_API_KEY',
};

export interface IntegrationStatus {
  key: IntegrationKey;
  envVar: string;
  configured: boolean;
  source: 'db' | 'env' | 'none';
  masked: string;
  updatedAt: string | null;
}

@Injectable()
export class IntegrationSettingsService {
  private readonly logger = new Logger(IntegrationSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolve(key: IntegrationKey): Promise<string | undefined> {
    const row = await this.prisma.integrationSetting
      .findUnique({ where: { key } })
      .catch((err: Error) => {
        // First boot before `prisma db push` materialises the new
        // table — log once and degrade to env-only resolution rather
        // than crashing the dispatcher.
        this.logger.warn(`integration_settings lookup failed for ${key}: ${err.message}`);
        return null;
      });
    if (row?.value) return row.value;
    const fromEnv = this.config.get<string>(INTEGRATION_ENV[key]);
    return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
  }

  async set(key: IntegrationKey, value: string, userId?: string): Promise<void> {
    // Keep only printable ASCII: API keys are opaque ASCII tokens, and a paste
    // from a PDF/terminal can smuggle in whitespace, a BOM, or a stray glyph
    // (e.g. "←" U+2190) that later crashes the HTTP client when used as a header
    // (fetch: "Cannot convert argument to a ByteString"). Clean at write time so
    // a dirty paste can't be stored. Empty-after-clean clears the DB override.
    const clean = value.replace(/[^\x21-\x7E]/g, '');
    if (!clean) {
      await this.prisma.integrationSetting.delete({ where: { key } }).catch(() => undefined);
      return;
    }
    await this.prisma.integrationSetting.upsert({
      where: { key },
      create: { key, value: clean, updatedById: userId },
      update: { value: clean, updatedById: userId },
    });
  }

  async list(): Promise<IntegrationStatus[]> {
    const rows = await this.prisma.integrationSetting
      .findMany()
      .catch(() => [] as Awaited<ReturnType<typeof this.prisma.integrationSetting.findMany>>);
    const byKey = new Map(rows.map((r) => [r.key, r] as const));
    return (Object.keys(INTEGRATION_ENV) as IntegrationKey[]).map((key) => {
      const row = byKey.get(key);
      const envVar = INTEGRATION_ENV[key];
      const envVal = this.config.get<string>(envVar);
      let source: IntegrationStatus['source'] = 'none';
      let value: string | undefined;
      if (row?.value) {
        source = 'db';
        value = row.value;
      } else if (envVal && envVal.length > 0) {
        source = 'env';
        value = envVal;
      }
      return {
        key,
        envVar,
        configured: !!value,
        source,
        masked: value ? mask(value) : '',
        updatedAt: row?.updatedAt?.toISOString() ?? null,
      };
    });
  }
}

// Leaks just enough to confirm the right key is in place without
// exposing it. "********abcd" for a 20-char key, "****" for shorter.
function mask(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return '*'.repeat(value.length - 4) + value.slice(-4);
}
