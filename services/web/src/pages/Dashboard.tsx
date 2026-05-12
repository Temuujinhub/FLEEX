import { useQuery } from '@tanstack/react-query';
import { ReactNode, useMemo } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

// Mining-flavored ops dashboard. Pulls live device + recent-event data
// and projects a handful of fleet KPIs on top. Chartlets are pure SVG so
// we don't pull a charting dep into the bundle.

export function Dashboard() {
  const user = useAuth((s) => s.user);

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
    refetchInterval: 30_000,
  });
  const events = useQuery({
    queryKey: ['events', 'recent'],
    queryFn: () => api.get('/events?limit=12&ack=false').then((r) => r.data.items),
    refetchInterval: 20_000,
  });

  const list: any[] = devices.data ?? [];
  const evts: any[] = events.data ?? [];
  const online = list.filter((d) => d.online).length;
  const offline = list.length - online;
  const movingNow = list.filter((d) => (d.lastSpeed ?? 0) > 1).length;
  const critical = evts.filter((e) => e.severity === 'CRITICAL').length;

  // Last-24h alert distribution by hour, used by the spark bar chart.
  const sparkBars = useMemo(() => buildHourlyHistogram(evts), [evts]);

  // Top devices by recent activity (proxy for "most utilised today").
  const topDevices = useMemo(() => {
    return [...list]
      .sort((a, b) => (b.lastSpeed ?? 0) - (a.lastSpeed ?? 0))
      .slice(0, 5);
  }, [list]);

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-100 min-h-full">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-brand-700/80">
            {greeting()} {user?.fullName?.split(' ')[0] ?? ''}
          </div>
          <h1 className="text-3xl font-bold mt-1">Хяналтын самбар</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Уурхайн флотын бодит цагийн дүр зураг · {new Date().toLocaleString('mn-MN')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Dot color="emerald" /> Real-time холболт идэвхтэй
        </div>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          title="Нийт машин"
          value={list.length}
          hint="Бүртгэгдсэн төхөөрөмж"
          icon={<TruckGlyph />}
          accent="slate"
        />
        <Kpi
          title="Онлайн"
          value={online}
          hint={`${online}/${list.length || 1} холбогдсон`}
          icon={<SignalGlyph />}
          accent="emerald"
          progress={list.length ? (online / list.length) * 100 : 0}
        />
        <Kpi
          title="Хөдөлгөөнтэй"
          value={movingNow}
          hint="Одоо явж буй"
          icon={<MotionGlyph />}
          accent="brand"
        />
        <Kpi
          title="Шинэ дохиолол"
          value={evts.length}
          hint={critical > 0 ? `⚠ ${critical} ноцтой` : 'Бүгд хэвийн'}
          icon={<AlertGlyph />}
          accent={critical > 0 ? 'rose' : evts.length > 0 ? 'amber' : 'slate'}
        />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* 24h alerts spark */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Сүүлийн 24 цагийн дохиолол</div>
              <div className="text-xs text-slate-500">Цаг бүрийн ачаалал</div>
            </div>
            <div className="text-2xl font-bold">{evts.length}</div>
          </div>
          <div className="mt-4 h-32 flex items-end gap-1">
            {sparkBars.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-gradient-to-t from-brand-700 to-brand-400 hover:opacity-80 transition"
                style={{ height: `${Math.max(4, v.pct)}%` }}
                title={`${v.label}: ${v.count}`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400 px-0.5">
            <span>−24ц</span>
            <span>−18ц</span>
            <span>−12ц</span>
            <span>−6ц</span>
            <span>одоо</span>
          </div>
        </div>

        {/* Connectivity ring */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col">
          <div className="text-sm font-semibold">Холболтын төлөв</div>
          <div className="text-xs text-slate-500">Онлайн / Офлайн харьцаа</div>
          <div className="mt-4 flex-1 flex items-center justify-center">
            <DonutRing online={online} offline={offline} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <Legend color="emerald" label="Онлайн" value={online} />
            <Legend color="slate" label="Офлайн" value={offline} />
          </div>
        </div>
      </div>

      {/* Lower row: top devices + recent alerts */}
      <div className="grid lg:grid-cols-5 gap-4">
        <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="font-semibold text-sm">Идэвхтэй машинууд</div>
            <a href="/app/devices" className="text-xs text-brand-700 hover:underline">
              Бүгдийг үзэх →
            </a>
          </header>
          <ul className="divide-y divide-slate-100">
            {topDevices.length === 0 && (
              <li className="px-5 py-6 text-sm text-slate-400 text-center">
                Бүртгэгдсэн машин алга
              </li>
            )}
            {topDevices.map((d) => (
              <li key={d.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <div className="h-9 w-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                  <span className="h-4 w-4"><TruckGlyph /></span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {d.plateNumber ?? '— дугааргүй —'} · IMEI {d.imei}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{Math.round(d.lastSpeed ?? 0)}<span className="text-xs text-slate-400 ml-1">км/ц</span></div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-400">
                    {d.online ? 'Онлайн' : 'Офлайн'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">Сүүлийн дохиоллууд</div>
              <div className="text-[11px] text-slate-500">Хүлээгдэж буй (acknowledge хийгээгүй)</div>
            </div>
            <a href="/app/events" className="text-xs text-brand-700 hover:underline">
              Дохиоллын төв →
            </a>
          </header>
          <ul className="divide-y divide-slate-100 max-h-[26rem] overflow-y-auto">
            {evts.length === 0 && (
              <li className="px-5 py-10 text-sm text-slate-400 text-center">
                🟢 Шинэ дохиолол алга — флот хэвийн ажиллаж байна
              </li>
            )}
            {evts.map((e) => (
              <li key={e.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <SeverityChip s={e.severity} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{prettyEventType(e.type)}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {e.message ?? '—'}
                  </div>
                </div>
                <div className="text-xs text-slate-500 text-right shrink-0">
                  {timeAgo(e.occurredAt)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ── Helpers / sub-components ────────────────────────────────

function Kpi({
  title,
  value,
  hint,
  icon,
  accent = 'slate',
  progress,
}: {
  title: string;
  value: number | string;
  hint?: string;
  icon?: ReactNode;
  accent?: 'slate' | 'emerald' | 'brand' | 'amber' | 'rose';
  progress?: number;
}) {
  const ring: Record<string, string> = {
    slate: 'from-slate-50 to-slate-100 text-slate-700',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-700',
    brand: 'from-brand-50 to-brand-100 text-brand-700',
    amber: 'from-amber-50 to-amber-100 text-amber-700',
    rose: 'from-rose-50 to-rose-100 text-rose-700',
  };
  const bar: Record<string, string> = {
    slate: 'bg-slate-500',
    emerald: 'bg-emerald-500',
    brand: 'bg-brand-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 relative overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-widest text-slate-500">{title}</div>
        <div
          className={`h-9 w-9 rounded-lg bg-gradient-to-br ${ring[accent]} flex items-center justify-center`}
        >
          <span className="h-4 w-4">{icon}</span>
        </div>
      </div>
      <div className="mt-3 text-3xl font-extrabold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      {progress !== undefined && (
        <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full ${bar[accent]} transition-all`} style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

function DonutRing({ online, offline }: { online: number; offline: number }) {
  const total = online + offline;
  const pct = total ? (online / total) * 100 : 0;
  const circ = 2 * Math.PI * 38;
  const offset = circ * (1 - pct / 100);
  return (
    <div className="relative h-36 w-36">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="38" fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="#10b981"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-extrabold">{Math.round(pct)}%</div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500">Онлайн</div>
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: 'emerald' | 'slate'; label: string; value: number }) {
  const dot: Record<string, string> = {
    emerald: 'bg-emerald-500',
    slate: 'bg-slate-400',
  };
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
      <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
        <span className={`h-2 w-2 rounded-full ${dot[color]}`} />
        {label}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function Dot({ color }: { color: 'emerald' | 'amber' | 'rose' }) {
  const m: Record<string, string> = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${m[color]} animate-pulse`} />;
}

function SeverityChip({ s }: { s: string }) {
  const m: Record<string, string> = {
    INFO: 'bg-sky-100 text-sky-800',
    WARNING: 'bg-amber-100 text-amber-800',
    CRITICAL: 'bg-rose-100 text-rose-800',
  };
  return (
    <span className={`text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-1 ${m[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {s}
    </span>
  );
}

function prettyEventType(t: string) {
  const m: Record<string, string> = {
    PANIC: 'Panic товч',
    OVERSPEED: 'Хурд хэтрэлт',
    HARSH_ACCEL: 'Огцом хурдсалт',
    HARSH_BRAKE: 'Ширүүн тоормосолт',
    HARSH_CORNER: 'Огцом эргэлт',
    GEOFENCE_ENTER: 'Бүсэд орлоо',
    GEOFENCE_EXIT: 'Бүсээс гарлаа',
    IGNITION_ON: 'Хөдөлгүүр ажилласан',
    IGNITION_OFF: 'Хөдөлгүүр унтарсан',
    IDLE_START: 'Сул зогсолт эхэлсэн',
    IDLE_END: 'Сул зогсолт дууссан',
    POWER_CUT: 'Цахилгаан тасалдсан',
    LOW_BATTERY: 'Батарей багассан',
    DEVICE_OFFLINE: 'Төхөөрөмж офлайн',
    DEVICE_ONLINE: 'Төхөөрөмж онлайн',
    TAMPER: 'Tamper · хөндөлт',
  };
  return m[t] ?? t;
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return `${Math.floor(diff)}с өмнө`;
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

function buildHourlyHistogram(evts: any[]) {
  const HOURS = 24;
  const now = Date.now();
  const buckets = Array.from({ length: HOURS }, (_, i) => ({
    label: `${HOURS - 1 - i}ц өмнө`,
    count: 0,
    pct: 0,
  }));
  for (const e of evts) {
    const t = new Date(e.occurredAt).getTime();
    const hoursAgo = Math.floor((now - t) / 3600_000);
    if (hoursAgo >= 0 && hoursAgo < HOURS) {
      buckets[HOURS - 1 - hoursAgo].count += 1;
    }
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  for (const b of buckets) b.pct = (b.count / max) * 100;
  return buckets;
}

// ── Tiny glyphs (inline SVG, no icon lib) ───────────────────
function TruckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M2 17h11V7H2z" />
      <path d="M13 11h5l3 3v3h-8" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="17" cy="19" r="2" />
    </svg>
  );
}
function SignalGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M5 12.5a10 10 0 0114 0" />
      <path d="M8 15.5a6 6 0 018 0" />
      <circle cx="12" cy="18.5" r="1.5" />
    </svg>
  );
}
function MotionGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M3 12h6M3 7h10M3 17h8" />
      <path d="M14 7l4 5-4 5" />
    </svg>
  );
}
function AlertGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  );
}
