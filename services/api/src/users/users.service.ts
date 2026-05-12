import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

const SAFE_USER_FIELDS = {
  id: true,
  email: true,
  username: true,
  fullName: true,
  phone: true,
  role: true,
  status: true,
  companyId: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: { role: Role; companyId: string | null }) {
    const where = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId };
    return this.prisma.user.findMany({ where, select: SAFE_USER_FIELDS, orderBy: { createdAt: 'desc' } });
  }

  async get(id: string, actor: { role: Role; companyId: string | null; id: string }) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: SAFE_USER_FIELDS });
    if (!u) throw new NotFoundException('User not found');
    this.ensureSameTenant(actor, u.companyId);
    return u;
  }

  async create(
    actor: { role: Role; companyId: string | null },
    dto: { email: string; password: string; fullName?: string; role: Role; companyId?: string; phone?: string },
  ) {
    // Non-SUPER_ADMIN can only create users in their own company, and only at
    // lower or equal level (handled by RBAC ladder on the route guard).
    const companyId = actor.role === 'SUPER_ADMIN' ? dto.companyId ?? null : actor.companyId;
    const hash = await argon2.hash(dto.password, { type: argon2.argon2id });
    return this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: hash,
        fullName: dto.fullName,
        phone: dto.phone,
        role: dto.role,
        companyId,
      },
      select: SAFE_USER_FIELDS,
    });
  }

  async update(
    id: string,
    actor: { role: Role; companyId: string | null; id: string },
    dto: Partial<{ fullName: string; phone: string; role: Role; status: 'ACTIVE' | 'DISABLED' | 'LOCKED' }>,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException();
    this.ensureSameTenant(actor, target.companyId);

    // No one can grant a role above their own.
    if (dto.role && rank(dto.role) > rank(actor.role)) {
      throw new ForbiddenException('Cannot elevate above your own role');
    }
    return this.prisma.user.update({ where: { id }, data: dto, select: SAFE_USER_FIELDS });
  }

  async resetPassword(id: string, newPassword: string, actor: { role: Role; companyId: string | null; id: string }) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException();
    this.ensureSameTenant(actor, target.companyId);
    const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: hash, failedLogins: 0, lockedUntil: null, status: 'ACTIVE' },
    });
    // Force re-auth on every existing session.
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async delete(id: string, actor: { role: Role; companyId: string | null }) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException();
    this.ensureSameTenant(actor, target.companyId);
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }

  private ensureSameTenant(actor: { role: Role; companyId: string | null }, targetCompanyId: string | null) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.companyId !== targetCompanyId) throw new ForbiddenException('Cross-tenant access denied');
  }
}

function rank(role: Role): number {
  switch (role) {
    case 'SUPER_ADMIN': return 100;
    case 'COMPANY_ADMIN': return 80;
    case 'FLEET_MANAGER': return 60;
    case 'DISPATCHER': return 40;
    case 'DRIVER': return 20;
    case 'VIEWER': return 10;
  }
}
