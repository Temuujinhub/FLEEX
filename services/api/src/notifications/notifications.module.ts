import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { WebhookService } from './webhook.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { IntegrationSettingsService } from './integration-settings.service';
import { LoneWorkerService } from './lone-worker.service';

// Wires the channel adapters (email/SMS/webhook) to the dispatcher that
// subscribes to `fleex.events` and routes events through the matching
// NotificationRule rows. PrismaService and RedisService come from the
// global CommonModule and PrismaModule wired in AppModule.
@Module({
  providers: [
    IntegrationSettingsService,
    EmailService,
    SmsService,
    WebhookService,
    NotificationDispatcherService,
    LoneWorkerService,
  ],
  exports: [EmailService, SmsService, IntegrationSettingsService],
})
export class NotificationsModule {}
