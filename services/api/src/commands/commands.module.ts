import { Module, Controller, Post, Body, Param, Req, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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
}

@Controller('devices/:deviceId/commands')
@Roles(Role.FLEET_MANAGER)
class CommandsController {
  constructor(private readonly svc: CommandsService) {}

  @Post()
  @Audit('device.command', { resourceType: 'device', resourceIdParam: 'deviceId', captureResult: true })
  issue(@Param('deviceId') deviceId: string, @Body() dto: IssueCommandDto, @Req() req: any) {
    return this.svc.issue(deviceId, req.user, dto);
  }
}

@Module({
  controllers: [CommandsController],
  providers: [CommandsService],
})
export class CommandsModule {}
