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
    this.apiKey = apiKey;
    this.from = from;
    this.enabledFlag = true;
    this.logger.log(`SMS provider=messagepro from=${from}`);
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
      this.chain = this.chain.then(() => this.sendOne(normalised, body));
    }
    await this.chain;
  }

  private async sendOne(to: string, text: string): Promise<void> {
    const gap = Date.now() - this.lastSendAt;
    if (gap < THROTTLE_MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, THROTTLE_MIN_GAP_MS - gap));
    }
    this.lastSendAt = Date.now();

    const url = `${MESSAGEPRO_URL}?from=${encodeURIComponent(this.from)}&to=${encodeURIComponent(to)}&text=${encodeURIComponent(text)}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey },
      });
      if (!res.ok) {
        this.logger.warn(`SMS send failed to=${to} status=${res.status}`);
        return;
      }
      const json: any = await res.json().catch(() => null);
      const result = Array.isArray(json) ? json[0] : json;
      if (result?.Result !== 'SUCCESS') {
        this.logger.warn(`SMS send rejected to=${to} body=${JSON.stringify(result)}`);
      }
    } catch (err) {
      this.logger.error(`SMS send error to=${to}: ${(err as Error).message}`);
    }
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
