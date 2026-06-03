import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from './integration-settings.service';

// SMS gateway adapter. Talks to one of two backends, switched via the
// `SMS_API_BASE` env var:
//
//   1. CallPro Text API v1 — https://api-text.callpro.mn/v1/sms (default).
//      POST JSON {from,to,text,brand?}, success envelope
//      { status: "queued", message_id }, error envelope { error } / { issues }.
//      Extra endpoints: GET /:unique_id (delivery events),
//      GET /tenant/daily?operator= (per-operator balance).
//
//   2. Legacy MessagePro — https://api.messagepro.mn/send.
//      GET with from/to/text query params, success envelope
//      [{ Result: "SUCCESS", "Message ID": ... }].
//      Kept as a fallback because not every CallPro tenant has been
//      migrated to the new gateway yet — when the new endpoint returns
//      "Tenant or special number not found" the operator can flip
//      `SMS_API_BASE=https://api.messagepro.mn` to keep working until
//      their tenant is provisioned.
//
// Auth is via the x-api-key header in both cases. SMS_API_KEY is resolved
// through IntegrationSettingsService — DB row first, then env — so it can
// be rotated from the System Health page without a redeploy.

const DEFAULT_API_BASE = 'https://api-text.callpro.mn/v1/sms';
const LEGACY_API_BASE = 'https://api.messagepro.mn';
const THROTTLE_MIN_GAP_MS = 250; // ~4 req/sec — conservative pacing for the gateway

