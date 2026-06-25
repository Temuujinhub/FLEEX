import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Equals, IsBoolean, IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}

class RefreshDto {
  @IsString() refreshToken!: string;
}

class RegisterCompanyDto {
  @IsString() @Length(2, 80) companyName!: string;
  @IsString() @Length(2, 80) fullName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(100) password!: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsBoolean() @Equals(true, { message: 'Үйлчилгээний нөхцөл, нууцлалын бодлогыг зөвшөөрнө үү.' }) acceptedTerms!: boolean;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ login: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.email, dto.password, ipOf(req), req.headers['user-agent']);
  }

  // Self-serve tenant signup → creates the company, its first COMPANY_ADMIN and
  // a 14-day Starter trial, and returns tokens (auto-login). Tightly rate-
  // limited per IP to curb signup spam.
  @Public()
  @Throttle({ login: { limit: 5, ttl: 60_000 } })
  @Post('register-company')
  async registerCompany(@Body() dto: RegisterCompanyDto, @Req() req: any) {
    return this.auth.registerCompany(dto, ipOf(req), req.headers['user-agent']);
  }

  @Public()
  // Dedicated per-IP cap so refresh-token replay/abuse can't ride the broad
  // 300/min default bucket (audit L2). Tokens are 48-byte random (unguessable),
  // so this bounds volume, not guessing.
  @Throttle({ medium: { limit: 60, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: any) {
    return this.auth.refresh(dto.refreshToken, ipOf(req), req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Body() dto: RefreshDto, @Req() req: any) {
    return this.auth.logout(dto.refreshToken, req.user?.id);
  }

  // Exchanges the caller's JWT for a single-use, 30s WebSocket ticket so the
  // JWT never appears in the WS URL / access logs (audit H-7 / R-3).
  @UseGuards(JwtAuthGuard)
  @Post('ws-ticket')
  wsTicket(@Req() req: any) {
    return this.auth.createWsTicket(req.user);
  }
}

// With `trust proxy` set in main.ts, Express resolves req.ip from the
// nginx-set X-Forwarded-For to the real client. Never parse the raw header
// here — its leftmost value is client-controlled and spoofable.
function ipOf(req: any): string | undefined {
  return req.ip;
}
