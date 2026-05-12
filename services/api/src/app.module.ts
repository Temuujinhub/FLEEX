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
import { PositionsModule } from './positions/positions.module';
import { EventsModule } from './events/events.module';
import { GeofencesModule } from './geofences/geofences.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';
import { WebsocketModule } from './websocket/websocket.module';
import { HealthModule } from './health/health.module';
import { CommandsModule } from './commands/commands.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AuditInterceptor } from './audit/audit.interceptor';
import { BootstrapService } from './common/bootstrap.service';

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
    PositionsModule,
    EventsModule,
    GeofencesModule,
    ReportsModule,
    CommandsModule,
    WebsocketModule,
    HealthModule,
  ],
  providers: [
    BootstrapService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
