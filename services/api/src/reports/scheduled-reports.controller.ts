import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Role, ReportCadence } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { ScheduledReportsService } from './scheduled-reports.service';

class CreateScheduledReportDto {
  @IsString() @Length(1, 120) name!: string;
  @IsString() templateId!: string;
  @IsUUID() deviceId!: string;
  @IsEnum(ReportCadence) cadence!: ReportCadence;
  @IsOptional() @IsIn(['excel', 'pdf']) format?: string;
  @IsArray() @ArrayNotEmpty() @IsEmail({}, { each: true }) recipients!: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateScheduledReportDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsEnum(ReportCadence) cadence?: ReportCadence;
  @IsOptional() @IsIn(['excel', 'pdf']) format?: string;
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) recipients?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

// Managing recurring emailed reports is a fleet-management action.
@Controller('reports/scheduled')
@Roles(Role.FLEET_MANAGER)
export class ScheduledReportsController {
  constructor(private readonly svc: ScheduledReportsService) {}

  @Get()
  @Audit('report.scheduled.list')
  list(@Req() req: any) {
    return this.svc.list(req.user);
  }

  @Post()
  @Audit('report.scheduled.create', { captureResult: true })
  create(@Body() dto: CreateScheduledReportDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Audit('report.scheduled.update', { resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateScheduledReportDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Audit('report.scheduled.delete', { resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }

  // Send one report immediately (test / backfill), independent of cadence.
  @Post(':id/run')
  @Audit('report.scheduled.run', { resourceIdParam: 'id' })
  run(@Param('id') id: string, @Req() req: any) {
    return this.svc.runNow(id, req.user);
  }
}
