import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { DeviceStatus, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { DevicesService } from './devices.service';

class CreateDeviceDto {
  @Matches(/^[0-9]{14,16}$/, { message: 'IMEI must be 14–16 digits' })
  imei!: string;
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() simNumber?: string;
  @IsOptional() @IsString() plateNumber?: string;
  @IsOptional() @IsString() vin?: string;
  @IsOptional() @IsNumber() speedLimit?: number;
}

class UpdateDeviceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsEnum(DeviceStatus) status?: DeviceStatus;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() simNumber?: string;
  @IsOptional() @IsString() plateNumber?: string;
  @IsOptional() @IsString() vin?: string;
  @IsOptional() @IsNumber() speedLimit?: number;
  @IsOptional() @IsUUID() driverId?: string;
}

@Controller('devices')
@Roles(Role.VIEWER)
export class DevicesController {
  constructor(private readonly svc: DevicesService) {}

  @Get()
  @Audit('device.list')
  list(
    @Req() req: any,
    @Query('groupId') groupId?: string,
    @Query('status') status?: DeviceStatus,
    @Query('search') search?: string,
  ) {
    return this.svc.list(req.user, { groupId, status, search });
  }

  @Get(':id')
  @Audit('device.read', { resourceType: 'device', resourceIdParam: 'id' })
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, req.user);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('device.create', { resourceType: 'device', captureResult: true })
  create(@Body() dto: CreateDeviceDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('device.update', { resourceType: 'device', resourceIdParam: 'id', captureResult: true })
  update(@Param('id') id: string, @Body() dto: UpdateDeviceDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.COMPANY_ADMIN)
  @Audit('device.delete', { resourceType: 'device', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}
