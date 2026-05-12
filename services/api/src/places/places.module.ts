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
  Query,
  Req,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PlaceType, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Байршил / Places. Free-floating points of interest the dispatcher can
// drop on the map (depots, loading bays, refuel stations, weighbridges).
// Soft buffers (`radiusM`) are visualised as a circle but don't generate
// events — those still come from the `Geofence` model.

class CreatePlaceDto {
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsEnum(PlaceType) type?: PlaceType;
  @IsNumber() @Min(-90)  @Max(90)  latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsInt() @Min(0)   radiusM?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdatePlaceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(PlaceType) type?: PlaceType;
  @IsOptional() @IsNumber() @Min(-90)  @Max(90)  latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsInt() @Min(0)   radiusM?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
class PlacesService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: { role: Role; companyId: string | null }, opts: { type?: PlaceType; search?: string }) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.type) where.type = opts.type;
    if (opts.search) {
      where.OR = [
        { name:    { contains: opts.search, mode: 'insensitive' } },
        { address: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.place.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(actor: { role: Role; companyId: string | null }, dto: CreatePlaceDto) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const companyId = actor.companyId!;
    return this.prisma.place.create({ data: { ...dto, companyId } });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdatePlaceDto) {
    const p = await this.prisma.place.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && p.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.place.update({ where: { id }, data: dto });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const p = await this.prisma.place.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && p.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.place.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('places')
@Roles(Role.VIEWER)
class PlacesController {
  constructor(private readonly svc: PlacesService) {}

  @Get()
  @Audit('place.list')
  list(@Req() req: any, @Query('type') type?: PlaceType, @Query('search') search?: string) {
    return this.svc.list(req.user, { type, search });
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('place.create', { resourceType: 'place', captureResult: true })
  create(@Body() dto: CreatePlaceDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('place.update', { resourceType: 'place', resourceIdParam: 'id', captureResult: true })
  update(@Param('id') id: string, @Body() dto: UpdatePlaceDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('place.delete', { resourceType: 'place', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}

@Module({
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
