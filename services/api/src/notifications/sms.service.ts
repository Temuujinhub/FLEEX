import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from './integration-settings.service';

// CallPro Text API gateway (api-text.callpro.mn/v1/sms). Three endpoints:
//   POST /send            → enqueue an SMS, returns { status, message_id }
//   GET  /:unique_id      → query delivery events for a previously-sent id
//   GET  /tenant/daily    → operator-scoped balance and today's usage
//
// Auth is via the x-api-key header. SMS_API_KEY is resolved through
// IntegrationSettingsService — DB row first, then env — so it can be
// rotated from the System Health page without a redeploy.
//
// The legacy api.messagepro.mn/send endpoint is retired; the new gateway
// accepts the same opaque x-api-key but returns a richer JSON envelope
// ({ status, message_id } on success, { error }/{ issues } on failure).

const TEXT_API_BASE = 'https://api-text.callpro.mn/v1/sms';
const THROTTLE_MIN_GAP_MS = 250; // ~4 req/sec — conservative pacing for the gateway

type Operator = 'skytel' | 'mobicom' | 'unitel';

interface DailyBalance {
  balance: number;
  current: number;
  total_message: number;
  status?: string;
}

interface SendResult {
  to: string;
  messageId?: string;
}

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private apiKey = '';
  private from = '';
  private brand = '';
  private enabledFlag = false;
  private lastSendAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: ConfigService,
    private readonly integrations: IntegrationSettingsService,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  // Reapplies config from DB+env. Invoked at boot and again after a
  // SUPER_ADMIN updates the integration row from the UI.
  async reload() {
    this.enabledFlag = false;
    this.apiKey = '';

    const provider = (this.config.get<string>('SMS_PROVIDER') ?? '').toLowerCase();
    const apiKey = await this.integrations.resolve('sms_api_key');
    const from = this.config.get<string>('SMS_FROM');
    const brand = this.config.get<string>('SMS_BRAND');

    // Accept both 'callpro' (new) and 'messagepro' (legacy alias) so existing
    // deployments don't need an env edit to migrate — same x-api-key works on
    // the new base URL.
    if (provider !== 'callpro' && provider !== 'messagepro') {
      this.logger.warn('SMS not configured; SMS notifications disabled');
      return;
    }
    if (!apiKey || !from) {
      this.logger.warn('SMS not configured; SMS notifications disabled');
      return;
    }
    // API keys / sender ids are opaque ASCII tokens. A copy-paste from a PDF or
    // terminal can smuggle in a stray non-ASCII char (e.g. "←" U+2190) or
    // whitespace, which makes fetch throw "Cannot convert argument to a
    // ByteString" when the value is set as the x-api-key header. Strip anything
    // outside printable ASCII and warn so the operator knows the stored key was
    // dirty (if the gateway then 403s, the key really is wrong → re-copy it).
    const cleanKey = stripNonAscii(apiKey);
    if (cleanKey !== apiKey) {
      this.logger.warn(
        `SMS_API_KEY contained ${apiKey.length - cleanKey.length} non-ASCII/whitespace char(s) — stripped. ` +
          'If sends now 403, re-copy the key as plain text (System Health → SMS key).',
      );
    }
    this.apiKey = cleanKey;
    this.from = stripNonAscii(from);
    this.brand = brand ? stripNonAscii(brand) : '';
    this.enabledFlag = true;
    this.logger.log(`SMS provider=callpro from=${this.from}${this.brand ? ` brand=${this.brand}` : ''}`);
  }

  enabled() {
    return this.enabledFlag;
  }

  async send(to: string[], text: string): Promise<void> {
    if (!this.enabledFlag || to.length === 0) return;
    const body = capForSegments(text);
    for (const raw of to) {
      const normalised = normaliseMsisdn(raw);
      if (!normalised) {
        this.logger.warn(`Skipping invalid phone: ${raw}`);
        continue;
      }
      // Batch path: swallow per-recipient failures (one bad number must not
      // stop the rest of an alert fanout) — they're logged in sendOne.
      this.chain = this.chain.then(() => this.sendOne(normalised, body).catch(() => undefined));
    }
    await this.chain;
  }

  // Test/diagnostic path: sends to exactly one number and THROWS with the real
  // gateway error (HTTP status + response body) so the System Health "test SMS"
  // button reports the actual failure instead of a false "delivered". The batch
  // send() above stays silent on purpose.
  async sendDirect(rawTo: string, text: string): Promise<SendResult> {
    if (!this.enabledFlag) {
      throw new Error('SMS not configured');
    }
    const to = normaliseMsisdn(rawTo);
    if (!to) {
      throw new Error(`Дугаар буруу байна: "${rawTo}" — 8 оронтой Монгол дугаар оруулна уу (жнь 99XXXXXX)`);
    }
    return this.sendOne(to, capForSegments(text), /* throwOnError */ true);
  }

  // Looks up the delivery event history for a previously-sent message. Returns
  // the raw response (uniqueId, messageCount, delivered, events[]) per the
  // gateway's /:unique_id endpoint. Throws on transport / 4xx / 5xx so callers
  // can surface the real failure cause.
  async getMessageStatus(messageId: string): Promise<unknown> {
    if (!this.enabledFlag) {
      throw new Error('SMS not configured');
    }
    const url = `${TEXT_API_BASE}/${encodeURIComponent(messageId)}`;
    const res = await fetch(url, { method: 'GET', headers: { 'x-api-key': this.apiKey } });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`SMS status ${res.status}: ${raw || '(хоосон)'}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`SMS gateway JSON бус хариу буцаалаа: ${raw || '(хоосон)'}`);
    }
  }

  // Operator-scoped daily counters: balance + current usage + cap. Used by the
  // System Health page to surface "we have N SMS left today on Mobicom".
  async getDailyBalance(operator: Operator): Promise<DailyBalance> {
    if (!this.enabledFlag) {
      throw new Error('SMS not configured');
    }
    const url = `${TEXT_API_BASE}/tenant/daily?operator=${encodeURIComponent(operator)}`;
    const res = await fetch(url, { method: 'GET', headers: { 'x-api-key': this.apiKey } });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`SMS tenant/daily ${res.status}: ${raw || '(хоосон)'}`);
    }
    try {
      return JSON.parse(raw) as DailyBalance;
    } catch {
      throw new Error(`SMS gateway JSON бус хариу буцаалаа: ${raw || '(хоосон)'}`);
    }
  }

  private async sendOne(to: string, text: string, throwOnError = false): Promise<SendResult> {
    const gap = Date.now() - this.lastSendAt;
    if (gap < THROTTLE_MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, THROTTLE_MIN_GAP_MS - gap));
    }
    this.lastSendAt = Date.now();

    const payload: Record<string, string | number> = { from: this.from, to, text };
    if (this.brand) payload.brand = this.brand;

    let res: Response;
    let raw = '';
    try {
      res = await fetch(`${TEXT_API_BASE}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
      });
      raw = await res.text();
    } catch (err) {
      const msg = `SMS gateway-д холбогдож чадсангүй: ${(err as Error).message}`;
      this.logger.error(`SMS send error to=${to}: ${(err as Error).message}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }

    if (!res.ok) {
      // 400 bad params · 401 auth · 402 unpaid · 403 blocked number ·
      // 404 tenant/number not found · 422 validation issues · 500 server.
      // Surface status + body so the cause is obvious from the System Health
      // test button without having to tail the server log.
      const detail = formatErrorBody(raw);
      const hint = errorHint(res.status);
      const msg = `SMS gateway ${res.status} буцаалаа: ${detail || '(хоосон)'}${hint}`;
      this.logger.warn(`SMS send failed to=${to} status=${res.status} body=${raw}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }

    // Success envelope: { status: "queued", message_id: "..." }. Anything that
    // isn't JSON, or that comes back without status=queued, is treated as a
    // failure so we never claim a send went through blindly.
    let result: { status?: string; message_id?: string } | null = null;
    try {
      result = JSON.parse(raw);
    } catch {
      const msg = `SMS gateway JSON бус хариу буцаалаа: ${raw || '(хоосон)'}`;
      this.logger.warn(`SMS non-JSON 200 to=${to} body=${raw}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }

    if (!result || result.status !== 'queued') {
      const msg = `SMS gateway татгалзлаа: ${JSON.stringify(result)}`;
      this.logger.warn(`SMS send rejected to=${to} body=${JSON.stringify(result)}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }
    return { to, messageId: result.message_id };
  }
}

