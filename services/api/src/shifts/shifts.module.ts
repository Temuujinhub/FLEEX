import { Module } from '@nestjs/common';
import {
  Body, Controller, Delete, ForbiddenException, Get, Injectable,
  NotFoundException, Param, Patch, Post, Req, BadRequestException,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Ээлж / Shift. Working-hours definitions per tenant. Drivers carry a
// nullable shiftId; reports can filter by shift to compare day/night
// crew performance, and the dispatcher can colour-code chips so an
// operator scanning the kanban sees at a glance which crew is who.
//
// HH:mm is stored as a plain string for two reasons:
//   - SQL date types don't model a recurring time-of-day cleanly,
//   - the events-engine already parses HH:mm for geofence speed
//     schedules, so the helper code is reused.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class CreateShiftDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() description?: string;
  @Matches(HHMM, { message: 'startTime must be HH:mm' }) startTime!: string;
  @Matches(HHMM, { message: 'endTime must be HH:mm' }) endTime!: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsUUID() parentShiftId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateShiftDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Matches(HHMM, { message: 'startTime must be HH:mm' }) startTime?: string;
  @IsOptional() @Matches(HHMM, { message: 'endTime must be HH:mm' }) endTime?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsUUID() parentShiftId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: { role: Role; companyId: string | null }) {
    const where = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId };
    return this.prisma.shift.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { drivers: true, childShifts: true } },
      },
    });
  }

  async create(actor: { role: Role; companyId: string | null }, dto: CreateShiftDto) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (dto.parentShiftId) {
      const parent = await this.prisma.shift.findUnique({ where: { id: dto.parentShiftId } });
      if (!parent || (actor.role !== 'SUPER_ADMIN' && parent.companyId !== actor.companyId)) {
        throw new BadRequestException('Invalid parent shift');
      }
    }
    return this.prisma.shift.create({
      data: {
        companyId: actor.companyId!,
        name: dto.name,
        description: dto.description ?? null,
        startTime: dto.startTime,
        endTime: dto.endTime,
        color: dto.color ?? null,
        parentShiftId: dto.parentShiftId ?? null,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateShiftDto) {
    const s = await this.prisma.shift.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && s.companyId !== actor.companyId) throw new ForbiddenException();
    if (dto.parentShiftId && dto.parentShiftId === id) {
      throw new BadRequestException('Shift cannot be its own parent');
    }
    return this.prisma.shift.update({ where: { id }, data: dto });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const s = await this.prisma.shift.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && s.companyId !== actor.companyId) throw new ForbiddenException();
    // Drivers are detached via the SetNull FK; child shifts also detach
    // so we don't accidentally cascade-delete unrelated rows.
    await this.prisma.shift.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('shifts')
@Roles(Role.VIEWER)
class ShiftsController {
  constructor(private readonly svc: ShiftsService) {}

  @Get()
  @Audit('shift.list')
  list(@Req() req: any) {
    return this.svc.list(req.user);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('shift.create', { resourceType: 'shift', captureResult: true })
  create(@Body() dto: CreateShiftDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('shift.update', { resourceType: 'shift', resourceIdParam: 'id', captureResult: true })
  update(@Param('id') id: string, @Body() dto: UpdateShiftDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('shift.delete', { resourceType: 'shift', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService],
})
export class ShiftsModule {}
