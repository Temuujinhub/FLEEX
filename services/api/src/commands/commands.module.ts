import { Module, Controller, Delete, Get, Post, Body, Param, Query, Req, Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

class IssueCommandDto {
  @IsString() type!: string; // "reset" | "engine_block" | "engine_unblock" | "setodometer" | ...
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

// Commands are queued in Postgres and pushed onto a Redis list that the
// ingestor's command-fanout worker pops and delivers over the device's open
// TCP session. We keep both because Postgres is the source of truth for
// audit/state, Redis is the hot dispatch path.
@Injectable()
class CommandsService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async issue(
    deviceId: string,
    actor: { id: string; role: Role; companyId: string | null },
    dto: IssueCommandDto,
  ) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException('Device not found');
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();

    const cmd = await this.prisma.command.create({
      data: { deviceId, issuedById: actor.id, type: dto.type, payload: dto.payload as any },
    });
    await this.redis.client.rpush(
      `fleex.commands:${dev.imei}`,
      JSON.stringify({ id: cmd.id.toString(), type: dto.type, payload: dto.payload ?? null }),
    );
    return { ...cmd, id: cmd.id.toString() };
  }

  async list(
    deviceId: string,
    actor: { role: Role; companyId: string | null },
    opts: { limit: number },
  ) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();
    const items = await this.prisma.command.findMany({
      where: { deviceId },
      orderBy: { id: 'desc' },
      take: opts.limit,
    });
    return items.map((c) => ({ ...c, id: c.id.toString() }));
  }

  // Cancel a queued command. We only allow it while the command is still
  // PENDING — once it has been sent the device has already received it and
  // there's nothing meaningful to cancel from the server side. The Redis
  // queue entry is best-effort: we LREM by exact payload match; if the
  // ingestor has already popped it, the Postgres delete still proceeds
  // (the command will sit in the device's local buffer at most).
  async cancel(
    deviceId: string,
    commandId: bigint,
    actor: { role: Role; companyId: string | null },
  ) {
    const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException('Device not found');
    if (actor.role !== 'SUPER_ADMIN' && dev.companyId !== actor.companyId) throw new ForbiddenException();
    const cmd = await this.prisma.command.findUnique({ where: { id: commandId } });
    if (!cmd || cmd.deviceId !== deviceId) throw new NotFoundException('Command not found');
    if (cmd.status !== 'PENDING') {
      throw new BadRequestException('Зөвхөн хүлээгдэж буй (PENDING) команд цуцлах боломжтой');
    }
    // Best-effort Redis cleanup. The ingestor's queue payload is the same
    // JSON envelope we wrote on POST, so we re-build it and LREM by value.
    try {
      const envelope = JSON.stringify({
        id: cmd.id.toString(),
        type: cmd.type,
        payload: cmd.payload ?? null,
      });
      await this.redis.client.lrem(`fleex.commands:${dev.imei}`, 0, envelope);
    } catch {
      // Redis unreachable or already popped — non-fatal.
    }
    await this.prisma.command.delete({ where: { id: commandId } });
    return { ok: true };
  }
}

@Controller('devices/:deviceId/commands')
@Roles(Role.FLEET_MANAGER)
class CommandsController {
  constructor(private readonly svc: CommandsService) {}

  @Get()
  @Audit('device.command.list', { resourceType: 'device', resourceIdParam: 'deviceId' })
  list(
    @Param('deviceId') deviceId: string,
    @Req() req: any,
    @Query('limit') limit = '50',
  ) {
    return this.svc.list(deviceId, req.user, {
      limit: Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200),
    });
  }

  @Post()
  @Audit('device.command', { resourceType: 'device', resourceIdParam: 'deviceId', captureResult: true })
  issue(@Param('deviceId') deviceId: string, @Body() dto: IssueCommandDto, @Req() req: any) {
    return this.svc.issue(deviceId, req.user, dto);
  }

  @Delete(':commandId')
  @Audit('device.command.cancel', { resourceType: 'device', resourceIdParam: 'deviceId' })
  cancel(
    @Param('deviceId') deviceId: string,
    @Param('commandId') commandId: string,
    @Req() req: any,
  ) {
    return this.svc.cancel(deviceId, BigInt(commandId), req.user);
  }
}

@Module({
  controllers: [CommandsController],
  providers: [CommandsService],
})
export class CommandsModule {}
