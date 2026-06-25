import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IntegrationSettingsService } from './integration-settings.service';
import { httpPostJson, stripNonAscii, capMessage } from './channel-util';

// Telegram Bot API channel. A tenant creates a bot via @BotFather, sets the
// token in System Health (integration key `telegram_bot_token`), and lists the
// target chat IDs on each NotificationRule (recipientTelegram). We then POST to
// https://api.telegram.org/bot<token>/sendMessage per chat.
//
// This is the most self-serve of the chat channels — no paid plan, no business
// verification — so it's the recommended Wialon-parity push path.

const API_BASE = 'https://api.telegram.org';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private token = '';
  private enabledFlag = false;

  constructor(private readonly integrations: IntegrationSettingsService) {}

  async onModuleInit() {
    await this.reload();
  }

  // Re-reads the bot token (DB row first, then env). Called at boot and after a
  // SUPER_ADMIN rotates the key from System Health.
  async reload() {
    this.enabledFlag = false;
    this.token = '';
    const raw = await this.integrations.resolve('telegram_bot_token');
    if (!raw) {
      this.logger.warn('Telegram bot token not set; Telegram notifications disabled');
      return;
    }
    this.token = stripNonAscii(raw);
    this.enabledFlag = this.token.length > 0;
    if (this.enabledFlag) this.logger.log('Telegram channel enabled');
  }

  enabled() {
    return this.enabledFlag;
  }

  // Sends `text` to each chat id. Per-recipient failures are logged and
  // swallowed so one bad chat id never blocks the rest of an alert fan-out.
  async send(chatIds: string[], text: string): Promise<void> {
    if (!this.enabledFlag || chatIds.length === 0) return;
    const body = capMessage(text);
    const url = `${API_BASE}/bot${this.token}/sendMessage`;
    for (const chatId of chatIds) {
      const id = chatId.trim();
      if (!id) continue;
      try {
        const res = await httpPostJson(url, {}, { chat_id: id, text: body, disable_web_page_preview: true });
        if (!res.ok) {
          this.logger.warn(`Telegram sendMessage chat=${id} status=${res.status} body=${res.body}`);
        }
      } catch (err) {
        this.logger.error(`Telegram send error chat=${id}: ${(err as Error).message}`);
      }
    }
  }
}
