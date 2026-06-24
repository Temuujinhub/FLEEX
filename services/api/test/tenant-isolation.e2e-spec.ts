/**
 * Cross-tenant isolation regression suite (security audit R-5 / P5).
 *
 * The multi-tenant audit (docs/SECURITY-MULTI-TENANT-2026-06.md) verified by
 * hand that every tenant-scoped by-id endpoint rejects access to another
 * tenant's resource with HTTP 403, and that list endpoints are scoped to the
 * caller's company. This suite locks that behaviour in so a future refactor
 * that drops a `where: { companyId }` filter or an `ensureSameTenant()` check
 * fails CI instead of silently leaking data across tenants.
 *
 * It boots a real Nest app with the actual feature modules, the real JWT +
 * Roles guards and signed tokens, but mocks PrismaService / RedisService so it
 * needs no database or Redis and stays deterministic in CI. The mocks return a
 * resource owned by company B; the assertion is that company A's token can't
 * read it.
 */
import 'reflect-metadata';

// JwtStrategy reads JWT_SECRET at construction (and asserts it's strong), so it
// must be present before the testing module is compiled.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-only-jwt-secret-not-for-production-0123456789abcdef';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';

import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CommonModule } from '../src/common/common.module';
import { RedisService } from '../src/common/redis.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/auth/roles.guard';
import { DevicesModule } from '../src/devices/devices.module';
import { PositionsModule } from '../src/positions/positions.module';
import { MediaModule } from '../src/media/media.module';
import { TripsModule } from '../src/trips/trips.module';
import { EventsModule } from '../src/events/events.module';
import { NO_DRIVER_MATCH } from '../src/auth/actor-scope';

const COMPANY_A = '11111111-1111-1111-1111-111111111111';
const COMPANY_B = '22222222-2222-2222-2222-222222222222';
const DEVICE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TRIP_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const IMAGE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
// Two drivers within COMPANY_A, used for the DRIVER least-privilege tests.
const DRIVER_D1 = 'd1111111-1111-1111-1111-111111111111';
const DRIVER_D2 = 'd2222222-2222-2222-2222-222222222222';

// Per-resource Prisma mock. Each test sets the return value to a row owned by
// COMPANY_B (the "victim" tenant) and then hits the route with COMPANY_A's
// token.
const prisma = {
  device: { findUnique: jest.fn(), findMany: jest.fn() },
  trip: { findUnique: jest.fn(), findMany: jest.fn() },
  deviceImage: { findUnique: jest.fn(), findMany: jest.fn() },
  event: { findUnique: jest.fn(), findMany: jest.fn() },
  $queryRaw: jest.fn(),
};

// Redis is only used for online-state decoration / cache; stub it so nothing
// connects. clearMocks (jest.config) wipes call history but keeps these impls.
const redisPipeline = { exists: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) };
const redis = {
  client: {
    exists: jest.fn().mockResolvedValue(0),
    pipeline: jest.fn(() => redisPipeline),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
  },
  duplicate: jest.fn(),
};

let app: INestApplication;
const jwt = new JwtService();

function token(opts: { role?: Role; companyId?: string | null; driverId?: string | null } = {}): string {
  return jwt.sign(
    {
      sub: 'user-' + (opts.companyId ?? 'x'),
      email: 'user@example.com',
      role: opts.role ?? Role.COMPANY_ADMIN,
      companyId: opts.companyId === undefined ? COMPANY_A : opts.companyId,
      driverId: opts.driverId ?? null,
    },
    { secret: process.env.JWT_SECRET as string, algorithm: 'HS256', expiresIn: '15m' },
  );
}

