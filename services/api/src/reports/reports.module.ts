import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ScorecardCronService } from './scorecard-cron.service';
import { ScheduledReportsController } from './scheduled-reports.controller';
import { ScheduledReportsService } from './scheduled-reports.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ReportsController, ScheduledReportsController],
  providers: [ReportsService, ScorecardCronService, ScheduledReportsService],
})
export class ReportsModule {}
