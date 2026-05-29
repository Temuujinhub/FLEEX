import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Idempotently seeds demo tenants (NOMIN MOTOR, OYU TOLGOI) plus one
// COMPANY_ADMIN per tenant. Gated by SEED_DEMO_COMPANIES=true so it never
// runs unless explicitly opted in. Upserts mean repeated runs are safe.
@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.get<string>('SEED_DEMO_COMPANIES') !== 'true') return;

    // Refuse to mint COMPANY_ADMIN accounts with a publicly-known password.
    // The committed .env.example default would otherwise be trivial takeover
    // of the demo tenants if the flag is ever enabled in production.
    const seedPassword = this.config.get<string>('SEED_DEMO_PASSWORD');
    if (!seedPassword || seedPassword === 'Fleex@2026') {
      this.logger.error(
        'SEED_DEMO_COMPANIES=true but SEED_DEMO_PASSWORD is unset or still the committed default — ' +
          'refusing to seed demo admins with a public password. Set a strong SEED_DEMO_PASSWORD.',
      );
      return;
    }
    const passwordHash = await argon2.hash(seedPassword, { type: argon2.argon2id });

    const tenants = [
      {
        slug: 'nomin-motor',
        name: 'NOMIN MOTOR',
        adminEmail: 'admin@nomin.fleex.mn',
        adminName: 'Nomin Motor Admin',
      },
      {
        slug: 'oyu-tolgoi',
        name: 'OYU TOLGOI',
        adminEmail: 'admin@ot.fleex.mn',
        adminName: 'Oyu Tolgoi Admin',
      },
    ];

    for (const t of tenants) {
      const company = await this.prisma.company.upsert({
        where: { slug: t.slug },
        update: { name: t.name },
        create: {
          slug: t.slug,
          name: t.name,
          contactEmail: t.adminEmail,
          timezone: 'Asia/Ulaanbaatar',
        },
      });

      const existing = await this.prisma.user.findUnique({ where: { email: t.adminEmail } });
      if (existing) {
        if (existing.companyId !== company.id) {
          await this.prisma.user.update({
            where: { id: existing.id },
            data: { companyId: company.id, role: 'COMPANY_ADMIN', status: 'ACTIVE' },
          });
        }
        continue;
      }

      const user = await this.prisma.user.create({
        data: {
          email: t.adminEmail,
          passwordHash,
          fullName: t.adminName,
          role: 'COMPANY_ADMIN',
          companyId: company.id,
          status: 'ACTIVE',
        },
      });

      await this.audit.record({
        actorId: null,
        actorEmail: 'system',
        companyId: company.id,
        action: 'system.demo_seed',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'success',
        after: { email: t.adminEmail, role: 'COMPANY_ADMIN', company: t.name },
      });

      this.logger.warn(
        `Demo tenant ready: ${t.name} → ${t.adminEmail} / ${seedPassword} (change immediately).`,
      );
    }
  }
}
