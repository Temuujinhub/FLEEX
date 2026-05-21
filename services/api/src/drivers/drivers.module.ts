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
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Role } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Drivers / ажилчид. Driver carries license info, contact, address, and
// a department (DeviceGroup). The "Жолооч нэмэх" UI in Gaikham splits the
// name into 3 fields (Овог, Нэр, Товч нэр) — we follow suit but also keep
// `fullName` for legacy callers.

class CreateDriverDto {
  @IsString() @Length(2, 120) fullName!: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsUUID() shiftId?: string;
  @IsOptional() @IsString() rfidCard?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() ssn?: string;
  @IsOptional() @IsString() avatarKey?: string;
  @IsOptional() @IsString() licenseNo?: string;
  @IsOptional() @IsString() licenseCategory?: string;
  @IsOptional() @IsDateString() licenseIssuedAt?: string;
  @IsOptional() @IsDateString() licenseUntil?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateDriverDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsUUID() shiftId?: string;
  @IsOptional() @IsString() rfidCard?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() ssn?: string;
  @IsOptional() @IsString() avatarKey?: string;
  @IsOptional() @IsString() licenseNo?: string;
  @IsOptional() @IsString() licenseCategory?: string;
  @IsOptional() @IsDateString() licenseIssuedAt?: string;
  @IsOptional() @IsDateString() licenseUntil?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: { role: Role; companyId: string | null }, opts: { groupId?: string; search?: string }) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.groupId) where.groupId = opts.groupId;
    if (opts.search) {
      where.OR = [
        { fullName:   { contains: opts.search, mode: 'insensitive' } },
        { firstName:  { contains: opts.search, mode: 'insensitive' } },
        { lastName:   { contains: opts.search, mode: 'insensitive' } },
        { employeeId: { contains: opts.search, mode: 'insensitive' } },
        { phone:      { contains: opts.search } },
        { licenseNo:  { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.driver.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { fullName: 'asc' }],
      include: {
        group: { select: { id: true, name: true } },
        devices: { select: { id: true, name: true, plateNumber: true } },
      },
    });
  }

  async create(actor: { role: Role; companyId: string | null }, dto: CreateDriverDto) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const companyId = actor.companyId!;
    await this.ensureGroupOwnership(actor, companyId, dto.groupId);
    return this.prisma.driver.create({
      data: this.coerce({ ...dto, companyId }) as any,
    });
  }

  async update(id: string, actor: { role: Role; companyId: string | null }, dto: UpdateDriverDto) {
    const d = await this.prisma.driver.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && d.companyId !== actor.companyId) throw new ForbiddenException();
    await this.ensureGroupOwnership(actor, d.companyId, dto.groupId);
    return this.prisma.driver.update({ where: { id }, data: this.coerce(dto, /* isUpdate */ true) as any });
  }

  async remove(id: string, actor: { role: Role; companyId: string | null }) {
    const d = await this.prisma.driver.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && d.companyId !== actor.companyId) throw new ForbiddenException();
    await this.prisma.driver.delete({ where: { id } });
    return { ok: true };
  }

  // ── Bulk import via Excel ────────────────────────────────────
  // First sheet, first row is the header. Recognised header values map
  // case-insensitively to driver columns; everything else is ignored.
  async importExcel(actor: { role: Role; companyId: string | null }, buffer: Buffer) {
    if (!actor.companyId && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const companyId = actor.companyId!;
    const groups = await this.prisma.deviceGroup.findMany({ where: { companyId } });
    const groupByName = new Map(groups.map((g) => [g.name.toLowerCase(), g.id]));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel файл хоосон байна');

    const headers: Record<number, string> = {};
    ws.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.value ?? '').trim().toLowerCase();
    });

    const created: any[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (row.cellCount === 0 || !row.hasValues) continue;
      const rec: Record<string, any> = {};
      row.eachCell((cell, col) => {
        const key = MAP_DRIVER[headers[col]];
        if (!key) return;
        let v: any = cell.value;
        if (v && typeof v === 'object' && 'text' in (v as any)) v = (v as any).text;
        if (v == null || v === '') return;
        rec[key] = v;
      });

      const fullName = String(rec.fullName ?? `${rec.lastName ?? ''} ${rec.firstName ?? ''}`).trim();
      if (!fullName) {
        errors.push({ row: r, message: 'Нэр хоосон' });
        continue;
      }
      // Date coercion
      for (const dk of ['licenseIssuedAt', 'licenseUntil']) {
        if (rec[dk] && !(rec[dk] instanceof Date)) {
          const d = new Date(rec[dk]);
          if (!Number.isNaN(d.getTime())) rec[dk] = d;
          else delete rec[dk];
        }
      }
      // Department name → groupId
      if (rec._groupName) {
        const gid = groupByName.get(String(rec._groupName).toLowerCase());
        if (gid) rec.groupId = gid;
        delete rec._groupName;
      }
      try {
        const d = await this.prisma.driver.create({
          data: { ...rec, fullName, companyId } as any,
        });
        created.push({ id: d.id, fullName: d.fullName });
      } catch (e: any) {
        errors.push({ row: r, message: e?.message ?? 'Хадгалах үед алдаа' });
      }
    }
    return { createdCount: created.length, errorCount: errors.length, created, errors };
  }

  async writeTemplate(res: Response) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Drivers');
    ws.columns = [
      { header: 'Овог',                   key: 'lastName',        width: 18 },
      { header: 'Нэр',                    key: 'firstName',       width: 18 },
      { header: 'Товч нэр',               key: 'shortName',       width: 14 },
      { header: 'Бүтэн нэр',              key: 'fullName',        width: 28 },
      { header: 'Ажилтны ID',             key: 'employeeId',      width: 16 },
      { header: 'Хэлтэс',                 key: 'group',           width: 22 },
      { header: 'Утас',                   key: 'phone',           width: 14 },
      { header: 'И-мэйл',                 key: 'email',           width: 24 },
      { header: 'Хаяг',                   key: 'address',         width: 30 },
      { header: 'RFID картын дугаар',     key: 'rfidCard',        width: 18 },
      { header: 'Үнэмлэхний дугаар',      key: 'licenseNo',       width: 18 },
      { header: 'Үнэмлэхний ангилал',     key: 'licenseCategory', width: 14 },
      { header: 'Олгосон огноо',          key: 'licenseIssuedAt', width: 14 },
      { header: 'Хүчинтэй хугацаа',       key: 'licenseUntil',    width: 14 },
    ];
    ws.addRow({
      lastName: 'Болд', firstName: 'Бат', shortName: 'Б.Бат',
      fullName: 'Болд Бат', employeeId: 'E-0001', group: 'Тээвэр-А',
      phone: '99119911', email: 'bat@example.com', address: 'Улаанбаатар',
      rfidCard: '0007654321', licenseNo: 'УБ12345678',
      licenseCategory: 'BC', licenseIssuedAt: new Date('2020-03-15'), licenseUntil: new Date('2030-03-15'),
    });
    ws.getRow(1).font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="fleex-drivers-template.xlsx"');
    const buf = await wb.xlsx.writeBuffer();
    res.send(Buffer.from(buf));
  }

  // ── helpers ─────────────────────────────────────────────────
  private coerce(dto: Record<string, any>, isUpdate = false): Record<string, any> {
    const out: Record<string, any> = { ...dto };
    for (const k of ['licenseIssuedAt', 'licenseUntil']) {
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

  private async ensureGroupOwnership(
    actor: { role: Role; companyId: string | null },
    companyId: string | null,
    groupId?: string,
  ) {
    if (!groupId) return;
    if (actor.role === 'SUPER_ADMIN') return;
    const g = await this.prisma.deviceGroup.findUnique({ where: { id: groupId } });
    if (!g || g.companyId !== companyId) throw new ForbiddenException('Group not owned by tenant');
  }
}

// Header label → DriverCreateInput key. Case-insensitive lookup; everything
// not listed is ignored on import.
const MAP_DRIVER: Record<string, string> = {
  'овог':                  'lastName',
  'нэр':                   'firstName',
  'товч нэр':              'shortName',
  'бүтэн нэр':             'fullName',
  'ажилтны id':            'employeeId',
  'хэлтэс':                '_groupName',
  'утас':                  'phone',
  'и-мэйл':                'email',
  'хаяг':                  'address',
  'rfid картын дугаар':    'rfidCard',
  'rfid':                  'rfidCard',
  'үнэмлэхний дугаар':     'licenseNo',
  'үнэмлэхний ангилал':    'licenseCategory',
  'олгосон огноо':         'licenseIssuedAt',
  'хүчинтэй хугацаа':      'licenseUntil',
  'ssn':                   'ssn',
};

@Controller('drivers')
@Roles(Role.VIEWER)
class DriversController {
  constructor(private readonly svc: DriversService) {}

  @Get()
  @Audit('driver.list')
  list(@Req() req: any, @Query('groupId') groupId?: string, @Query('search') search?: string) {
    return this.svc.list(req.user, { groupId, search });
  }

  @Post()
  @Roles(Role.FLEET_MANAGER)
  @Audit('driver.create', { resourceType: 'driver', captureResult: true })
  create(@Body() dto: CreateDriverDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.FLEET_MANAGER)
  @Audit('driver.update', { resourceType: 'driver', resourceIdParam: 'id', captureResult: true })
  update(@Param('id') id: string, @Body() dto: UpdateDriverDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.COMPANY_ADMIN)
  @Audit('driver.delete', { resourceType: 'driver', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }

  // ── Excel import / template ────────────────────────────────
  @Get('import-template')
  template(@Res() res: Response) {
    return this.svc.writeTemplate(res);
  }

  @Post('import')
  @Roles(Role.FLEET_MANAGER)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @Audit('driver.import')
  async import(@UploadedFile() file: any, @Req() req: any) {
    if (!file?.buffer) throw new BadRequestException('Файл байхгүй байна');
    return this.svc.importExcel(req.user, file.buffer);
  }
}

@Module({
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule {}
