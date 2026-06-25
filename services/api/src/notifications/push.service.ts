import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from './integration-settings.service';
import { httpPostJson, stripNonAscii, capMessage } from './channel-util';

// Mobile/web push channel. Provider-agnostic: it POSTs an FCM-compatible
// envelope ({ to, notification: { title, body } }) with an
// `Authorization: key=<server key>` header to a configurable endpoint
// (PUSH_ENDPOINT, default FCM). The server key is the integration secret
// `fcm_server_key`; recipients are device/registration tokens on the rule
// (recipientPush).
//
// Kept deliberately thin and config-driven: swapping FCM for OneSignal/Expo is
// an endpoint + key change, not a code change. (FCM HTTP v1's OAuth2 flow is a
// follow-up; this legacy-style key header covers the common gateways and is
// disabled-by-default until a key is set.)

const DEFAULT_ENDPOINT = 'https://fcm.googleapis.com/fcm/send';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private serverKey = '';
  private endpoint = DEFAULT_ENDPOINT;
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
    this.serverKey = '';
    this.endpoint = this.config.get<string>('PUSH_ENDPOINT') || DEFAULT_ENDPOINT;
    const raw = await this.integrations.resolve('fcm_server_key');
    if (!raw) {
      this.logger.warn('Push server key not set; push notifications disabled');
      return;
    }
    this.serverKey = stripNonAscii(raw);
    this.enabledFlag = this.serverKey.length > 0;
    if (this.enabledFlag) this.logger.log(`Push channel enabled (endpoint=${this.endpoint})`);
  }

  enabled() {
    return this.enabledFlag;
  }

  async send(tokens: string[], text: string, title = 'Fleex'): Promise<void> {
    if (!this.enabledFlag || tokens.length === 0) return;
    const body = capMessage(text);
    for (const token of tokens) {
      const to = token.trim();
      if (!to) continue;
      try {
        const res = await httpPostJson(
          this.endpoint,
          { authorization: `key=${this.serverKey}` },
          { to, notification: { title, body }, data: { message: body } },
        );
        if (!res.ok) {
          this.logger.warn(`Push send token=${mask(to)} status=${res.status} body=${res.body}`);
        }
      } catch (err) {
        this.logger.error(`Push send error token=${mask(to)}: ${(err as Error).message}`);
      }
    }
  }
}

// Push tokens are long opaque strings; don't log them whole.
function mask(token: string): string {
  return token.length <= 8 ? '***' : token.slice(0, 6) + '…' + token.slice(-4);
}
