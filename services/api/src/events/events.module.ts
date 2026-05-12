import { Module } from '@nestjs/common';
import { Controller, Get, Patch, Param, Query, Req, Body } from '@nestjs/common';
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { EventType, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

class AckDto {
  @IsOptional() @IsString() note?: string;
}

@Injectable()
class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: { role: Role; companyId: string | null },
    opts: { from?: Date; to?: Date; type?: EventType; deviceId?: string; acknowledged?: boolean; cursor?: bigint; limit: number },
  ) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') where.companyId = actor.companyId;
    if (opts.deviceId) where.deviceId = opts.deviceId;
    if (opts.type) where.type = opts.type;
    if (typeof opts.acknowledged === 'boolean') where.acknowledged = opts.acknowledged;
    if (opts.from || opts.to) where.occurredAt = { gte: opts.from, lte: opts.to };

    const items = await this.prisma.event.findMany({
      where,
      orderBy: { id: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > opts.limit;
    const out = items.slice(0, opts.limit).map((e) => ({ ...e, id: e.id.toString() }));
    return { items: out, nextCursor: hasMore ? out[out.length - 1].id : null };
  }

  async ack(id: bigint, actor: { id: string; role: Role; companyId: string | null }) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && event.companyId !== actor.companyId) throw new ForbiddenException();
    return this.prisma.event.update({
      where: { id },
      data: { acknowledged: true, acknowledgedById: actor.id, acknowledgedAt: new Date() },
    });
  }
}

@Controller('events')
@Roles(Role.VIEWER)
class EventsController {
  constructor(private readonly svc: EventsService) {}

  @Get()
  @Audit('event.list')
  list(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: EventType,
    @Query('deviceId') deviceId?: string,
    @Query('ack') ack?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '100',
  ) {
    return this.svc.list(req.user, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      type,
      deviceId,
      acknowledged: ack === undefined ? undefined : ack === 'true',
      cursor: cursor ? BigInt(cursor) : undefined,
      limit: Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500),
    });
  }

  @Patch(':id/ack')
  @Roles(Role.DISPATCHER)
  @Audit('event.acknowledge', { resourceType: 'event', resourceIdParam: 'id' })
  ack(@Param('id') id: string, @Body() _dto: AckDto, @Req() req: any) {
    return this.svc.ack(BigInt(id), req.user);
  }
}

@Module({
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
