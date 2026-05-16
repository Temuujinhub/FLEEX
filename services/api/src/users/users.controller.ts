import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength, IsUUID } from 'class-validator';
import { Role, UserStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsEnum(Role) role!: Role;
  @IsOptional() @IsUUID() companyId?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}

class ResetPasswordDto {
  @IsString() @MinLength(8) newPassword!: string;
}

class ChangeOwnPasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

class UpdateOwnProfileDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
}

@Controller('users')
@Roles(Role.COMPANY_ADMIN)
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get('me')
  @Roles(Role.VIEWER)
  me(@Req() req: any) {
    return this.svc.getMe(req.user.id);
  }

  @Patch('me')
  @Roles(Role.VIEWER)
  @Audit('user.update_self', { resourceType: 'user', captureResult: true })
  updateMe(@Body() dto: UpdateOwnProfileDto, @Req() req: any) {
    return this.svc.updateSelf(req.user.id, dto);
  }

  @Post('me/change-password')
  @Roles(Role.VIEWER)
  @Audit('user.change_password_self', { resourceType: 'user' })
  changeOwnPassword(@Body() dto: ChangeOwnPasswordDto, @Req() req: any) {
    return this.svc.changeOwnPassword(req.user.id, dto.currentPassword, dto.newPassword);
  }

  @Get()
  @Audit('user.list')
  list(@Req() req: any) {
    return this.svc.list(req.user);
  }

  @Get(':id')
  @Audit('user.read', { resourceType: 'user', resourceIdParam: 'id' })
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, req.user);
  }

  @Post()
  @Audit('user.create', { resourceType: 'user', captureResult: true })
  create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  @Audit('user.update', { resourceType: 'user', resourceIdParam: 'id', captureResult: true })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) {
    return this.svc.update(id, req.user, dto);
  }

  @Post(':id/reset-password')
  @Audit('user.reset_password', { resourceType: 'user', resourceIdParam: 'id' })
  reset(@Param('id') id: string, @Body() dto: ResetPasswordDto, @Req() req: any) {
    return this.svc.resetPassword(id, dto.newPassword, req.user);
  }

  @Delete(':id')
  @Audit('user.delete', { resourceType: 'user', resourceIdParam: 'id' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user);
  }
}
