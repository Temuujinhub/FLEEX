import { Module } from '@nestjs/common';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Patch,
  Post,
  Delete,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { IsOptional, IsString, Length } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Public landing-page CMS. Single-row table; only super_admin can write.
// The image lives in Postgres as bytea (same pattern as service-task
// attachments) so deploys do not need a volume mount.

class UpdateLandingDto {
  @IsOptional() @IsString() @Length(0, 200) heroTagline?: string;
  @IsOptional() @IsString() @Length(0, 800) heroSubText?: string;
}

@Injectable()
class LandingService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const row = await this.prisma.landingSetting.findUnique({ where: { id: 1 } });
    return {
      heroTagline: row?.heroTagline ?? null,
      heroSubText: row?.heroSubText ?? null,
      hasImage: Boolean(row?.imageData),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async update(actor: { id?: string }, dto: UpdateLandingDto) {
    const data: any = { id: 1, ...dto, updatedById: actor.id ?? null };
    // Empty string from the form means "clear this field".
    if (dto.heroTagline === '') data.heroTagline = null;
    if (dto.heroSubText === '') data.heroSubText = null;
    return this.prisma.landingSetting.upsert({
      where: { id: 1 },
      update: data,
      create: data,
    });
  }

  async putImage(actor: { id?: string }, file: any) {
    if (!file?.buffer) throw new BadRequestException('Файл байхгүй байна');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Файл 5 МБ-аас бага байх ёстой');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      throw new BadRequestException('Зөвхөн JPEG / PNG / WEBP / GIF зураг дэмждэг');
    }
    return this.prisma.landingSetting.upsert({
      where: { id: 1 },
      update: { imageMime: file.mimetype, imageData: file.buffer, updatedById: actor.id ?? null },
      create: { id: 1, imageMime: file.mimetype, imageData: file.buffer, updatedById: actor.id ?? null },
    });
  }

  async deleteImage() {
    await this.prisma.landingSetting.update({
      where: { id: 1 },
      data: { imageMime: null, imageData: null },
    }).catch(() => undefined);
    return { ok: true };
  }

  async streamImage(res: Response) {
    const row = await this.prisma.landingSetting.findUnique({ where: { id: 1 } });
    if (!row?.imageData || !row.imageMime) throw new NotFoundException();
    res.setHeader('Content-Type', row.imageMime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(row.imageData);
  }
}

@Controller('landing')
class LandingController {
  constructor(private readonly svc: LandingService) {}

  @Public()
  @Get()
  get() {
    return this.svc.get();
  }

  @Public()
  @Get('image')
  image(@Res() res: Response) {
    return this.svc.streamImage(res);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch()
  @Audit('landing.update', { captureResult: true })
  update(@Body() dto: UpdateLandingDto, @Req() req: any) {
    return this.svc.update(req.user, dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @Audit('landing.image_upload')
  putImage(@UploadedFile() file: any, @Req() req: any) {
    return this.svc.putImage(req.user, file);
  }

  @Roles(Role.SUPER_ADMIN)
  @Delete('image')
  @Audit('landing.image_delete')
  deleteImage() {
    return this.svc.deleteImage();
  }
}

@Module({
  controllers: [LandingController],
  providers: [LandingService],
})
export class LandingModule {}
