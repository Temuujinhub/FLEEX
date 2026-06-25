import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from './integration-settings.service';
import { httpPostJson, stripNonAscii, capMessage } from './channel-util';

// Viber public-account / bot channel (chatapi.viber.com). Auth is the
// X-Viber-Auth-Token header (integration key `viber_bot_token`). Recipients are
// subscriber receiver IDs on the rule (recipientViber) — a user must have
// subscribed to the public account first, which Viber requires.
//
// Config-driven and disabled until a token is set.

const API_URL = 'https://chatapi.viber.com/pa/send_message';

@Injectable()
export class ViberService implements OnModuleInit {
  private readonly logger = new Logger(ViberService.name);
  private token = '';
  private senderName = 'Fleex';
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
    this.senderName = this.config.get<string>('VIBER_SENDER_NAME') || 'Fleex';
    const raw = await this.integrations.resolve('viber_bot_token');
    if (!raw) {
      this.logger.warn('Viber bot token not set; Viber notifications disabled');
      return;
    }
    this.token = stripNonAscii(raw);
    this.enabledFlag = this.token.length > 0;
    if (this.enabledFlag) this.logger.log('Viber channel enabled');
  }

  enabled() {
    return this.enabledFlag;
  }

  async send(receivers: string[], text: string): Promise<void> {
    if (!this.enabledFlag || receivers.length === 0) return;
    const body = capMessage(text, 6000);
    for (const raw of receivers) {
      const receiver = raw.trim();
      if (!receiver) continue;
      try {
        const res = await httpPostJson(
          API_URL,
          { 'x-viber-auth-token': this.token },
          { receiver, type: 'text', sender: { name: this.senderName }, text: body },
        );
        // Viber returns HTTP 200 with { status: 0 } on success; a non-zero
        // status_message signals a delivery problem even on a 200.
        if (!res.ok) {
          this.logger.warn(`Viber send receiver=${receiver} status=${res.status} body=${res.body}`);
        }
      } catch (err) {
        this.logger.error(`Viber send error receiver=${receiver}: ${(err as Error).message}`);
      }
    }
  }
}