// Company A admin (the attacker, in the cross-tenant tests).
const tokenA = () => token({ companyId: COMPANY_A });
// Super admin has no company and is allowed cross-company reads by design.
const tokenSuper = () => token({ role: Role.SUPER_ADMIN, companyId: null });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      PassportModule,
      PrismaModule,
      CommonModule,
      DevicesModule,
      PositionsModule,
      MediaModule,
      TripsModule,
      EventsModule,
    ],
    providers: [
      JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(RedisService)
    .useValue(redis)
    .compile();

  app = moduleRef.createNestApplication();
  // Mirror production bootstrap so routes/validation behave identically.
  app.setGlobalPrefix('api', { exclude: ['health', '/'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

const http = () => request(app.getHttpServer());

describe('Auth gate (proves 403s below come from tenant logic, not a blanket deny)', () => {
  it('rejects a request with no token (401)', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_A, imei: '123' });
    await http().get(`/api/devices/${DEVICE_ID}`).expect(401);
  });

  it('rejects a token signed with the wrong secret (401)', async () => {
    const forged = jwt.sign(
      { sub: 'u', email: 'e', role: Role.COMPANY_ADMIN, companyId: COMPANY_A },
      { secret: 'a-different-secret-that-is-also-long-enough-1234567890', algorithm: 'HS256' },
    );
    await http().get(`/api/devices/${DEVICE_ID}`).set('Authorization', `Bearer ${forged}`).expect(401);
  });
});

describe('Devices', () => {
  it('GET /devices/:id — tenant A cannot read tenant B device (403)', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_B, imei: '123' });
    await http().get(`/api/devices/${DEVICE_ID}`).set('Authorization', `Bearer ${tokenA()}`).expect(403);
  });

  it('GET /devices/:id — same-tenant read succeeds (200)', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_A, imei: '123' });
    await http().get(`/api/devices/${DEVICE_ID}`).set('Authorization', `Bearer ${tokenA()}`).expect(200);
  });

  it('GET /devices/:id — SUPER_ADMIN may read across tenants (200)', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_B, imei: '123' });
    await http().get(`/api/devices/${DEVICE_ID}`).set('Authorization', `Bearer ${tokenSuper()}`).expect(200);
  });

  it('GET /devices — list is scoped to the caller company', async () => {
    prisma.device.findMany.mockResolvedValue([]);
    await http().get('/api/devices').set('Authorization', `Bearer ${tokenA()}`).expect(200);
    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_A }) }),
    );
  });
});

describe('Trips', () => {
  it('GET /trips/:id — tenant A cannot read tenant B trip (403)', async () => {
    prisma.trip.findUnique.mockResolvedValue({ id: TRIP_ID, companyId: COMPANY_B });
    await http().get(`/api/trips/${TRIP_ID}`).set('Authorization', `Bearer ${tokenA()}`).expect(403);
  });

  it('GET /trips/:id — same-tenant read succeeds (200)', async () => {
    prisma.trip.findUnique.mockResolvedValue({ id: TRIP_ID, companyId: COMPANY_A });
    await http().get(`/api/trips/${TRIP_ID}`).set('Authorization', `Bearer ${tokenA()}`).expect(200);
  });

  it('GET /trips — list is scoped to the caller company', async () => {
    prisma.trip.findMany.mockResolvedValue([]);
    await http().get('/api/trips').set('Authorization', `Bearer ${tokenA()}`).expect(200);
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_A }) }),
    );
  });
});

describe('Positions history', () => {
  const range = 'from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z';

  it('GET /positions/:deviceId/history — tenant A blocked on tenant B device (403)', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_B });
    await http()
      .get(`/api/positions/${DEVICE_ID}/history?${range}`)
      .set('Authorization', `Bearer ${tokenA()}`)
      .expect(403);
    // The raw position query must never run once the tenant check fails.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('GET /positions/:deviceId/history — same-tenant read succeeds (200)', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_A });
    prisma.$queryRaw.mockResolvedValue([]);
    await http()
      .get(`/api/positions/${DEVICE_ID}/history?${range}`)
      .set('Authorization', `Bearer ${tokenA()}`)
      .expect(200);
  });
});

describe('Media', () => {
  it('GET /media/:id/file — tenant A cannot stream tenant B media (403)', async () => {
    prisma.deviceImage.findUnique.mockResolvedValue({
      companyId: COMPANY_B,
      fileName: 'b.jpg',
      kind: 'photo',
    });
    await http().get(`/api/media/${IMAGE_ID}/file`).set('Authorization', `Bearer ${tokenA()}`).expect(403);
  });

  it('GET /devices/:deviceId/images — tenant A blocked on tenant B device (403)', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, imei: '123', companyId: COMPANY_B });
    await http()
      .get(`/api/devices/${DEVICE_ID}/images`)
      .set('Authorization', `Bearer ${tokenA()}`)
      .expect(403);
  });

  it('GET /devices/:deviceId/images — same-tenant list succeeds (200)', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, imei: '123', companyId: COMPANY_A });
    prisma.deviceImage.findMany.mockResolvedValue([]);
    await http()
      .get(`/api/devices/${DEVICE_ID}/images`)
      .set('Authorization', `Bearer ${tokenA()}`)
      .expect(200);
  });
});

