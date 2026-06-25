import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../common/redis.service';
import { NO_DRIVER_MATCH } from './actor-scope';

const FAIL_THRESHOLD = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  // Mints a single-use, short-lived (30s) ticket for the WebSocket upgrade so
  // the long-lived JWT never travels in the WS URL — where it would otherwise
  // be captured by nginx/proxy access logs and browser history (audit H-7 /
  // R-3). The ticket is stored in Redis and consumed exactly once (GETDEL) by
  // the gateway on connect.
  async createWsTicket(user: { id: string; role: string; companyId: string | null; driverId?: string | null }) {
    const ticket = randomBytes(32).toString('hex');
    const expiresIn = 30;
    const payload: { sub: string; role: string; companyId: string | null; deviceIds?: string[] } = {
      sub: user.id,
      role: user.role,
      companyId: user.companyId,
    };
    // DRIVER least-privilege (audit H3): embed the driver's assigned vehicle
    // ids so the WS gateway (which has no DB) can scope the live stream to
    // them. An unlinked driver gets an empty list → receives nothing.
    if (user.role === 'DRIVER') {
      const devs = await this.prisma.device.findMany({
        where: { companyId: user.companyId, driverId: user.driverId ?? NO_DRIVER_MATCH },
        select: { id: true },
      });
      payload.deviceIds = devs.map((d) => d.id);
    }
    await this.redis.client.set(`ws:ticket:${ticket}`, JSON.stringify(payload), 'EX', expiresIn);
    return { ticket, expiresIn };
  }

  // Self-serve signup: provisions a new tenant (Company + COMPANY_ADMIN user +
  // a 14-day Starter trial) and logs the user straight in. Public funnel — no
  // SUPER_ADMIN involvement — so it's rate-limited and the caller must accept
  // the terms (enforced in the DTO). Email uniqueness is global.
  private static readonly TRIAL_DAYS = 14;

  async registerCompany(
    input: { companyName: string; fullName: string; email: string; password: string; phone?: string },
    ip?: string,
    userAgent?: string,
  ) {
    const email = input.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException('Энэ имэйл аль хэдийн бүртгэлтэй байна.');

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const slug = await this.uniqueSlug(input.companyName);
    const now = new Date();
    const trialEnd = new Date(now.getTime() + AuthService.TRIAL_DAYS * 86_400_000);

    const created = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: input.companyName.trim(), slug } });
      const user = await tx.user.create({
        data: {
          companyId: company.id, email, passwordHash,
          fullName: input.fullName.trim(), phone: input.phone?.trim() || null,
          role: 'COMPANY_ADMIN', status: 'ACTIVE',
        },
      });
      // Auto-trial: Starter plan, TRIAL status, 14-day window.
      await tx.subscription.create({
        data: {
          companyId: company.id, planKey: 'starter', status: 'TRIAL',
          startedAt: now, trialEndsAt: trialEnd, currentPeriodEnd: trialEnd,
        },
      });
      return { company, user };
    });

    await this.audit.record({
      actorId: created.user.id, actorEmail: email, companyId: created.company.id,
      action: 'company.register', outcome: 'success', ipAddress: ip, userAgent,
    });

    const tokens = await this.issueTokens(created.user.id, email, 'COMPANY_ADMIN', created.company.id, null, ip, userAgent);
    return {
      ...tokens,
      user: {
        id: created.user.id, email, fullName: created.user.fullName, phone: created.user.phone,
        role: 'COMPANY_ADMIN', companyId: created.company.id,
        company: { id: created.company.id, name: created.company.name, slug: created.company.slug },
      },
    };
  }

  // Derives a unique URL-safe slug from the company name; ASCII-only (Cyrillic
  // names fall back to "co"), with a random suffix on collision.
  private async uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'co';
    for (let i = 0; i < 6; i++) {
      const candidate = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      const taken = await this.prisma.company.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!taken) return candidate;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { company: { select: { id: true, name: true, slug: true } } },
    });

    const auditFail = async (reason: string) => {
      await this.audit.record({
        actorEmail: email,
        action: 'user.login',
        outcome: 'failure',
        ipAddress: ip,
        userAgent,
        metadata: { reason },
      });
    };

    if (!user) {
      // Equalize timing with the known-user path so an attacker can't enumerate
      // accounts by measuring latency (audit M5): run a real Argon2id verify
      // against a throwaway hash before returning the identical failure.
      await dummyVerify(password);
      await auditFail('unknown_user');
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== 'ACTIVE') {
      await auditFail('inactive');
      throw new ForbiddenException('Account disabled');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await auditFail('locked');
      throw new ForbiddenException('Account temporarily locked');
    }

    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      // Atomic DB-side increment so concurrent failed attempts can't race and
      // under-count past the threshold.
      const { failedLogins } = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 } },
        select: { failedLogins: true },
      });
      if (failedLogins >= FAIL_THRESHOLD) {
        // Time-based lock only — never flip status to LOCKED here. The status
        // check runs before the lockedUntil check, so a status flip would
        // outlive lockedUntil and soft-lock the account permanently until an
        // admin reset. LOCKED status is reserved for deliberate admin disable.
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
        });
      }
      await auditFail('wrong_password');
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login: reset counters, mint tokens.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), status: 'ACTIVE' },
    });

    const tokens = await this.issueTokens(user.id, user.email, user.role, user.companyId, user.driverId, ip, userAgent);

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      companyId: user.companyId,
      action: 'user.login',
      outcome: 'success',
      ipAddress: ip,
      userAgent,
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        companyId: user.companyId,
        company: user.company,
      },
    };
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      // Replay of an already-rotated token signals theft: the legitimate
      // client already exchanged this token, so whoever is presenting it now
      // shouldn't be trusted. Revoke the whole family to force every session
      // for this user to re-authenticate.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        actorId: stored.userId,
        actorEmail: stored.user.email,
        companyId: stored.user.companyId,
        action: 'user.refresh_reuse',
        outcome: 'denied',
        ipAddress: ip,
        userAgent,
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    // Rotate atomically: only the request that flips revokedAt from null wins
    // and mints a new pair. A concurrent double-submit of the same token loses
    // the race (count 0) and is rejected without nuking the user's sessions.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role,
      stored.user.companyId,
      stored.user.driverId,
      ip,
      userAgent,
    );
  }

  async logout(refreshToken: string, userId?: string) {
    const tokenHash = sha256(refreshToken);
    await this.prisma.refreshToken
      .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
    if (userId) {
      await this.audit.record({ actorId: userId, action: 'user.logout', outcome: 'success' });
    }
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: string,
    companyId: string | null,
    driverId: string | null,
    ip?: string,
    userAgent?: string,
  ) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, role, companyId, driverId },
      { expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? '15m' },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const expiresInDays = parseExpiryDays(
      this.config.get<string>('REFRESH_TOKEN_EXPIRES_IN') ?? '7d',
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        userAgent,
        ipAddress: ip,
        expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
      },
    });
    return { accessToken, refreshToken };
  }
}

// Lazily-computed throwaway Argon2id hash used to equalize login timing for
// unknown emails (so the no-such-user path costs ~the same as a wrong-password
// verify). Computed once on first use; subsequent calls are a plain verify.
let dummyHashPromise: Promise<string> | null = null;
async function dummyVerify(password: string): Promise<void> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('fleex-timing-equalizer', { type: argon2.argon2id });
  }
  const h = await dummyHashPromise;
  await argon2.verify(h, password).catch(() => false);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function parseExpiryDays(s: string): number {
  const m = /^(\d+)d$/.exec(s);
  return m ? Number(m[1]) : 7;
}
