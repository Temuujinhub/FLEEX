import { Module } from '@nestjs/common';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
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

// Public landing-page CMS. Hero text lives on a single-row
// `LandingSetting`; every image (hero + use cases + about + why-us)
// lives in `LandingImage` keyed by slot name. Reads are public so the
// marketing page can render without auth; writes are SUPER_ADMIN only.

// Allowed image-slot keys. The frontend uses the same identifiers when
// requesting / uploading images.
const ALLOWED_KEYS = new Set([
  'hero',
  'about',
  'use-case-mining',
  'use-case-delivery',
  'use-case-intercity',
  'use-case-bus',
  'use-case-rental',
  'why-us',
]);

function assertKey(key: string) {
  if (!ALLOWED_KEYS.has(key)) {
    throw new BadRequestException(`Unsupported image key: ${key}`);
  }
}

class UpdateLandingDto {
  @IsOptional() @IsString() @Length(0, 200) heroTagline?: string;
  @IsOptional() @IsString() @Length(0, 800) heroSubText?: string;
}

@Injectable()
class LandingService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const [row, images] = await Promise.all([
      this.prisma.landingSetting.findUnique({ where: { id: 1 } }),
      this.prisma.landingImage.findMany({ select: { key: true, updatedAt: true } }),
    ]);
    const map: Record<string, { hasImage: boolean; updatedAt: string }> = {};
    for (const img of images) {
      map[img.key] = { hasImage: true, updatedAt: img.updatedAt.toISOString() };
    }
    // Legacy: hero image stored on LandingSetting before the keyed table.
    if (!map.hero && row?.imageData) {
      map.hero = { hasImage: true, updatedAt: row.updatedAt.toISOString() };
    }
    return {
      heroTagline: row?.heroTagline ?? null,
      heroSubText: row?.heroSubText ?? null,
      hasImage: Boolean(map.hero),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      images: map,
    };
  }

  async update(actor: { id?: string }, dto: UpdateLandingDto) {
    const data: any = { id: 1, ...dto, updatedById: actor.id ?? null };
    if (dto.heroTagline === '') data.heroTagline = null;
    if (dto.heroSubText === '') data.heroSubText = null;
    return this.prisma.landingSetting.upsert({
      where: { id: 1 },
      update: data,
      create: data,
    });
  }

  async putImage(actor: { id?: string }, key: string, file: any) {
    assertKey(key);
    if (!file?.buffer) throw new BadRequestException('Файл байхгүй байна');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Файл 5 МБ-аас бага байх ёстой');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      throw new BadRequestException('Зөвхөн JPEG / PNG / WEBP / GIF зураг дэмждэг');
    }
    return this.prisma.landingImage.upsert({
      where: { key },
      update: { mimeType: file.mimetype, data: file.buffer, updatedById: actor.id ?? null },
      create: { key, mimeType: file.mimetype, data: file.buffer, updatedById: actor.id ?? null },
    });
  }

  async deleteImage(key: string) {
    assertKey(key);
    await this.prisma.landingImage.delete({ where: { key } }).catch(() => undefined);
    // Also clear the legacy hero blob so GET stops claiming hasImage.
    if (key === 'hero') {
      await this.prisma.landingSetting
        .update({ where: { id: 1 }, data: { imageMime: null, imageData: null } })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  async streamImage(key: string, res: Response) {
    assertKey(key);
    const img = await this.prisma.landingImage.findUnique({ where: { key } });
    if (img) {
      res.setHeader('Content-Type', img.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(img.data);
      return;
    }
    if (key === 'hero') {
      const row = await this.prisma.landingSetting.findUnique({ where: { id: 1 } });
      if (row?.imageData && row.imageMime) {
        res.setHeader('Content-Type', row.imageMime);
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.send(row.imageData);
        return;
      }
    }
    throw new NotFoundException();
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

  // ── Per-key images (new) ────────────────────────────────────
  @Public()
  @Get('images/:key')
  imageByKey(@Param('key') key: string, @Res() res: Response) {
    return this.svc.streamImage(key, res);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('images/:key')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @Audit('landing.image_upload', { resourceType: 'landing_image', resourceIdParam: 'key' })
  putImageByKey(@Param('key') key: string, @UploadedFile() file: any, @Req() req: any) {
    return this.svc.putImage(req.user, key, file);
  }

  @Roles(Role.SUPER_ADMIN)
  @Delete('images/:key')
  @Audit('landing.image_delete', { resourceType: 'landing_image', resourceIdParam: 'key' })
  deleteImageByKey(@Param('key') key: string) {
    return this.svc.deleteImage(key);
  }

  // ── Hero text update ────────────────────────────────────────
  @Roles(Role.SUPER_ADMIN)
  @Patch()
  @Audit('landing.update', { captureResult: true })
  update(@Body() dto: UpdateLandingDto, @Req() req: any) {
    return this.svc.update(req.user, dto);
  }

  // ── Back-compat aliases for the single-image API ────────────
  @Public()
  @Get('image')
  legacyImage(@Res() res: Response) {
    return this.svc.streamImage('hero', res);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @Audit('landing.image_upload')
  legacyPutImage(@UploadedFile() file: any, @Req() req: any) {
    return this.svc.putImage(req.user, 'hero', file);
  }

  @Roles(Role.SUPER_ADMIN)
  @Delete('image')
  @Audit('landing.image_delete')
  legacyDeleteImage() {
    return this.svc.deleteImage('hero');
  }
}

@Module({
  controllers: [LandingController],
  providers: [LandingService],
})
export class LandingModule {}