type Operator = 'skytel' | 'mobicom' | 'unitel';
type GatewayMode = 'callpro' | 'messagepro';

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
  private apiBase = DEFAULT_API_BASE;
  private mode: GatewayMode = 'callpro';
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
    const baseOverride = this.config.get<string>('SMS_API_BASE');

    // Accept 'callpro' (new) and 'messagepro' (legacy alias) as the same
    // configured provider — the actual endpoint is chosen by SMS_API_BASE.
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

    // Endpoint choice — explicit SMS_API_BASE wins; otherwise we default to
    // the new CallPro Text API but honour SMS_PROVIDER=messagepro as a hint
    // to flip back to the legacy gateway.
    const base = (baseOverride && baseOverride.trim().length > 0)
      ? baseOverride.trim()
      : provider === 'messagepro' ? LEGACY_API_BASE : DEFAULT_API_BASE;
    this.apiBase = base.replace(/\/+$/, '');
    this.mode = /messagepro\.mn/i.test(this.apiBase) ? 'messagepro' : 'callpro';

    this.enabledFlag = true;
    this.logger.log(`SMS gateway=${this.mode} base=${this.apiBase} from=${this.from}${this.brand ? ` brand=${this.brand}` : ''}`);
  }

  enabled() {
    return this.enabledFlag;
  }

  describe(): string {
    return `${this.mode} ${this.from}`;
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

  // Looks up the delivery event history for a previously-sent message. Only
  // supported on the new CallPro Text API — the legacy MessagePro gateway has
  // no equivalent endpoint, so we surface that clearly rather than 404'ing.
  async getMessageStatus(messageId: string): Promise<unknown> {
    if (!this.enabledFlag) {
      throw new Error('SMS not configured');
    }
    if (this.mode !== 'callpro') {
      throw new Error('Хүргэлтийн төлөв шалгах нь зөвхөн CallPro Text API дээр ажиллана (SMS_API_BASE-г шалгана уу).');
    }
    const url = `${this.apiBase}/${encodeURIComponent(messageId)}`;
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

  // Operator-scoped daily counters: balance + current usage + cap. New CallPro
  // endpoint only — legacy MessagePro doesn't expose this.
  async getDailyBalance(operator: Operator): Promise<DailyBalance> {
    if (!this.enabledFlag) {
      throw new Error('SMS not configured');
    }
    if (this.mode !== 'callpro') {
      throw new Error('Өдрийн үлдэгдэл шалгах нь зөвхөн CallPro Text API дээр ажиллана (SMS_API_BASE-г шалгана уу).');
    }
    const url = `${this.apiBase}/tenant/daily?operator=${encodeURIComponent(operator)}`;
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

    let res: Response;
    let raw = '';
    try {
      res = this.mode === 'callpro'
        ? await this.callproSend(to, text)
        : await this.messageproSend(to, text);
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
      const hint = errorHint(res.status, this.mode);
      const msg = `SMS gateway ${res.status} буцаалаа: ${detail || '(хоосон)'}${hint}`;
      this.logger.warn(`SMS send failed to=${to} status=${res.status} body=${raw}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }

    // Success envelope shape depends on the gateway. parseSuccess returns the
    // message id or null if the body doesn't match either known shape; null
    // means "gateway returned 200 but didn't confirm queued" — treat as a
    // failure so we don't claim a send went through blindly.
    const parsed = parseSuccess(raw, this.mode);
    if (parsed == null) {
      const msg = `SMS gateway татгалзлаа: ${raw || '(хоосон)'}`;
      this.logger.warn(`SMS send rejected to=${to} body=${raw}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }
    return { to, messageId: parsed || undefined };
  }

  // New CallPro Text API: POST JSON.
  private async callproSend(to: string, text: string): Promise<Response> {
    const payload: Record<string, string | number> = { from: this.from, to, text };
    if (this.brand) payload.brand = this.brand;
    return fetch(`${this.apiBase}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(payload),
    });
  }

  // Legacy MessagePro: GET with query params.
  private async messageproSend(to: string, text: string): Promise<Response> {
    const url = `${this.apiBase}/send?from=${encodeURIComponent(this.from)}&to=${encodeURIComponent(to)}&text=${encodeURIComponent(text)}`;
    return fetch(url, { method: 'GET', headers: { 'x-api-key': this.apiKey } });
  }
}

// CallPro / MessagePro both expect an 8-digit Mongolian mobile number. Strip
// "+976", "976" prefixes and any non-digit characters. Returns undefined for
// inputs that can't be coerced into an 8-digit local number. The new gateway
// also supports international numbers (country code + number), but we keep
// the local-only constraint until that's an explicit product requirement.
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

// Tries to pull the human-readable field out of an error envelope.
//   CallPro: { error: "..." } / { issues: [...] }
//   MessagePro: usually plain text or a bare error string
function formatErrorBody(raw: string): string {
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    if (typeof j?.error === 'string') return j.error;
    if (Array.isArray(j?.issues)) return JSON.stringify(j.issues);
    if (typeof j?.reason === 'string') return j.reason;
    return raw;
  } catch {
    return raw;
  }
}

// Returns the message id on success, '' on success-without-id (still queued),
// or null when the body shape doesn't confirm queued/SUCCESS.
function parseSuccess(raw: string, mode: GatewayMode): string | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (mode === 'callpro') {
      if (j && j.status === 'queued') return typeof j.message_id === 'string' ? j.message_id : '';
      return null;
    }
    // MessagePro: [{ Result, "Message ID" }]
    const item = Array.isArray(j) ? j[0] : j;
    if (item?.Result === 'SUCCESS') {
      const id = item?.['Message ID'];
      return id != null ? String(id) : '';
    }
    return null;
  } catch {
    return null;
  }
}

function errorHint(status: number, mode: GatewayMode): string {
  switch (status) {
    case 401:
      return ' — x-api-key буруу эсвэл дутуу';
    case 402:
      return ' — данс/эрхийн үлдэгдэл хүрэлцэхгүй';
    case 403:
      return mode === 'callpro'
        ? ' — хүлээн авагч дугаар блоклогдсон'
        : ' — x-api-key буруу/блоклогдсон, эсвэл SMS_FROM дугаар зөвшөөрөгдөөгүй';
    case 404:
      return ' — tenant эсвэл дугаар олдсонгүй (SMS_API_BASE / SMS_FROM-г шалгана уу; шинэ CallPro endpoint-д tenant үүсээгүй бол SMS_API_BASE=https://api.messagepro.mn гэж буцааж тохируулна)';
    case 422:
      return ' — оруулсан утга validation-д унасан';
    default:
      return '';
  }
}
