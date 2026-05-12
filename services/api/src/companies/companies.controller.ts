import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { CompaniesService } from './companies.service';

class CreateCompanyDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(2) slug!: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() timezone?: string;
}

class UpdateCompanyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() timezone?: string;
}

@Controller('companies')
@Roles(Role.SUPER_ADMIN)
export class CompaniesController {
  constructor(private readonly svc: CompaniesService) {}

  @Get()
  @Audit('company.list')
  list() {
    return this.svc.list();
  }

  @Get(':id')
  @Audit('company.read', { resourceType: 'company', resourceIdParam: 'id' })
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @Audit('company.create', { resourceType: 'company', captureResult: true })
  create(@Body() dto: CreateCompanyDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @Audit('company.update', { resourceType: 'company', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.svc.update(id, dto);
  }
}
