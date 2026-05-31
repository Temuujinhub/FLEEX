import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from './integration-settings.service';

// MessagePro / CallPro SMS gateway. The vendor docs describe a single
// GET endpoint with from/to/text query params and an x-api-key header,
// rate-limited to 5 requests per second. We serialise sends through a
// tiny FIFO queue so a burst of events doesn't trip the 503 throttle
// response.
//
// SMS_API_KEY is resolved through IntegrationSettingsService — DB row
// first, then env — so it can be rotated from the System Health page.

const MESSAGEPRO_URL = 'https://api.messagepro.mn/send';
const THROTTLE_MIN_GAP_MS = 250; // 4 req/sec, well under the 5 req/sec cap

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private apiKey = '';
  private from = '';
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

    if (provider !== 'messagepro' || !apiKey || !from) {
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
    this.enabledFlag = true;
    this.logger.log(`SMS provider=messagepro from=${this.from}`);
  }

  enabled() {
    return this.enabledFlag;
  }

  async send(to: string[], text: string): Promise<void> {
    if (!this.enabledFlag || to.length === 0) return;
    // MessagePro caps text at 160 chars per their docs. Trim with an
    // ellipsis to surface truncation rather than silently dropping bytes.
    const body = text.length > 160 ? text.slice(0, 157) + '...' : text;
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
  async sendDirect(rawTo: string, text: string): Promise<{ to: string; messageId?: string }> {
    if (!this.enabledFlag) {
      throw new Error('SMS not configured');
    }
    const to = normaliseMsisdn(rawTo);
    if (!to) {
      throw new Error(`Дугаар буруу байна: "${rawTo}" — 8 оронтой Монгол дугаар оруулна уу (жнь 99XXXXXX)`);
    }
    const body = text.length > 160 ? text.slice(0, 157) + '...' : text;
    return this.sendOne(to, body, /* throwOnError */ true);
  }

  private async sendOne(to: string, text: string, throwOnError = false): Promise<{ to: string; messageId?: string }> {
    const gap = Date.now() - this.lastSendAt;
    if (gap < THROTTLE_MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, THROTTLE_MIN_GAP_MS - gap));
    }
    this.lastSendAt = Date.now();

    const url = `${MESSAGEPRO_URL}?from=${encodeURIComponent(this.from)}&to=${encodeURIComponent(to)}&text=${encodeURIComponent(text)}`;
    let res: Response;
    let raw = '';
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey },
      });
      raw = await res.text();
    } catch (err) {
      const msg = `SMS gateway-д холбогдож чадсангүй: ${(err as Error).message}`;
      this.logger.error(`SMS send error to=${to}: ${(err as Error).message}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }

    if (!res.ok) {
      // 402=insufficient balance, 403=bad/blocked x-api-key, 404=unknown — per
      // the MessagePro doc. Surface status + body so the cause is obvious.
      const msg = `SMS gateway ${res.status} буцаалаа: ${raw || '(хоосон)'}` +
        (res.status === 402 ? ' — данс/эрхийн үлдэгдэл хүрэлцэхгүй байж болзошгүй'
         : res.status === 403 ? ' — x-api-key буруу эсвэл блоклогдсон, эсвэл SMS_FROM дугаар зөвшөөрөгдөөгүй'
         : '');
      this.logger.warn(`SMS send failed to=${to} status=${res.status} body=${raw}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }

    // Success HTTP, but the gateway signals per-message result in the body:
    // [{ "Result": "SUCCESS", "Message ID": xxx }].
    let result: any = null;
    try {
      const json = JSON.parse(raw);
      result = Array.isArray(json) ? json[0] : json;
    } catch {
      // Non-JSON 200 — treat as failure so we don't claim success blindly.
      const msg = `SMS gateway JSON бус хариу буцаалаа: ${raw || '(хоосон)'}`;
      this.logger.warn(`SMS non-JSON 200 to=${to} body=${raw}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }

    if (result?.Result !== 'SUCCESS') {
      const msg = `SMS gateway татгалзлаа: ${JSON.stringify(result)}`;
      this.logger.warn(`SMS send rejected to=${to} body=${JSON.stringify(result)}`);
      if (throwOnError) throw new Error(msg);
      return { to };
    }
    return { to, messageId: result?.['Message ID'] != null ? String(result['Message ID']) : undefined };
  }
}

// MessagePro expects an 8-digit Mongolian mobile number. Strip "+976",
// "976" prefixes and any non-digit characters. Returns undefined for
// inputs that can't be coerced into an 8-digit local number.
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
