import { Module } from '@nestjs/common';
import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { Role, ServiceTaskKind, ServiceTaskStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Service tasks (Засвар үйлчилгээ). Each task is tied to one device and
// carries either a date/odometer/engine-hours schedule, completion data,
// and optional photo attachments stored as Postgres bytea blobs.

class CreateServiceTaskDto {
  @IsUUID() deviceId!: string;
  @IsString() @Length(2, 200) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(ServiceTaskKind) kind?: ServiceTaskKind;
  @IsOptional() @IsEnum(ServiceTaskStatus) status?: ServiceTaskStatus;
  @IsOptional() @IsNumber() cost?: number;
  @IsOptional() @IsBoolean() unplanned?: boolean;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsNumber() scheduledOdometerKm?: number;
  @IsOptional() @IsNumber() scheduledEngineHours?: number;
  @IsOptional() @IsInt() @Min(0) reminderDays?: number;
  @IsOptional() @IsDateString() completedAt?: string;
  @IsOptional() @IsNumber() completedOdometerKm?: number;
  @IsOptional() @IsNumber() completedEngineHours?: number;
  @IsOptional() @IsString() completionNotes?: string;
  @IsOptional() @IsString() performedBy?: string;
}

class UpdateServiceTaskDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(ServiceTaskKind) kind?: ServiceTaskKind;
  @IsOptional() @IsEnum(ServiceTaskStatus) status?: ServiceTaskStatus;
  @IsOptional() @IsNumber() cost?: number;
  @IsOptional() @IsBoolean() unplanned?: boolean;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsNumber() scheduledOdometerKm?: number;
  @IsOptional() @IsNumber() scheduledEngineHours?: number;
  @IsOptional() @IsInt() @Min(0) reminderDays?: number;
  @IsOptional() @IsDateString() completedAt?: string;
  @IsOptional() @IsNumber() completedOdometerKm?: number;
  @IsOptional() @IsNumber() completedEngineHours?: number;
  @IsOptional() @IsString() completionNotes?: string;
  @IsOptional() @IsString() performedBy?: string;
}

