import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from './integration-settings.service';
import { httpPostJson, stripNonAscii, capMessage } from './channel-util';

// WhatsApp Cloud API channel (graph.facebook.com). Two secrets:
//   - whatsapp_token     → the permanent/system-user access token (Bearer)
//   - whatsapp_phone_id  → the sender phone-number ID
// Recipients are E.164 numbers on the rule (recipientWhatsapp). We POST a
// `type:text` message per recipient.
//
// Config-driven and disabled until both secrets are set: WhatsApp Business
// onboarding (verified number + token) is a tenant prerequisite, so this builds
// the correct request and stays dormant until those creds exist.

const GRAPH_BASE = 'https://graph.facebook.com';

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private token = '';
  private phoneId = '';
  private version = 'v18.0';
  private enabledFlag = false;

  constructor(
    private readonly config: ConfigService,
    private readonly integrations: IntegrationSettingsService,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  async reload() {
    this.enabledFlag = false;
    this.token = '';
    this.phoneId = '';
    this.version = this.config.get<string>('WHATSAPP_API_VERSION') || 'v18.0';
    const token = await this.integrations.resolve('whatsapp_token');
    const phoneId = await this.integrations.resolve('whatsapp_phone_id');
    if (!token || !phoneId) {
      this.logger.warn('WhatsApp token/phone-id not set; WhatsApp notifications disabled');
      return;
    }
    this.token = stripNonAscii(token);
    this.phoneId = stripNonAscii(phoneId);
    this.enabledFlag = this.token.length > 0 && this.phoneId.length > 0;
    if (this.enabledFlag) this.logger.log(`WhatsApp channel enabled (phoneId=${this.phoneId})`);
  }

  enabled() {
    return this.enabledFlag;
  }

  async send(recipients: string[], text: string): Promise<void> {
    if (!this.enabledFlag || recipients.length === 0) return;
    const body = capMessage(text, 4000); // WhatsApp text limit is 4096
    const url = `${GRAPH_BASE}/${this.version}/${this.phoneId}/messages`;
    for (const raw of recipients) {
      const to = raw.replace(/[^\d]/g, ''); // E.164 digits only
      if (!to) continue;
      try {
        const res = await httpPostJson(
          url,
          { authorization: `Bearer ${this.token}` },
          { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
        );
        if (!res.ok) {
          this.logger.warn(`WhatsApp send to=${to} status=${res.status} body=${res.body}`);
        }
      } catch (err) {
        this.logger.error(`WhatsApp send error to=${to}: ${(err as Error).message}`);
      }
    }
  }
}
