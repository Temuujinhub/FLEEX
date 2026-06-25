import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { WebhookService } from './webhook.service';
import { TelegramService } from './telegram.service';
import { PushService } from './push.service';
import { WhatsAppService } from './whatsapp.service';
import { ViberService } from './viber.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { IntegrationSettingsService } from './integration-settings.service';
import { LoneWorkerService } from './lone-worker.service';

// Wires the channel adapters (email / SMS / webhook / Telegram / push /
// WhatsApp / Viber) to the dispatcher that subscribes to `fleex.events` and
// routes events through the matching NotificationRule rows. PrismaService and
// RedisService come from the global CommonModule and PrismaModule wired in
// AppModule.
@Module({
  imports: [BillingModule],
  providers: [
    IntegrationSettingsService,
    EmailService,
    SmsService,
    WebhookService,
    TelegramService,
    PushService,
    WhatsAppService,
    ViberService,
    NotificationDispatcherService,
    LoneWorkerService,
  ],
  exports: [
    EmailService,
    SmsService,
    TelegramService,
    PushService,
    WhatsAppService,
    ViberService,
    IntegrationSettingsService,
  ],
})
export class NotificationsModule {}
