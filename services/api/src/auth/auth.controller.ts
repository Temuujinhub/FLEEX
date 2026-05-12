import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
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

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ login: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.email, dto.password, ipOf(req), req.headers['user-agent']);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: any) {
    return this.auth.refresh(dto.refreshToken, ipOf(req), req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Body() dto: RefreshDto, @Req() req: any) {
    return this.auth.logout(dto.refreshToken, req.user?.id);
  }
}

function ipOf(req: any): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip;
}