// CallPro Text API expects an 8-digit Mongolian mobile number. Strip "+976",
// "976" prefixes and any non-digit characters. Returns undefined for inputs
// that can't be coerced into an 8-digit local number. The gateway also
// supports international numbers (country code + number), but we keep the
// local-only constraint until that's an explicit product requirement.
function normaliseMsisdn(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('976') ? digits.slice(3) : digits;
  return local.length === 8 ? local : undefined;
}

// Keep only printable ASCII (0x21–0x7E). API keys + sender ids are opaque
// ASCII tokens, so this safely removes whitespace, BOM, and stray non-ASCII
// glyphs (e.g. "←") that copy-paste can introduce and that would otherwise make
// fetch throw a ByteString error when used as an HTTP header.
function stripNonAscii(s: string): string {
  return s.replace(/[^\x21-\x7E]/g, '');
}

// The gateway splits long messages into segments (160 Latin / 70 Cyrillic per
// segment, per the v1 docs). Allow up to ~3 segments to fit a Google Maps link
// in a Cyrillic PANIC text, then ellipsis-truncate to keep one rogue caller
// from sending a 50-segment essay.
function capForSegments(text: string): string {
  const isCyrillic = /[Ѐ-ӿ]/.test(text);
  const max = isCyrillic ? 210 : 480;
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

// Tries to pull the human-readable field out of an error envelope. The gateway
// uses { error: "..." } for most failures and { issues: [...] } for 422
// validation responses.
function formatErrorBody(raw: string): string {
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    if (typeof j?.error === 'string') return j.error;
    if (Array.isArray(j?.issues)) return JSON.stringify(j.issues);
    return raw;
  } catch {
    return raw;
  }
}

function errorHint(status: number): string {
  switch (status) {
    case 401:
      return ' — x-api-key буруу эсвэл дутуу';
    case 402:
      return ' — данс/эрхийн үлдэгдэл хүрэлцэхгүй';
    case 403:
      return ' — хүлээн авагч дугаар блоклогдсон';
    case 404:
      return ' — tenant эсвэл дугаар олдсонгүй';
    case 422:
      return ' — оруулсан утга validation-д унасан';
    default:
      return '';
  }
}
