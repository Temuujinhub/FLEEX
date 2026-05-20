import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import {
  Role,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Support ticket inbox. Company admins file complaints / bug reports /
// repair requests; the SUPER_ADMIN (admin@fleex.mn) reviews them across
// every tenant from a single inbox. We keep the surface small: list,
// create, reply, change status. Attachments and SLA timers can come
// later if the customer support load justifies it.

class CreateTicketDto {
  @IsString() @Length(3, 200) title!: string;
  @IsString() @Length(1, 5000) description!: string;
  @IsOptional() @IsEnum(SupportTicketCategory) category?: SupportTicketCategory;
  @IsOptional() @IsEnum(SupportTicketPriority) priority?: SupportTicketPriority;
  @IsOptional() @IsString() @Length(0, 32) contactPhone?: string;
}

class UpdateTicketDto {
  @IsOptional() @IsEnum(SupportTicketStatus) status?: SupportTicketStatus;
  @IsOptional() @IsEnum(SupportTicketPriority) priority?: SupportTicketPriority;
  @IsOptional() @IsEnum(SupportTicketCategory) category?: SupportTicketCategory;
}

class ReplyDto {
  @IsString() @Length(1, 5000) body!: string;
}

@Injectable()
export class SupportTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: { id: string; role: Role; companyId: string | null }, status?: string) {
    const where: any = {};
    if (actor.role !== 'SUPER_ADMIN') {
      // Company-scoped users only see their own company's tickets.
      where.companyId = actor.companyId ?? '__none__';
    }
    if (status && status !== 'ALL') where.status = status;

    return this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        company: { select: { id: true, name: true } },
        submitter: { select: { id: true, email: true, fullName: true } },
        _count: { select: { replies: true } },
      },
    });
  }

  async get(id: string, actor: { id: string; role: Role; companyId: string | null }) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        submitter: { select: { id: true, email: true, fullName: true, phone: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, email: true, fullName: true, role: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && ticket.companyId !== actor.companyId) {
      throw new ForbiddenException();
    }
    return ticket;
  }

  async create(dto: CreateTicketDto, actor: { id: string; role: Role; companyId: string | null }) {
    if (!actor.companyId) {
      throw new BadRequestException('Хэрэглэгчид компани харьяалагдсан байх ёстой');
    }
    return this.prisma.supportTicket.create({
      data: {
        companyId: actor.companyId,
        submitterId: actor.id,
        title: dto.title,
        description: dto.description,
        category: dto.category ?? 'OTHER',
        priority: dto.priority ?? 'NORMAL',
        contactPhone: dto.contactPhone,
      },
    });
  }

  async update(id: string, dto: UpdateTicketDto, actor: { id: string; role: Role; companyId: string | null }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException();
    // Status changes are SUPER_ADMIN-only — tenants can't mark their
    // own tickets resolved (otherwise the inbox becomes meaningless).
    if (dto.status && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Статус өөрчлөх эрх алга');
    }
    if (actor.role !== 'SUPER_ADMIN' && ticket.companyId !== actor.companyId) {
      throw new ForbiddenException();
    }
    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.status === 'RESOLVED' && { resolvedAt: new Date() }),
      },
    });
  }

  async reply(id: string, dto: ReplyDto, actor: { id: string; role: Role; companyId: string | null }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException();
    if (actor.role !== 'SUPER_ADMIN' && ticket.companyId !== actor.companyId) {
      throw new ForbiddenException();
    }
    const reply = await this.prisma.supportTicketReply.create({
      data: { ticketId: id, authorId: actor.id, body: dto.body },
    });
    // First admin reply auto-bumps the ticket out of OPEN so the inbox
    // gives an at-a-glance "untouched vs. in-progress" split.
    if (actor.role === 'SUPER_ADMIN' && ticket.status === 'OPEN') {
      await this.prisma.supportTicket.update({
        where: { id },
        data: { status: 'IN_PROGRESS' },
      });
    }
    return reply;
  }

  async remove(id: string, actor: { id: string; role: Role; companyId: string | null }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException();
    // Only the submitter or SUPER_ADMIN can delete. Other company users
    // (including company admins of the same tenant) can't, to prevent
    // someone closing a colleague's complaint without trace.
    if (actor.role !== 'SUPER_ADMIN' && ticket.submitterId !== actor.id) {
      throw new ForbiddenException();
    }
    await this.prisma.supportTicket.delete({ where: { id } });
    return { ok: true };
  }

  // Inbox summary for the SUPER_ADMIN sidebar badge.
  async stats(actor: { role: Role }) {
    if (actor.role !== 'SUPER_ADMIN') return { open: 0, inProgress: 0 };
    const [open, inProgress] = await Promise.all([
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
    ]);
    return { open, inProgress };
  }
}

@Controller('support-tickets')
@Roles(Role.VIEWER)
export class SupportTicketsController {
  constructor(private readonly svc: SupportTicketsService) {}

  @Get()
  @Audit('support.list')
  list(@Query('status') status: string, @Req() req: any) {
    return this.svc.list(req.user, status);
  }

  @Get('stats')
  @Audit('support.stats')
  stats(@Req() req: any) {
    return this.svc.stats(req.user);
  }

  @Get(':id')
  @Audit('support.get', { resourceType: 'support_ticket', resourceIdParam: 'id' })
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, req.user);
  }

  @Post()
  @Roles(Role.COMPANY_ADMIN)
  @Audit('support.create', { resourceType: 'support_ticket' })
  create(@Body() dto: CreateTicketDto, @Req() req: any) {
    return this.svc.create(dto, req.user);
  }

  @Patch(':id')
  @Audit('support.update', { resourceType: 'support_ticket', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @Req() req: any) {
    return this.svc.update(id, dto, req.user);
  }

  @Post(':id/replies')
  @Audit('support.reply', { resourceType: 'support_ticket', resourceIdParam: 'id' })
  reply(@Param('id') id: string, @Body() dto: ReplyDto, @Req() req: any) {
    return this.svc.reply(id, dto, req.user);
  }

  @Delete(':id')
  @Audit('support.delete', { resourceType: 'support_ticket', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }
}

@Module({
  controllers: [SupportTicketsController],
  providers: [SupportTicketsService],
})
export class SupportTicketsModule {}
