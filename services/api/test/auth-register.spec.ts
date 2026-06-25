// Self-serve company signup + auto-trial provisioning.
import { ConflictException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';

function make(overrides: any = {}) {
  const captured: any = { sub: null };
  const tx = {
    company: { create: async (a: any) => ({ id: 'co1', name: a.data.name, slug: a.data.slug }) },
    user: { create: async (a: any) => ({ id: 'u1', ...a.data }) },
    subscription: { create: async (a: any) => { captured.sub = a.data; return a.data; } },
  };
  const prisma = {
    user: { findUnique: async () => overrides.existingUser ?? null },
    company: { findUnique: async () => null }, // slug always free
    $transaction: async (fn: any) => fn(tx),
    refreshToken: { create: async () => ({}) },
  };
  const jwt = { signAsync: async () => 'access.jwt' };
  const config = { get: () => undefined };
  const audit = { record: async () => undefined };
  const redis = { client: {} };
  const svc = new AuthService(prisma as any, jwt as any, config as any, audit as any, redis as any);
  return { svc, captured };
}

const input = { companyName: 'Тест ХХК', fullName: 'Бат', email: 'BAT@Example.com', password: 'secret12', phone: '99112233' };

describe('AuthService.registerCompany', () => {
  it('provisions company + COMPANY_ADMIN + 14-day Starter trial and returns tokens', async () => {
    const { svc, captured } = make();
    const res: any = await svc.registerCompany(input);
    expect(res.accessToken).toBe('access.jwt');
    expect(res.refreshToken).toMatch(/^[0-9a-f]{96}$/); // 48 random bytes hex
    expect(res.user.email).toBe('bat@example.com'); // lowercased
    expect(res.user.role).toBe('COMPANY_ADMIN');
    expect(res.user.companyId).toBe('co1');
    // Auto-trial created on the Starter plan.
    expect(captured.sub).toMatchObject({ planKey: 'starter', status: 'TRIAL' });
    expect(captured.sub.trialEndsAt).toBeInstanceOf(Date);
    const days = Math.round((captured.sub.trialEndsAt.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(14);
  });

  it('rejects a duplicate email', async () => {
    const { svc } = make({ existingUser: { id: 'existing' } });
    await expect(svc.registerCompany(input)).rejects.toBeInstanceOf(ConflictException);
  });
});
