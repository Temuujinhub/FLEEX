import { Controller, Get, Query, ForbiddenException, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

@Controller('audit')
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Req() req: any,
    @Query('limit') limit = '50',
    @Query('cursor') cursor?: string,
    @Query('action') action?: string,
  ) {
    const user = req.user;
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const where: any = {};
    if (action) where.action = action;
    if (user.role !== Role.SUPER_ADMIN) {
      where.companyId = user.companyId;
    }
    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: BigInt(cursor) }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    const out = items.slice(0, take).map((row) => ({
      ...row,
      id: row.id.toString(),
    }));
    return {
      items: out,
      nextCursor: hasMore ? out[out.length - 1].id : null,
    };
  }

  @Get('verify')
  async verify(@Req() req: any) {
    if (req.user.role !== Role.SUPER_ADMIN) throw new ForbiddenException();
    return this.audit.verifyChain();
  }
}
