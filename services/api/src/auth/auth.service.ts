import {
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
  ) {}

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

    const tokens = await this.issueTokens(user.id, user.email, user.role, user.companyId, ip, userAgent);

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
    // Rotate: revoke the old one and issue a new pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role,
      stored.user.companyId,
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
    ip?: string,
    userAgent?: string,
  ) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, role, companyId },
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

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function parseExpiryDays(s: string): number {
  const m = /^(\d+)d$/.exec(s);
  return m ? Number(m[1]) : 7;
}
