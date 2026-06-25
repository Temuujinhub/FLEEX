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
import { ShiftsModule } from './shifts/shifts.module';
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
import { SupportTicketsModule } from './support-tickets/support-tickets.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { EcoModule } from './eco/eco.module';
import { GprsModule } from './gprs/gprs.module';
import { BillingModule } from './billing/billing.module';
import { MediaModule } from './media/media.module';
import { GeoModule } from './geo/geo.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PlanGuard } from './billing/plan.guard';
import { AuditInterceptor } from './audit/audit.interceptor';
import { TenantContextInterceptor } from './common/tenant-context.interceptor';
import { BootstrapService } from './common/bootstrap.service';
import { DemoSeedService } from './common/demo-seed.service';
import { TimescaleInitService } from './common/timescale-init.service';
import { assertStrongJwtSecret } from './auth/jwt-secret.util';

// Fail-fast environment validation at boot. Keeps misconfiguration (a weak or
// missing JWT secret, a missing DATABASE_URL) from surfacing later as
// confusing runtime 500s — the process refuses to start instead.
function validateEnv(env: Record<string, any>): Record<string, any> {
  assertStrongJwtSecret(env.JWT_SECRET as string | undefined);
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  return env;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
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
    ShiftsModule,
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
    SupportTicketsModule,
    CustomFieldsModule,
    EcoModule,
    GprsModule,
    BillingModule,
    MediaModule,
    GeoModule,
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
    // Plan feature-gate — runs after auth/roles populate req.user; no-op unless
    // the handler is annotated with @RequiresAllReports().
    { provide: APP_GUARD, useClass: PlanGuard },
    // Outermost interceptor: establish the tenant context for the whole
    // handler (and the Prisma guard) before anything else runs.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
