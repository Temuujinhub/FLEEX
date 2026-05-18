import { Module, Controller, Get, Param, Query, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Raw-message viewer. The ingestor writes the last ~500 packets per device
// to `raw_messages`; this controller exposes them to the operator UI for
// debugging "why is this device silent?" or "is the fuel sensor wiring
// good?". BigInt IDs are serialised to strings so the JSON response is
// portable.

@Injectable()
class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    deviceId: string,
    actor: { role: Role; companyId: string | null },
    opts: { limit: number; cursor?: bigint },
  ) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();

    const items = await this.prisma.rawMessage.findMany({
      where: { deviceId },
      orderBy: { id: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > opts.limit;
    const out = items.slice(0, opts.limit).map((m) => ({ ...m, id: m.id.toString() }));
    return { items: out, nextCursor: hasMore ? out[out.length - 1].id : null };
  }
}

@Controller('devices/:deviceId/messages')
@Roles(Role.FLEET_MANAGER)
class MessagesController {
  constructor(private readonly svc: MessagesService) {}

  @Get()
  @Audit('message.list', { resourceType: 'device', resourceIdParam: 'deviceId' })
  list(
    @Param('deviceId') deviceId: string,
    @Req() req: any,
    @Query('limit') limit = '100',
    @Query('cursor') cursor?: string,
  ) {
    return this.svc.list(deviceId, req.user, {
      limit: Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500),
      cursor: cursor ? BigInt(cursor) : undefined,
    });
  }
}

@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
