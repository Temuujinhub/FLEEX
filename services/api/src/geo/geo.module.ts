import {
  Module,
  Controller,
  Get,
  Query,
  Req,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

type Actor = { role: Role; companyId: string | null };

// Reverse geocoding. Two layers:
//   1. Nearest named Place (tenant data) — always on, no external dependency.
//      For a mine, "Жинлүүр-2 (120 m)" is more useful than a street address.
//   2. Street address via an external geocoder (Nominatim) — opt-in
//      (GEOCODING_ENABLED), cached in Redis to respect the provider's rate
//      limit. Self-host Nominatim for production volume.
@Injectable()
class GeoService {
  private readonly enabled: boolean;
  private readonly nominatimUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('GEOCODING_ENABLED') === 'true';
    this.nominatimUrl =
      config.get<string>('NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org/reverse';
  }

  async reverse(actor: Actor, lat: number, lng: number) {
    const place = await this.nearestPlace(actor, lat, lng);
    const address = this.enabled ? await this.reverseGeocode(lat, lng) : null;
    return { lat, lng, place, address };
  }

  private async nearestPlace(actor: Actor, lat: number, lng: number) {
    const where = actor.role === 'SUPER_ADMIN' ? {} : { companyId: actor.companyId ?? undefined };
    const places = await this.prisma.place.findMany({
      where,
      select: { id: true, name: true, type: true, latitude: true, longitude: true },
    });
    let best: { id: string; name: string; type: string; distanceKm: number } | null = null;
    for (const p of places) {
      if (p.latitude == null || p.longitude == null) continue;
      const km = haversineKm(lat, lng, p.latitude, p.longitude);
      if (!best || km < best.distanceKm) {
        best = { id: p.id, name: p.name, type: p.type, distanceKm: km };
      }
    }
    // Only meaningful when reasonably close (5 km).
    if (!best || best.distanceKm > 5) return null;
    return { ...best, distanceKm: Math.round(best.distanceKm * 1000) / 1000 };
  }

  private async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    // Round to ~11 m so nearby points share a cache entry (and we don't hammer
    // the geocoder). Empty-string cache value = "looked up, no result".
    const key = `geo:rev:${lat.toFixed(4)},${lng.toFixed(4)}`;
    try {
      const cached = await this.redis.client.get(key);
      if (cached !== null) return cached || null;
    } catch {
      /* cache miss path */
    }
    try {
      const url = `${this.nominatimUrl}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&accept-language=mn`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Fleex/1.0 (+https://fleex.mn)' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { display_name?: string };
      const addr = j?.display_name ?? null;
      try {
        await this.redis.client.set(key, addr ?? '', 'EX', 30 * 24 * 3600);
      } catch {
        /* non-fatal */
      }
      return addr;
    } catch {
      return null;
    }
  }
}

@Controller('geo')
@Roles(Role.VIEWER)
class GeoController {
  constructor(private readonly svc: GeoService) {}

  // GET /api/geo/reverse?lat=..&lng=.. → { place, address }
  @Get('reverse')
  reverse(@Query('lat') lat: string, @Query('lng') lng: string, @Req() req: any) {
    const la = Number.parseFloat(lat);
    const ln = Number.parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
      throw new BadRequestException('Invalid lat/lng');
    }
    return this.svc.reverse(req.user, la, ln);
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

@Module({
  controllers: [GeoController],
  providers: [GeoService],
})
export class GeoModule {}
