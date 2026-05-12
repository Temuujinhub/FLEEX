import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Runs once after Nest finishes wiring everything. Idempotent: if an active
// SUPER_ADMIN already exists, we leave the database alone.
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    const email = this.config.get<string>('BOOTSTRAP_ADMIN_EMAIL');
    const password = this.config.get<string>('BOOTSTRAP_ADMIN_PASSWORD');
    const companyName = this.config.get<string>('BOOTSTRAP_ADMIN_COMPANY') ?? 'Fleex';
    if (!email || !password) return;

    const existing = await this.prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (existing) {
      this.logger.log('Super admin present, skipping bootstrap');
      return;
    }

    const company = await this.prisma.company.upsert({
      where: { slug: slugify(companyName) },
      update: {},
      create: {
        name: companyName,
        slug: slugify(companyName),
        contactEmail: email,
      },
    });

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: 'Fleex Administrator',
        role: 'SUPER_ADMIN',
        companyId: company.id,
      },
    });

    await this.audit.record({
      actorId: null,
      actorEmail: 'system',
      action: 'system.bootstrap',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'success',
      after: { email, role: 'SUPER_ADMIN' },
    });
    this.logger.warn(`Bootstrap SUPER_ADMIN created for ${email} – change the password immediately.`);
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'fleex';
}
