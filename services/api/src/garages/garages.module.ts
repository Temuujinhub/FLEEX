import { Module } from '@nestjs/common';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Гранж (physical parking depot) — one of two ways a mining fleet operator
// likes to slice their vehicle list. Department / алба нэгж lives on the
// existing DeviceGroup model.

class CreateGarageDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsString() notes?: string;
}

class UpdateGarageDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsString() notes?: string;
}

@Injectable()
class GaragesService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: { role: Role; companyId: string | null }) {
    const where = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId ?? undefined };
    return this.prisma.garage.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { devices: true } } },
    });
  }

  async create(actor: { role: Role; companyId: string | null }, dto: CreateGarageDto) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const companyId = actor.companyId!;
    return this.prisma.garage.create({ data: { ...dto, companyId } });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateGarageDto) {
    const g = await this.prisma.garage.findUnique({ where: { id } });
    if (!g) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && g.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.garage.update({ where: { id }, data: dto });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const g = await this.prisma.garage.findUnique({ where: { id } });
    if (!g) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && g.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.garage.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('garages')
@Roles(Role.VIEWER)
class GaragesController {
  constructor(private readonly svc: GaragesService) {}

  @Get()
  @Audit('garage.list')
  list(@Req() req: any) {
    return this.svc.list(req.user);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('garage.create', { resourceType: 'garage', captureResult: true })
  create(@Body() dto: CreateGarageDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('garage.update', { resourceType: 'garage', resourceIdParam: 'id', captureResult: true })
  update(@Param('id') id: string, @Body() dto: UpdateGarageDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.COMPANY_ADMIN)
  @Audit('garage.delete', { resourceType: 'garage', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}

@Module({
  controllers: [GaragesController],
  providers: [GaragesService],
})
export class GaragesModule {}
