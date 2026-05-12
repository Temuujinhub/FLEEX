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
    const user = await this.prisma.user.findUnique({ where: { email } });

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
      const failed = user.failedLogins + 1;
      const lock = failed >= FAIL_THRESHOLD
        ? new Date(Date.now() + LOCK_MINUTES * 60_000)
        : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil: lock ?? undefined,
          status: lock ? 'LOCKED' : user.status,
        },
      });
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
        role: user.role,
        companyId: user.companyId,
      },
    };
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
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
