import { Module, Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { CustomFieldType, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// User-defined extra fields on devices (later: drivers, garages, ...).
// Definitions live in `CustomField`; per-entity values in `CustomFieldValue`.
// The Devices modal renders a "Нэмэлт" tab that lists definitions with
// scope `device` and reads/writes the values transparently.

class CreateFieldDto {
  @IsOptional() @IsString() entity?: string; // defaults to "device"
  @IsString() @Length(1, 40) name!: string;
  @IsString() @Length(1, 80) label!: string;
  @IsEnum(CustomFieldType) type!: CustomFieldType;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() ordering?: number;
}

class UpdateFieldDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsEnum(CustomFieldType) type?: CustomFieldType;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() ordering?: number;
}

class SetValueDto {
  @IsUUID() fieldId!: string;
  @IsUUID() entityId!: string;
  @IsOptional() @IsString() value?: string;  // we serialise everything to string for storage simplicity
}

@Injectable()
class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: { role: Role; companyId: string | null }, entity?: string) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (entity) where.entity = entity;
    return this.prisma.customField.findMany({ where, orderBy: [{ ordering: 'asc' }, { createdAt: 'asc' }] });
  }

  async create(actor: { role: Role; companyId: string | null }, dto: CreateFieldDto) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.customField.create({
      data: {
        companyId: actor.companyId!,
        entity: dto.entity ?? 'device',
        name: dto.name,
        label: dto.label,
        type: dto.type,
        options: dto.options ?? [],
        required: dto.required ?? false,
        ordering: dto.ordering ?? 0,
      },
    });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateFieldDto) {
    const field = await this.prisma.customField.findUnique({ where: { id } });
    if (!field) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && field.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.customField.update({ where: { id }, data: dto as any });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const field = await this.prisma.customField.findUnique({ where: { id } });
    if (!field) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && field.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.customField.delete({ where: { id } });
    return { ok: true };
  }

  async getValues(entityId: string, actor: { role: Role; companyId: string | null }) {
    // Authorise indirectly through the device's company.
    const dev = await this.prisma.device.findUnique({ where: { id: entityId } });
    if (dev && actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.customFieldValue.findMany({ where: { entityId } });
  }

  async setValue(actor: { role: Role; companyId: string | null }, dto: SetValueDto) {
    const field = await this.prisma.customField.findUnique({ where: { id: dto.fieldId } });
    if (!field) throw new NotFoundException('Field not found');
    if (actor.role !== 'SUPER_ADMIN' && field.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.customFieldValue.upsert({
      where: { fieldId_entityId: { fieldId: dto.fieldId, entityId: dto.entityId } },
      create: { fieldId: dto.fieldId, entityId: dto.entityId, valueText: dto.value ?? null },
      update: { valueText: dto.value ?? null },
    });
  }
}

@Controller('custom-fields')
@Roles(Role.VIEWER)
class CustomFieldsController {
  constructor(private readonly svc: CustomFieldsService) {}

  @Get()
  @Audit('custom-field.list')
  list(@Req() req: any, @Query('entity') entity?: string) {
    return this.svc.list(req.user, entity);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('custom-field.create', { resourceType: 'custom-field', captureResult: true })
  create(@Body() dto: CreateFieldDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('custom-field.update', { resourceType: 'custom-field', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateFieldDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('custom-field.delete', { resourceType: 'custom-field', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }

  @Get('values/:entityId')
  @Audit('custom-field.values.read')
  getValues(@Param('entityId') entityId: string, @Req() req: any) {
    return this.svc.getValues(entityId, req.user);
  }

  @Post('values')
  @Roles(Role.FLEET_MANAGER)
  @Audit('custom-field.values.set')
  setValue(@Body() dto: SetValueDto, @Req() req: any) {
    return this.svc.setValue(req.user, dto);
  }
}

@Module({
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService],
})
export class CustomFieldsModule {}
