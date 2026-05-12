import { Module } from '@nestjs/common';
import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException, NotFoundException, Injectable } from '@nestjs/common';

class CreateGroupDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() parentId?: string;
}

class UpdateGroupDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() parentId?: string;
}

@Injectable()
class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: { role: Role; companyId: string | null }) {
    const where = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId };
    return this.prisma.deviceGroup.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(actor: { role: Role; companyId: string | null }, dto: any) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const companyId = actor.companyId!;
    return this.prisma.deviceGroup.create({ data: { ...dto, companyId } });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: any) {
    const g = await this.prisma.deviceGroup.findUnique({ where: { id } });
    if (!g) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && g.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.deviceGroup.update({ where: { id }, data: dto });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const g = await this.prisma.deviceGroup.findUnique({ where: { id } });
    if (!g) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && g.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.deviceGroup.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('groups')
@Roles(Role.VIEWER)
class GroupsController {
  constructor(private readonly svc: GroupsService) {}

  @Get()
  @Audit('group.list')
  list(@Req() req: any) {
    return this.svc.list(req.user);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('group.create', { resourceType: 'group', captureResult: true })
  create(@Body() dto: CreateGroupDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('group.update', { resourceType: 'group', resourceIdParam: 'id', captureResult: true })
  update(@Param('id') id: string, @Body() dto: UpdateGroupDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.COMPANY_ADMIN)
  @Audit('group.delete', { resourceType: 'group', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}

@Module({
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
