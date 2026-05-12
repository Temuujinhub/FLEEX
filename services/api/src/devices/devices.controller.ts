import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { DeviceStatus, FuelType, Role, VehicleType } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { DevicesService } from './devices.service';

// CreateDeviceDto carries the full vehicle profile the UI's 4-tab "Add
// vehicle" modal needs. Most fields are optional so legacy callers (e.g.
// the bare IMEI+name minimum) still work.
class CreateDeviceDto {
  @Matches(/^[0-9]{14,16}$/, { message: 'IMEI must be 14–16 digits' })
  imei!: string;
  @IsString() @Length(2, 80) name!: string;

  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsUUID() garageId?: string;

  // Basic identity
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() simNumber?: string;
  @IsOptional() @IsString() plateNumber?: string;
  @IsOptional() @IsString() vin?: string;
  @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
  @IsOptional() @IsString() vehicleSubtype?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() iconKey?: string;

  // Physical specs
  @IsOptional() @IsInt() @Min(0) chassisLengthMm?: number;
  @IsOptional() @IsInt() @Min(0) chassisWidthMm?: number;
  @IsOptional() @IsInt() @Min(0) chassisHeightMm?: number;
  @IsOptional() @IsInt() @Min(0) payloadKg?: number;
  @IsOptional() @IsInt() @Min(0) grossWeightKg?: number;
  @IsOptional() @IsInt() @Min(0) seatCount?: number;
  @IsOptional() @IsInt() @Min(0) axleCount?: number;
  @IsOptional() @IsString() wheelSize?: string;
  @IsOptional() @IsInt() @Min(0) wheelCount?: number;
  @IsOptional() @IsString() trailerPlate?: string;

  // Fuel
  @IsOptional() @IsEnum(FuelType) fuelType?: FuelType;
  @IsOptional() @IsString() fuelGrade?: string;
  @IsOptional() @IsNumber() tankCapacityL?: number;
  @IsOptional() @IsNumber() fuelConsumptionL100Km?: number;

  // Insurance
  @IsOptional() @IsString() insuranceContract1?: string;
  @IsOptional() @IsDateString() insuranceUntil1?: string;
  @IsOptional() @IsString() insuranceContract2?: string;
  @IsOptional() @IsDateString() insuranceUntil2?: string;

  // Misc
  @IsOptional() @IsNumber() speedLimit?: number;
}

class UpdateDeviceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsUUID() garageId?: string;
  @IsOptional() @IsEnum(DeviceStatus) status?: DeviceStatus;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() simNumber?: string;
  @IsOptional() @IsString() plateNumber?: string;
  @IsOptional() @IsString() vin?: string;
  @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
  @IsOptional() @IsString() vehicleSubtype?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() iconKey?: string;
  @IsOptional() @IsInt() @Min(0) chassisLengthMm?: number;
  @IsOptional() @IsInt() @Min(0) chassisWidthMm?: number;
  @IsOptional() @IsInt() @Min(0) chassisHeightMm?: number;
  @IsOptional() @IsInt() @Min(0) payloadKg?: number;
  @IsOptional() @IsInt() @Min(0) grossWeightKg?: number;
  @IsOptional() @IsInt() @Min(0) seatCount?: number;
  @IsOptional() @IsInt() @Min(0) axleCount?: number;
  @IsOptional() @IsString() wheelSize?: string;
  @IsOptional() @IsInt() @Min(0) wheelCount?: number;
  @IsOptional() @IsString() trailerPlate?: string;
  @IsOptional() @IsEnum(FuelType) fuelType?: FuelType;
  @IsOptional() @IsString() fuelGrade?: string;
  @IsOptional() @IsNumber() tankCapacityL?: number;
  @IsOptional() @IsNumber() fuelConsumptionL100Km?: number;
  @IsOptional() @IsString() insuranceContract1?: string;
  @IsOptional() @IsDateString() insuranceUntil1?: string;
  @IsOptional() @IsString() insuranceContract2?: string;
  @IsOptional() @IsDateString() insuranceUntil2?: string;
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
    @Query('garageId') garageId?: string,
    @Query('vehicleType') vehicleType?: VehicleType,
    @Query('status') status?: DeviceStatus,
    @Query('search') search?: string,
  ) {
    return this.svc.list(req.user, { groupId, garageId, vehicleType, status, search });
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
