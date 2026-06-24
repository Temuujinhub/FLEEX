// Lightweight, mobile-first fleet summary ("Хөнгөн харагдац").
//
// Built for the common case the full operator console is overkill for: an
// owner with a handful of vehicles who just wants, on their phone, to see
// where each truck is, how far it drove, how much fuel is left, and whether
// anything is wrong. It deliberately renders NO map (Leaflet is the heaviest
// chunk in the app) and leans on three cheap endpoints:
//
//   • GET /devices            — snapshot per vehicle (online, speed, odo…)
//   • GET /positions/summary  — per-device distance roll-up in ONE request
//   • GET /sensors            — to read each device's FUEL_LEVEL last value
//   • GET /events             — a compact recent-alert feed
//
// Tenant isolation is the API's job (every endpoint scopes by the caller's
// companyId); this page only ever asks for "my" data.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, clearTokens } from '../lib/api';
import { useAuth } from '../store/auth';
import * as Icon from '../components/icons';

type Period = 'today' | 'week';

export function MobileSummary() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('today');

  const range = useMemo(() => {
    const now = new Date();
    const start =
      period === 'today'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : new Date(Date.now() - 6 * 86400_000);
    return { from: start.toISOString(), to: now.toISOString() };
  }, [period]);

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
    refetchInterval: 30_000,
  });
  const summary = useQuery({
    queryKey: ['positions-summary', range.from, range.to],
    queryFn: () =>
      api.get(`/positions/summary?from=${range.from}&to=${range.to}`).then((r) => r.data),
    refetchInterval: 60_000,
  });
  const sensors = useQuery({
    queryKey: ['sensors', 'all'],
    queryFn: () => api.get('/sensors').then((r) => r.data),
    refetchInterval: 60_000,
  });
  const events = useQuery({
    queryKey: ['events', 'recent', 'mobile'],
    queryFn: () => api.get('/events?limit=8&ack=false').then((r) => r.data.items),
    refetchInterval: 30_000,
  });

  const list: any[] = devices.data ?? [];
  const evts: any[] = events.data ?? [];

  // distance per device for the chosen period
  const distById = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of summary.data ?? []) m.set(r.deviceId, r.distanceKm ?? 0);
    return m;
  }, [summary.data]);

  // newest FUEL_LEVEL sensor reading per device
  const fuelById = useMemo(() => {
    const m = new Map<string, { value: number; unit: string | null }>();
    for (const s of sensors.data ?? []) {
      if (s.type !== 'FUEL_LEVEL' || s.lastValue == null) continue;
      m.set(s.deviceId, { value: Number(s.lastValue), unit: s.unit ?? null });
    }
    return m;
  }, [sensors.data]);

  const online = list.filter((d) => d.online).length;
  const totalDistance = useMemo(
    () => (summary.data ?? []).reduce((a: number, r: any) => a + (r.distanceKm ?? 0), 0),
    [summary.data],
  );

  const loading = devices.isLoading;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
              <Icon.Smartphone className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <div className="text-base font-extrabold tracking-tight">Fleex</div>
              <div className="-mt-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                {t('mobile.tagline', 'Хөнгөн харагдац')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              to="/app"
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500"
              title={t('mobile.fullConsole', 'Бүрэн самбар')}
            >
              {t('mobile.fullConsole', 'Бүрэн самбар')}
            </Link>
            <button
              type="button"
              onClick={() => {
                clearTokens();
                setUser(null);
                navigate('/login');
              }}
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label={t('common.logout', 'Гарах')}
            >
              <Icon.Power className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 pb-12 pt-4">
        {/* Greeting */}
        <div>
          <div className="text-xs uppercase tracking-widest text-brand-700/80">
            {greeting()} {user?.fullName?.split(' ')[0] ?? ''}
          </div>
          <h1 className="mt-0.5 text-2xl font-bold">{user?.company?.name ?? t('mobile.myFleet', 'Миний флот')}</h1>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label={t('mobile.vehicles', 'Машин')}
            value={list.length}
            icon={<Icon.Truck />}
            tint="slate"
          />
          <StatTile
            label={t('mobile.online', 'Онлайн')}
            value={`${online}/${list.length || 0}`}
            icon={<Icon.Signal />}
            tint="emerald"
          />
          <StatTile
            label={period === 'today' ? t('mobile.distToday', 'Өнөөдрийн зам') : t('mobile.distWeek', '7 хоногийн зам')}
            value={`${fmtKm(totalDistance)} км`}
            icon={<Icon.Route />}
            tint="brand"
            loading={summary.isLoading}
          />
          <StatTile
            label={t('mobile.alerts', 'Дохиолол')}
            value={evts.length}
            icon={<Icon.AlertTriangle />}
            tint={evts.some((e) => e.severity === 'CRITICAL') ? 'rose' : evts.length ? 'amber' : 'slate'}
          />
        </div>

        {/* Period toggle */}
        <div
          className="inline-flex w-full rounded-xl border border-slate-200 bg-white p-1"
          role="group"
          aria-label={t('mobile.period', 'Хугацаа')}
        >
          {(['today', 'week'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={
                'flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ' +
                (period === p ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50')
              }
            >
              {p === 'today' ? t('mobile.today', 'Өнөөдөр') : t('mobile.week', '7 хоног')}
            </button>
          ))}
        </div>

        {/* Device cards */}
        <section className="space-y-3">
          {loading && (
            <>
              <CardSkeleton />
              <CardSkeleton />
            </>
          )}
          {!loading && list.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-400">
              {t('mobile.noVehicles', 'Бүртгэгдсэн машин алга')}
            </div>
          )}
          {!loading &&
            list.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                distanceKm={distById.get(d.id) ?? 0}
                fuel={fuelById.get(d.id)}
              />
            ))}
        </section>

        {/* Recent alerts */}
        {evts.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-semibold">{t('mobile.recentAlerts', 'Сүүлийн дохиоллууд')}</div>
              <Link to="/app/events" className="text-xs font-medium text-brand-700 hover:underline">
                {t('mobile.all', 'Бүгд')} →
              </Link>
            </header>
            <ul className="divide-y divide-slate-100">
              {evts.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span
                    className={
                      'h-2 w-2 shrink-0 rounded-full ' +
                      (e.severity === 'CRITICAL'
                        ? 'bg-rose-500'
                        : e.severity === 'WARNING'
                          ? 'bg-amber-500'
                          : 'bg-sky-500')
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{prettyEventType(e.type)}</span>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="pt-2 text-center text-[11px] text-slate-400">
          fleex.mn · {new Date().toLocaleDateString('mn-MN')}
        </p>
      </main>
    </div>
  );
}

// ── Device card ───────────────────────────────────────────────
function DeviceCard({
  device: d,
  distanceKm,
  fuel,
}: {
  device: any;
  distanceKm: number;
  fuel?: { value: number; unit: string | null };
}) {
  const { t } = useTranslation();
  const color: string = d.color || '#1670f1';
  const fuelPct = computeFuelPct(fuel, d.tankCapacityL);

  return (
    <Link
      to={`/app/history/${d.id}`}
      className="block rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {/* header */}
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: hexAlpha(color, 0.12), color }}
        >
          <VehicleIcon type={d.vehicleType} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-tight">{d.name}</div>
          <div className="truncate text-xs text-slate-500">
            {d.plateNumber || t('mobile.noPlate', '— дугааргүй —')}
            {d.driver?.fullName ? ` · ${d.driver.fullName}` : ''}
          </div>
        </div>
        <span
          className={
            'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ' +
            (d.online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')
          }
        >
          <span className={'h-1.5 w-1.5 rounded-full ' + (d.online ? 'bg-emerald-500' : 'bg-slate-400')} />
          {d.online ? t('mobile.onlineShort', 'Онлайн') : t('mobile.offlineShort', 'Офлайн')}
        </span>
      </div>

      {/* fuel gauge ("түлшний үлдэгдэл") */}
      {fuelPct != null && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-500">
              <Icon.Fuel className="h-3.5 w-3.5" />
              {t('mobile.fuel', 'Түлшний үлдэгдэл')}
            </span>
            <span className="font-semibold tabular-nums text-slate-700">
              {Math.round(fuelPct)}%
              {fuel?.unit === 'L' || fuel?.unit === 'л'
                ? ` · ${fmtKm(fuel.value)} ${fuel.unit}`
                : ''}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={
                'h-full rounded-full transition-all ' +
                (fuelPct < 15 ? 'bg-rose-500' : fuelPct < 30 ? 'bg-amber-500' : 'bg-emerald-500')
              }
              style={{ width: `${Math.max(2, Math.min(100, fuelPct))}%` }}
            />
          </div>
        </div>
      )}

      {/* stats */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
        <Metric label={t('mobile.distance', 'Явсан зам')} value={`${fmtKm(distanceKm)}`} unit="км" />
        <Metric label={t('mobile.speed', 'Хурд')} value={`${Math.round(d.lastSpeed ?? 0)}`} unit="км/ц" />
        <Metric
          label={t('mobile.odometer', 'Гүйлт')}
          value={d.odometerKm != null ? fmtKm(d.odometerKm) : '—'}
          unit={d.odometerKm != null ? 'км' : ''}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          {t('mobile.lastSeen', 'Сүүлд')}: {d.lastSeenAt ? timeAgo(d.lastSeenAt) : '—'}
        </span>
        <span className="flex items-center gap-1 font-medium text-brand-700">
          {t('mobile.viewRoute', 'Маршрут')} <Icon.ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

// ── small pieces ──────────────────────────────────────────────
function StatTile({
  label,
  value,
  icon,
  tint,
  loading,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tint: 'slate' | 'emerald' | 'brand' | 'amber' | 'rose';
  loading?: boolean;
}) {
  const tints: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <span className="text-[11px] uppercase tracking-widest text-slate-500">{label}</span>
        <span className={'grid h-7 w-7 place-items-center rounded-lg ' + tints[tint]}>
          <span className="h-3.5 w-3.5">{icon}</span>
        </span>
      </div>
      <div className="mt-2 text-2xl font-extrabold tabular-nums">
        {loading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-slate-100" /> : value}
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="text-sm font-bold tabular-nums">
        {value}
        {unit ? <span className="ml-0.5 text-[10px] font-normal text-slate-400">{unit}</span> : null}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="h-2 w-1/3 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
      <div className="mt-4 h-2 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

function VehicleIcon({ type, className }: { type?: string; className?: string }) {
  switch (type) {
    case 'BUS':
      return <Icon.Bus className={className} />;
    case 'SEDAN':
    case 'PICKUP':
      return <Icon.Car className={className} />;
    case 'VAN':
      return <Icon.Box className={className} />;
    default:
      // Haul/dump trucks, excavators, dozers, tankers… all read as "truck".
      return <Icon.Truck className={className} />;
  }
}

// ── helpers ───────────────────────────────────────────────────
function computeFuelPct(
  fuel: { value: number; unit: string | null } | undefined,
  tankCapacityL?: number | null,
): number | null {
  if (!fuel || !Number.isFinite(fuel.value)) return null;
  const unit = (fuel.unit ?? '').toLowerCase();
  if (unit === '%' || unit === 'pct' || unit === 'percent') return clamp(fuel.value, 0, 100);
  if ((unit === 'l' || unit === 'л') && tankCapacityL && tankCapacityL > 0) {
    return clamp((fuel.value / tankCapacityL) * 100, 0, 100);
  }
  // Unit unknown but a tank size is configured → treat value as litres.
  if (tankCapacityL && tankCapacityL > 0) return clamp((fuel.value / tankCapacityL) * 100, 0, 100);
  return null;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function fmtKm(n: number) {
  if (!Number.isFinite(n)) return '0';
  return n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1);
}

function hexAlpha(hex: string, alpha: number) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(22,112,241,${alpha})`;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}с`;
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ц`;
  return `${Math.floor(diff / 86400)} өдөр`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Сайн шөнө,';
  if (h < 12) return 'Өглөөний мэнд,';
  if (h < 18) return 'Өдрийн мэнд,';
  return 'Оройн мэнд,';
}

function prettyEventType(tp: string) {
  const m: Record<string, string> = {
    PANIC: 'Panic товч',
    OVERSPEED: 'Хурд хэтрэлт',
    HARSH_ACCEL: 'Огцом хурдсалт',
    HARSH_BRAKE: 'Ширүүн тоормосолт',
    HARSH_CORNER: 'Огцом эргэлт',
    GEOFENCE_ENTER: 'Бүсэд орлоо',
    GEOFENCE_EXIT: 'Бүсээс гарлаа',
    IGNITION_ON: 'Хөдөлгүүр асав',
    IGNITION_OFF: 'Хөдөлгүүр унтрав',
    IDLE_START: 'Сул зогсолт',
    IDLE_END: 'Зогсолт дуусав',
    POWER_CUT: 'Цахилгаан тасрав',
    LOW_BATTERY: 'Батарей багав',
    DEVICE_OFFLINE: 'Офлайн боллоо',
    DEVICE_ONLINE: 'Онлайн боллоо',
    TAMPER: 'Tamper · хөндөлт',
  };
  return m[tp] ?? tp;
}
