import { Module, Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Length } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// `DeviceHealthRule` is the *definition* (offline > 30 min, voltage < 11.5V,
// etc.). `DeviceHealthStatus` is the *latest result* maintained by the
// events-engine. The dashboard donut groups devices by the `state` field
// here; the modal Health tab shows the matching diagnoses for one device.

const CHECK_KINDS = ['OFFLINE_GT', 'VOLTAGE_LT', 'GPS_FIX_LT', 'IGNITION_STALE'] as const;

class CreateRuleDto {
  @IsString() @Length(1, 80) name!: string;
  @IsIn(CHECK_KINDS as any) check!: string;
  @IsNumber() threshold!: number;
  @IsOptional() @IsIn(['WARNING', 'CRITICAL']) severity?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(CHECK_KINDS as any) check?: string;
  @IsOptional() @IsNumber() threshold?: number;
  @IsOptional() @IsIn(['WARNING', 'CRITICAL']) severity?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
class DeviceHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(actor: { role: Role; companyId: string | null }) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    return this.prisma.deviceHealthRule.findMany({ where, orderBy: { createdAt: 'asc' } });
  }

  async createRule(actor: { role: Role; companyId: string | null }, dto: CreateRuleDto) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.deviceHealthRule.create({
      data: {
        companyId: actor.companyId!,
        name: dto.name,
        check: dto.check,
        threshold: dto.threshold,
        severity: dto.severity ?? 'WARNING',
        active: dto.active ?? true,
      },
    });
  }

  async updateRule(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateRuleDto) {
    const rule = await this.prisma.deviceHealthRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && rule.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.deviceHealthRule.update({ where: { id }, data: dto as any });
  }

  async removeRule(id: string, actor: { role: Role; companyId: string | null }) {
    const rule = await this.prisma.deviceHealthRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && rule.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.deviceHealthRule.delete({ where: { id } });
    return { ok: true };
  }

  async listStatus(actor: { role: Role; companyId: string | null }) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.device = { companyId: actor.companyId };
    return this.prisma.deviceHealthStatus.findMany({
      where,
      include: { device: { select: { id: true, name: true, imei: true } } },
      orderBy: { evaluatedAt: 'desc' },
    });
  }

  async getDevice(deviceId: string, actor: { role: Role; companyId: string | null }) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.deviceHealthStatus.findUnique({ where: { deviceId } });
  }
}

@Controller('device-health')
@Roles(Role.VIEWER)
class DeviceHealthController {
  constructor(private readonly svc: DeviceHealthService) {}

  @Get('rules')
  @Audit('device-health.rules.list')
  listRules(@Req() req: any) {
    return this.svc.listRules(req.user);
  }

  @Post('rules')
  @Roles(Role.FLEET_MANAGER)
  @Audit('device-health.rules.create', { resourceType: 'health-rule', captureResult: true })
  createRule(@Body() dto: CreateRuleDto, @Req() req: any) {
    return this.svc.createRule(req.user, dto);
  }

  @Patch('rules/:id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('device-health.rules.update', { resourceType: 'health-rule', resourceIdParam: 'id' })
  updateRule(@Param('id') id: string, @Body() dto: UpdateRuleDto, @Req() req: any) {
    return this.svc.updateRule(id, req.user, dto);
  }

  @Delete('rules/:id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('device-health.rules.delete', { resourceType: 'health-rule', resourceIdParam: 'id' })
  removeRule(@Param('id') id: string, @Req() req: any) {
    return this.svc.removeRule(id, req.user);
  }

  @Get('status')
  @Audit('device-health.status.list')
  listStatus(@Req() req: any) {
    return this.svc.listStatus(req.user);
  }

  @Get('status/:deviceId')
  @Audit('device-health.status.read', { resourceType: 'device', resourceIdParam: 'deviceId' })
  getDevice(@Param('deviceId') deviceId: string, @Req() req: any) {
    return this.svc.getDevice(deviceId, req.user);
  }
}

@Module({
  controllers: [DeviceHealthController],
  providers: [DeviceHealthService],
})
export class DeviceHealthModule {}
