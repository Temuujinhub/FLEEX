import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.company.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async get(id: string) {
    const c = await this.prisma.company.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Company not found');
    return c;
  }

  create(data: { name: string; slug: string; contactEmail?: string; timezone?: string }) {
    return this.prisma.company.create({ data });
  }

  update(id: string, data: Partial<{ name: string; contactEmail: string; isActive: boolean; timezone: string }>) {
    return this.prisma.company.update({ where: { id }, data });
  }
}
