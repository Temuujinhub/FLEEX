import { Module, Controller, Get, Post, Patch, Delete, Body, Param, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsBoolean, IsEnum, IsNumber, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { GeofenceShape, Prisma, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateGeofenceDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(GeofenceShape) shape!: GeofenceShape;
  // For CIRCLE: { lat, lng, radiusM }. For POLYGON: { points: [[lng,lat],...] }.
  @IsObject() geometry!: Record<string, unknown>;
  @IsOptional() @IsNumber() speedLimit?: number;
  @IsOptional() @IsBoolean() alertOnEnter?: boolean;
  @IsOptional() @IsBoolean() alertOnExit?: boolean;
}

class UpdateGeofenceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() geometry?: Record<string, unknown>;
  @IsOptional() @IsNumber() speedLimit?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() alertOnEnter?: boolean;
  @IsOptional() @IsBoolean() alertOnExit?: boolean;
}

@Injectable()
class GeofencesService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: { role: Role; companyId: string | null }) {
    const where = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId };
    return this.prisma.geofence.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(actor: { id: string; role: Role; companyId: string | null }, dto: CreateGeofenceDto) {
    if (!actor.companyId) throw new ForbiddenException();
    this.validateGeometry(dto.shape, dto.geometry);
    // Prisma's `data` is a strict XOR of CreateInput vs UncheckedCreateInput.
    // We use foreign-key IDs (companyId, userId) so the unchecked form is the
    // right shape — annotate explicitly so TS picks the right union member.
    const data: Prisma.GeofenceUncheckedCreateInput = {
      name: dto.name,
      description: dto.description,
      shape: dto.shape,
      geometry: dto.geometry as Prisma.InputJsonValue,
      speedLimit: dto.speedLimit,
      alertOnEnter: dto.alertOnEnter ?? true,
      alertOnExit: dto.alertOnExit ?? true,
      companyId: actor.companyId,
      userId: actor.id,
    };
    return this.prisma.geofence.create({ data });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateGeofenceDto) {
    const g = await this.prisma.geofence.findUnique({ where: { id } });
    if (!g) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && g.companyId !== actor.companyId) throw new ForbiddenException();
    if (dto.geometry) this.validateGeometry(g.shape, dto.geometry);
    const data: Prisma.GeofenceUncheckedUpdateInput = {
      name: dto.name,
      description: dto.description,
      geometry: dto.geometry ? (dto.geometry as Prisma.InputJsonValue) : undefined,
      speedLimit: dto.speedLimit,
      active: dto.active,
      alertOnEnter: dto.alertOnEnter,
      alertOnExit: dto.alertOnExit,
    };
    return this.prisma.geofence.update({ where: { id }, data });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const g = await this.prisma.geofence.findUnique({ where: { id } });
    if (!g) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && g.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.geofence.delete({ where: { id } });
    return { ok: true };
  }

  private validateGeometry(shape: GeofenceShape, geom: Record<string, unknown>) {
    if (shape === 'CIRCLE') {
      const { lat, lng, radiusM } = geom as { lat: number; lng: number; radiusM: number };
      if (typeof lat !== 'number' || typeof lng !== 'number' || typeof radiusM !== 'number' || radiusM <= 0) {
        throw new Error('CIRCLE geometry requires {lat,lng,radiusM>0}');
      }
    } else {
      const points = (geom as { points: number[][] }).points;
      if (!Array.isArray(points) || points.length < 3) {
        throw new Error('POLYGON geometry requires at least 3 points');
      }
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') {
          throw new Error('Each point must be [lng,lat]');
        }
      }
    }
  }
}

@Controller('geofences')
@Roles(Role.VIEWER)
class GeofencesController {
  constructor(private readonly svc: GeofencesService) {}

  @Get()
  @Audit('geofence.list')
  list(@Req() req: any) {
    return this.svc.list(req.user);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('geofence.create', { resourceType: 'geofence', captureResult: true })
  create(@Body() dto: CreateGeofenceDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('geofence.update', { resourceType: 'geofence', resourceIdParam: 'id', captureResult: true })
  update(@Param('id') id: string, @Body() dto: UpdateGeofenceDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.COMPANY_ADMIN)
  @Audit('geofence.delete', { resourceType: 'geofence', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}

@Module({
  controllers: [GeofencesController],
  providers: [GeofencesService],
})
export class GeofencesModule {}
