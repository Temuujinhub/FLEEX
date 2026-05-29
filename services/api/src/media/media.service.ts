import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { createReadStream, existsSync } from 'fs';
import { basename, join } from 'path';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

type Actor = { role: Role; companyId: string | null };

@Injectable()
export class MediaService {
  private readonly dataDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    // Same volume the media-service writes to (mounted read-only here).
    this.dataDir = config.get<string>('MEDIA_DATA_DIR') ?? '/data/media';
  }

  private ensureTenant(actor: Actor, companyId: string | null) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.companyId !== companyId) throw new ForbiddenException('Cross-tenant access denied');
  }

  private async deviceScoped(actor: Actor, deviceId: string) {
    const d = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, imei: true, companyId: true },
    });
    if (!d) throw new NotFoundException('Device not found');
    this.ensureTenant(actor, d.companyId);
    return d;
  }

  async listForDevice(
    actor: Actor,
    deviceId: string,
    opts: { kind?: string; limit?: number; cursor?: string },
  ) {
    const device = await this.deviceScoped(actor, deviceId);
    const take = Math.min(Math.max(opts.limit ?? 60, 1), 200);
    const where: { deviceId: string; kind?: string } = { deviceId: device.id };
    if (opts.kind === 'photo' || opts.kind === 'video') where.kind = opts.kind;

    const items = await this.prisma.deviceImage.findMany({
      where,
      orderBy: { capturedAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: { id: true, kind: true, fileName: true, size: true, trigger: true, capturedAt: true },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  // Streams the blob after an auth + tenant check. The API is the only path
  // that serves media bytes, so the volume never needs to be public.
  async streamFile(actor: Actor, imageId: string, res: Response) {
    const img = await this.prisma.deviceImage.findUnique({
      where: { id: imageId },
      select: { companyId: true, fileName: true, kind: true },
    });
    if (!img) throw new NotFoundException('Image not found');
    this.ensureTenant(actor, img.companyId);

    const safe = basename(img.fileName); // defense-in-depth vs path traversal
    const abs = join(this.dataDir, safe);
    if (!existsSync(abs)) throw new NotFoundException('Media file missing');

    if (img.kind === 'video') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    } else {
      res.setHeader('Content-Type', 'image/jpeg');
    }
    res.setHeader('Cache-Control', 'private, max-age=86400');
    createReadStream(abs).pipe(res);
  }

  // Arms a one-shot capture request the media-service consumes (GETDEL) on the
  // camera's next connection. 1h TTL so a stale request doesn't linger.
  async requestCapture(actor: Actor, deviceId: string, kind: 'photo' | 'video') {
    const device = await this.deviceScoped(actor, deviceId);
    const key = kind === 'video' ? `media:videoreq:${device.imei}` : `media:photoreq:${device.imei}`;
    await this.redis.client.set(key, '1', 'EX', 3600);
    return { ok: true, kind };
  }
}
