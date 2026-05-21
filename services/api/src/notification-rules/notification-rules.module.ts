import { Module, Controller, Get, Post, Patch, Delete, Body, Param, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUrl, IsUUID, Length, Matches } from 'class-validator';
import { EventType, NotificationChannel, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// User-defined "when X happens, notify Y" rules. Replaces the
// hard-coded notification logic in the events-engine. The engine reads
// the active rules on startup and refreshes them periodically (or on
// rule mutation; for now we just poll).

// E.164-ish: leading + and 8-15 digits. Mongolian numbers may also be
// entered as bare 8-digit locals, which the SMS service normalises.
const PHONE_RE = /^(\+?\d{8,15})$/;

class CreateRuleDto {
  @IsString() @Length(1, 80) name!: string;
  @IsEnum(EventType) triggerType!: EventType;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) deviceIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) groupIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) geofenceIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) placeIds?: string[];
  @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL']) minSeverity?: string;
  @IsOptional() @IsArray() @IsEnum(NotificationChannel, { each: true }) channels?: NotificationChannel[];
  @IsOptional() @IsArray() @IsEmail({}, { each: true, message: 'Each recipientEmails entry must be a valid email' }) recipientEmails?: string[];
  @IsOptional() @IsArray() @Matches(PHONE_RE, { each: true, message: 'Each recipientPhones entry must be 8–15 digits (optional + prefix)' }) recipientPhones?: string[];
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: 'webhookUrl must be http(s) URL' }) webhookUrl?: string;
  @IsOptional() @IsString() template?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(EventType) triggerType?: EventType;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) deviceIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) groupIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) geofenceIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) placeIds?: string[];
  @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL']) minSeverity?: string;
  @IsOptional() @IsArray() @IsEnum(NotificationChannel, { each: true }) channels?: NotificationChannel[];
  @IsOptional() @IsArray() @IsEmail({}, { each: true, message: 'Each recipientEmails entry must be a valid email' }) recipientEmails?: string[];
  @IsOptional() @IsArray() @Matches(PHONE_RE, { each: true, message: 'Each recipientPhones entry must be 8–15 digits (optional + prefix)' }) recipientPhones?: string[];
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: 'webhookUrl must be http(s) URL' }) webhookUrl?: string;
  @IsOptional() @IsString() template?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
class NotificationRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: { role: Role; companyId: string | null }) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    return this.prisma.notificationRule.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async create(actor: { role: Role; companyId: string | null }, dto: CreateRuleDto) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.notificationRule.create({
      data: {
        companyId: actor.companyId!,
        name: dto.name,
        triggerType: dto.triggerType,
        deviceIds: dto.deviceIds ?? [],
        groupIds: dto.groupIds ?? [],
        geofenceIds: dto.geofenceIds ?? [],
        placeIds: dto.placeIds ?? [],
        minSeverity: dto.minSeverity ?? 'INFO',
        channels: dto.channels ?? ['IN_APP'],
        recipientEmails: dto.recipientEmails ?? [],
        recipientPhones: dto.recipientPhones ?? [],
        webhookUrl: dto.webhookUrl ?? null,
        template: dto.template ?? '{DEVICE}: {TYPE} at {LOCATION} ({TIME})',
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateRuleDto) {
    const rule = await this.prisma.notificationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && rule.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.notificationRule.update({ where: { id }, data: dto as any });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const rule = await this.prisma.notificationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && rule.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.notificationRule.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('notification-rules')
@Roles(Role.VIEWER)
class NotificationRulesController {
  constructor(private readonly svc: NotificationRulesService) {}

  @Get()
  @Audit('notification-rule.list')
  list(@Req() req: any) {
    return this.svc.list(req.user);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('notification-rule.create', { resourceType: 'notification-rule', captureResult: true })
  create(@Body() dto: CreateRuleDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('notification-rule.update', { resourceType: 'notification-rule', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateRuleDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('notification-rule.delete', { resourceType: 'notification-rule', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}

@Module({
  controllers: [NotificationRulesController],
  providers: [NotificationRulesService],
})
export class NotificationRulesModule {}
