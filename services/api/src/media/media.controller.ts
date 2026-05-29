import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { MediaService } from './media.service';

class CaptureDto {
  @IsIn(['photo', 'video']) kind!: 'photo' | 'video';
}

@Controller()
export class MediaController {
  constructor(private readonly svc: MediaService) {}

  @Get('devices/:deviceId/images')
  @Roles(Role.VIEWER)
  @Audit('media.list', { resourceType: 'device', resourceIdParam: 'deviceId' })
  list(
    @Param('deviceId') deviceId: string,
    @Query('kind') kind: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @Req() req: any,
  ) {
    const n = Number.parseInt(limit, 10);
    return this.svc.listForDevice(req.user, deviceId, {
      kind: kind || undefined,
      limit: Number.isFinite(n) ? n : undefined,
      cursor: cursor || undefined,
    });
  }

  @Get('media/:id/file')
  @Roles(Role.VIEWER)
  file(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    return this.svc.streamFile(req.user, id, res);
  }

  @Post('devices/:deviceId/camera/request')
  @Roles(Role.FLEET_MANAGER)
  @Audit('media.request', { resourceType: 'device', resourceIdParam: 'deviceId' })
  request(@Param('deviceId') deviceId: string, @Body() dto: CaptureDto, @Req() req: any) {
    return this.svc.requestCapture(req.user, deviceId, dto.kind);
  }
}