// P2: a DRIVER is scoped to their own assigned vehicle(s) within their tenant.
// All resources below belong to COMPANY_A; the distinction is the assigned
// driver (DRIVER_D1 = self, DRIVER_D2 = a peer in the same company).
describe('DRIVER least-privilege (P2)', () => {
  const driverTok = (driverId: string | null) =>
    token({ role: Role.DRIVER, companyId: COMPANY_A, driverId });

  describe('devices', () => {
    it('GET /devices/:id — driver reads own assigned vehicle (200)', async () => {
      prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_A, driverId: DRIVER_D1, imei: '1' });
      await http().get(`/api/devices/${DEVICE_ID}`).set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`).expect(200);
    });

    it("GET /devices/:id — driver blocked on a peer driver's vehicle (403)", async () => {
      prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_A, driverId: DRIVER_D2, imei: '1' });
      await http().get(`/api/devices/${DEVICE_ID}`).set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`).expect(403);
    });

    it("GET /devices — list is scoped to the driver's own vehicles", async () => {
      prisma.device.findMany.mockResolvedValue([]);
      await http().get('/api/devices').set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`).expect(200);
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_A, driverId: DRIVER_D1 }) }),
      );
    });

    it('GET /devices — an unlinked driver sees nothing (fail closed)', async () => {
      prisma.device.findMany.mockResolvedValue([]);
      await http().get('/api/devices').set('Authorization', `Bearer ${driverTok(null)}`).expect(200);
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_A, driverId: NO_DRIVER_MATCH }) }),
      );
    });
  });

  describe('trips', () => {
    it("GET /trips/:id — driver blocked on a peer driver's trip (403)", async () => {
      prisma.trip.findUnique.mockResolvedValue({ id: TRIP_ID, companyId: COMPANY_A, driverId: DRIVER_D2 });
      await http().get(`/api/trips/${TRIP_ID}`).set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`).expect(403);
    });

    it('GET /trips/:id — driver reads own trip (200)', async () => {
      prisma.trip.findUnique.mockResolvedValue({ id: TRIP_ID, companyId: COMPANY_A, driverId: DRIVER_D1 });
      await http().get(`/api/trips/${TRIP_ID}`).set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`).expect(200);
    });

    it('GET /trips?driverId=peer — driver scope overrides the query param', async () => {
      prisma.trip.findMany.mockResolvedValue([]);
      await http()
        .get(`/api/trips?driverId=${DRIVER_D2}`)
        .set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`)
        .expect(200);
      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_A, driverId: DRIVER_D1 }) }),
      );
    });
  });

  describe('positions history', () => {
    const range = 'from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z';

    it('GET /positions/:deviceId/history — driver blocked on a peer vehicle (403)', async () => {
      prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_A, driverId: DRIVER_D2 });
      await http()
        .get(`/api/positions/${DEVICE_ID}/history?${range}`)
        .set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`)
        .expect(403);
    });

    it('GET /positions/:deviceId/history — driver reads own vehicle (200)', async () => {
      prisma.device.findUnique.mockResolvedValue({ id: DEVICE_ID, companyId: COMPANY_A, driverId: DRIVER_D1 });
      prisma.$queryRaw.mockResolvedValue([]);
      await http()
        .get(`/api/positions/${DEVICE_ID}/history?${range}`)
        .set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`)
        .expect(200);
    });
  });

  describe('events', () => {
    it("GET /events — list is restricted to the driver's own devices", async () => {
      prisma.device.findMany.mockResolvedValue([{ id: DEVICE_ID }]);
      prisma.event.findMany.mockResolvedValue([]);
      await http().get('/api/events').set('Authorization', `Bearer ${driverTok(DRIVER_D1)}`).expect(200);
      // First resolves the driver's own device ids (scoped by driverId)…
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_A, driverId: DRIVER_D1 }) }),
      );
      // …then filters events to exactly those device ids.
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deviceId: { in: [DEVICE_ID] } }) }),
      );
    });
  });
});