@Injectable()
class ServiceTasksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: { role: Role; companyId: string | null }, opts: {
    deviceId?: string;
    status?: ServiceTaskStatus;
    upcoming?: boolean;
  }) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.deviceId) where.deviceId = opts.deviceId;
    if (opts.status) where.status = opts.status;
    if (opts.upcoming) {
      where.status = { in: ['PLANNED', 'IN_PROGRESS', 'OVERDUE'] };
    }
    const rows = await this.prisma.serviceTask.findMany({
      where,
      orderBy: [{ status: 'asc' }, { scheduledAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        device:      { select: { id: true, name: true, plateNumber: true, odometerKm: true, engineHours: true } },
        attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
      },
    });
    return rows.map((r) => ({
      ...r,
      attachmentCount: r.attachments.length,
    }));
  }

  async get(id: string, actor: { role: Role; companyId: string | null }) {
    const r = await this.prisma.serviceTask.findUnique({
      where: { id },
      include: {
        device:      true,
        attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true, uploadedAt: true } },
      },
    });
    if (!r) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && r.companyId !== actor.companyId) throw new ForbiddenException();
    return r;
  }

  async create(actor: { role: Role; companyId: string | null; id?: string }, dto: CreateServiceTaskDto) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const companyId = actor.companyId!;
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    if (actor.role !== 'SUPER_ADMIN' && device.companyId !== companyId) throw new ForbiddenException();
    return this.prisma.serviceTask.create({
      data: this.coerce({ ...dto, companyId, createdByUserId: actor.id ?? null }) as any,
    });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateServiceTaskDto) {
    const r = await this.prisma.serviceTask.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && r.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.serviceTask.update({
      where: { id },
      data: this.coerce(dto, /* isUpdate */ true) as any,
    });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const r = await this.prisma.serviceTask.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && r.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.serviceTask.delete({ where: { id } });
    return { ok: true };
  }

  // ── Attachments ─────────────────────────────────────────────
  async addAttachment(id: string, actor: { role: Role; companyId: string | null }, file: any) {
    if (!file?.buffer) throw new BadRequestException('Файл байхгүй байна');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Файл 5 МБ-аас бага байх ёстой');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      throw new BadRequestException('Зөвхөн JPEG / PNG / WEBP / GIF зураг дэмждэг');
    }
    const r = await this.prisma.serviceTask.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && r.companyId !== actor.companyId) throw new ForbiddenException();
    const a = await this.prisma.serviceTaskAttachment.create({
      data: {
        serviceTaskId: id,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        data: file.buffer,
      },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, uploadedAt: true },
    });
    return a;
  }

  async getAttachment(id: string, attachmentId: string, actor: { role: Role; companyId: string | null }, res: Response) {
    const a = await this.prisma.serviceTaskAttachment.findUnique({
      where: { id: attachmentId },
      include: { serviceTask: { select: { id: true, companyId: true } } },
    });
    if (!a || a.serviceTaskId !== id) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && a.serviceTask.companyId !== actor.companyId) throw new ForbiddenException();
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Length', a.sizeBytes.toString());
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(a.data);
  }

  async removeAttachment(id: string, attachmentId: string, actor: { role: Role; companyId: string | null }) {
    const a = await this.prisma.serviceTaskAttachment.findUnique({
      where: { id: attachmentId },
      include: { serviceTask: { select: { id: true, companyId: true } } },
    });
    if (!a || a.serviceTaskId !== id) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && a.serviceTask.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.serviceTaskAttachment.delete({ where: { id: attachmentId } });
    return { ok: true };
  }

  // Date strings → Date, empty → null. companyId stripped on update.
  private coerce(dto: Record<string, any>, isUpdate = false): Record<string, any> {
    const out: Record<string, any> = { ...dto };
    for (const k of ['scheduledAt', 'completedAt']) {
      if (out[k] != null && out[k] !== '' && !(out[k] instanceof Date)) {
        const d = new Date(out[k]);
        if (!Number.isNaN(d.getTime())) out[k] = d;
        else out[k] = null;
      } else if (out[k] === '') out[k] = null;
    }
    for (const k of Object.keys(out)) {
      if (out[k] === '') out[k] = null;
    }
    if (isUpdate) delete out.companyId;
    return out;
  }
}

@Controller('service-tasks')
@Roles(Role.VIEWER)
class ServiceTasksController {
  constructor(private readonly svc: ServiceTasksService) {}

  @Get()
  @Audit('service_task.list')
  list(
    @Req() req: any,
    @Query('deviceId') deviceId?: string,
    @Query('status') status?: ServiceTaskStatus,
    @Query('upcoming') upcoming?: string,
  ) {
    return this.svc.list(req.user, { deviceId, status, upcoming: upcoming === 'true' });
  }

  @Get(':id')
  @Audit('service_task.read', { resourceType: 'service_task', resourceIdParam: 'id' })
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, req.user);
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('service_task.create', { resourceType: 'service_task', captureResult: true })
  create(@Body() dto: CreateServiceTaskDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('service_task.update', { resourceType: 'service_task', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateServiceTaskDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('service_task.delete', { resourceType: 'service_task', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }

  // ── Attachments ─────────────────────────────────────────────
  @Post(':id/attachments')
  @Roles(Role.FLEET_MANAGER)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @Audit('service_task.attachment_add', { resourceType: 'service_task', resourceIdParam: 'id' })
  addAttachment(@Param('id') id: string, @UploadedFile() file: any, @Req() req: any) {
    return this.svc.addAttachment(id, req.user, file);
  }

  @Get(':id/attachments/:attachmentId')
  getAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @Req() req: any, @Res() res: Response) {
    return this.svc.getAttachment(id, attachmentId, req.user, res);
  }

  @Delete(':id/attachments/:attachmentId')
  @Roles(Role.FLEET_MANAGER)
  @Audit('service_task.attachment_delete', { resourceType: 'service_task', resourceIdParam: 'id' })
  removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @Req() req: any) {
    return this.svc.removeAttachment(id, attachmentId, req.user);
  }
}

@Module({
  controllers: [ServiceTasksController],
  providers: [ServiceTasksService],
})
export class ServiceTasksModule {}
