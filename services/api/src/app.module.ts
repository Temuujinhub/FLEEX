import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { DevicesModule } from './devices/devices.module';
import { GroupsModule } from './groups/groups.module';
import { GaragesModule } from './garages/garages.module';
import { DriversModule } from './drivers/drivers.module';
import { PlacesModule } from './places/places.module';
import { ServiceTasksModule } from './service-tasks/service-tasks.module';
import { LandingModule } from './landing/landing.module';
import { PositionsModule } from './positions/positions.module';
import { EventsModule } from './events/events.module';
import { GeofencesModule } from './geofences/geofences.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';
import { WebsocketModule } from './websocket/websocket.module';
import { HealthModule } from './health/health.module';
import { CommandsModule } from './commands/commands.module';
import { SensorsModule } from './sensors/sensors.module';
import { MessagesModule } from './messages/messages.module';
import { TripsModule } from './trips/trips.module';
import { DeviceHealthModule } from './device-health/device-health.module';
import { NotificationRulesModule } from './notification-rules/notification-rules.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SystemAdminModule } from './system-admin/system-admin.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { EcoModule } from './eco/eco.module';
import { GprsModule } from './gprs/gprs.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AuditInterceptor } from './audit/audit.interceptor';
import { BootstrapService } from './common/bootstrap.service';
import { DemoSeedService } from './common/demo-seed.service';
import { TimescaleInitService } from './common/timescale-init.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 20 },
      { name: 'medium', ttl: 60_000, limit: 300 },
      { name: 'login', ttl: 60_000, limit: 10 },
    ]),
    PrismaModule,
    CommonModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    DevicesModule,
    GroupsModule,
    GaragesModule,
    DriversModule,
    PlacesModule,
    ServiceTasksModule,
    LandingModule,
    PositionsModule,
    EventsModule,
    GeofencesModule,
    ReportsModule,
    CommandsModule,
    SensorsModule,
    MessagesModule,
    TripsModule,
    DeviceHealthModule,
    NotificationRulesModule,
    NotificationsModule,
    SystemAdminModule,
    CustomFieldsModule,
    EcoModule,
    GprsModule,
    WebsocketModule,
    HealthModule,
  ],
  providers: [
    // Order matters: TimescaleInitService runs hypertable DDL during
    // onApplicationBootstrap before BootstrapService seeds the admin.
    TimescaleInitService,
    BootstrapService,
    DemoSeedService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
