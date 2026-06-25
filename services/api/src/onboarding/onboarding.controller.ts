import { Controller, Get, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

// First-run onboarding helper: tells a new tenant exactly what to program into
// their GPS tracker so it dials Fleex — the server host, the per-protocol TCP
// port, and the carrier APN. The host/ports come from env so the values stay
// correct for whatever host the ingestor actually runs on; APN presets are
// static carrier knowledge (confirm with the SIM operator before relying on it).
//
// A device is "claimed" simply by creating it with its IMEI (the ingestor
// resolves devices by IMEI and drops unknown ones) — so the wizard reuses the
// normal POST /devices flow; this endpoint only provides the connection facts
// and whether the tenant has any device yet.

interface ProtocolPort { protocol: string; port: number; label: string }
interface ApnPreset { carrier: string; apn: string; note?: string }

// Known decoder ports in the gps-ingestor protocol registry. Teltonika's port is
// configurable (INGESTOR_TCP_PORT); Queclink's is the conventional +1.
const DEFAULT_TELTONIKA_PORT = 5027;
const DEFAULT_QUECLINK_PORT = 5028;

// Commonly-used data APNs for Mongolian mobile operators. These can differ per
// SIM plan, so the UI shows them as a starting point with a "confirm with your
// carrier" note rather than a guarantee.
const MN_APN_PRESETS: ApnPreset[] = [
  { carrier: 'Unitel', apn: 'unitel', note: 'M2M/IoT SIM дээр өөр байж болно' },
  { carrier: 'Mobicom', apn: 'mobinet', note: 'эсвэл "internet"' },
  { carrier: 'Skytel', apn: 'internet' },
  { carrier: 'G-Mobile', apn: 'internet' },
];

// FLEET_MANAGER floor — matches POST /devices, so whoever can add a device can
// also read the connection facts the wizard needs.
@Controller('onboarding')
@Roles(Role.FLEET_MANAGER)
export class OnboardingController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('connection')
  async connection(@Req() req: any) {
    const teltonikaPort = Number(this.config.get('INGESTOR_TCP_PORT')) || DEFAULT_TELTONIKA_PORT;
    const ports: ProtocolPort[] = [
      { protocol: 'teltonika', port: teltonikaPort, label: 'Teltonika (FMB, FMC, FMM…)' },
      { protocol: 'queclink', port: DEFAULT_QUECLINK_PORT, label: 'Queclink (GV, GL…)' },
    ];
    const companyId = req.user?.companyId ?? null;
    const deviceCount = companyId
      ? await this.prisma.device.count({ where: { companyId } }).catch(() => 0)
      : 0;

    return {
      serverHost: this.serverHost(),
      ports,
      apns: MN_APN_PRESETS,
      deviceCount,
    };
  }

  // The public address customers point their trackers at. Prefer an explicit
  // ONBOARDING_SERVER_HOST; otherwise derive the hostname from APP_URL; final
  // fallback is the product domain.
  private serverHost(): string {
    const explicit = this.config.get<string>('ONBOARDING_SERVER_HOST');
    if (explicit) return explicit.trim();
    const appUrl = this.config.get<string>('APP_URL');
    if (appUrl) {
      try {
        return new URL(appUrl).hostname;
      } catch {
        /* fall through */
      }
    }
    return 'fleex.mn';
  }
}
