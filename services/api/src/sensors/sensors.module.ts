import { Module, Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Role, SensorType, SensorValueKind } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Sensors translate raw protocol-level IO parameters (e.g. Teltonika
// AVL ID 239 for ignition, 66 for external voltage) into named values
// the rest of the system reasons about. Each company defines its own
// sensors on top of each device; the ingestor reads `sourceParam` and
// applies the linear calibration when storing a position.

class CreateSensorDto {
  @IsUUID() deviceId!: string;
  @IsString() @Length(1, 60) name!: string;
  @IsEnum(SensorType) type!: SensorType;
  @IsOptional() @IsEnum(SensorValueKind) valueKind?: SensorValueKind;
  @IsString() sourceParam!: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() multiplier?: number;
  @IsOptional() @IsNumber() offset?: number;
  @IsOptional() @IsArray() calibration?: Array<{ raw: number; real: number }>;
  @IsOptional() @IsBoolean() invert?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateSensorDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(SensorType) type?: SensorType;
  @IsOptional() @IsEnum(SensorValueKind) valueKind?: SensorValueKind;
  @IsOptional() @IsString() sourceParam?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() multiplier?: number;
  @IsOptional() @IsNumber() offset?: number;
  @IsOptional() @IsObject() calibration?: any;
  @IsOptional() @IsBoolean() invert?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
class SensorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: { role: Role; companyId: string | null }, deviceId?: string) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (deviceId) where.deviceId = deviceId;
    return this.prisma.sensor.findMany({ where, orderBy: { createdAt: 'asc' } });
  }

  async create(actor: { role: Role; companyId: string | null }, dto: CreateSensorDto) {
    const dev = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!dev) throw new NotFoundException('Device not found');
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.sensor.create({
      data: {
        companyId: dev.companyId,
        deviceId: dto.deviceId,
        name: dto.name,
        type: dto.type,
        valueKind: dto.valueKind ?? 'NUMBER',
        sourceParam: dto.sourceParam,
        unit: dto.unit ?? null,
        multiplier: dto.multiplier ?? 1.0,
        offset: dto.offset ?? 0.0,
        calibration: (dto.calibration ?? null) as any,
        invert: dto.invert ?? false,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateSensorDto) {
    const sensor = await this.prisma.sensor.findUnique({ where: { id } });
    if (!sensor) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && sensor.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.sensor.update({ where: { id }, data: dto as any });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const sensor = await this.prisma.sensor.findUnique({ where: { id } });
    if (!sensor) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && sensor.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.sensor.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('sensors')
@Roles(Role.VIEWER)
class SensorsController {
  constructor(private readonly svc: SensorsService) {}

  @Get()
  @Audit('sensor.list')
  list(@Req() req: any, @Query('deviceId') deviceId?: string) {
    return this.svc.list(req.user, deviceId);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('sensor.create', { resourceType: 'sensor', captureResult: true })
  create(@Body() dto: CreateSensorDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('sensor.update', { resourceType: 'sensor', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateSensorDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('sensor.delete', { resourceType: 'sensor', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}

@Module({
  controllers: [SensorsController],
  providers: [SensorsService],
})
export class SensorsModule {}
