import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, WS_URL, getToken } from '../lib/api';

// Дамжуулагч / Dispatcher board v1. Three-column kanban: WAITING /
// MOVING / OFFLINE, derived from each device's last-seen + last-speed
// stats. Drag-drop assignment is intentionally out of scope for v1 —
// the goal here is to give a dispatcher a single-glance view of who
// is doing what right now, replacing the "scan the map for stationary
// dots" workflow.
//
// Status thresholds:
//   OFFLINE  : lastSeenAt > 15 min ago, or never seen
//   WAITING  : online + speed < 2 km/h for at least 10 min (idle)
//   MOVING   : online + speed >= 2 km/h
// The "duration in status" timer is computed from the timestamp the
// WS feed last reported a transition; we approximate this as "now -
// lastSeenAt" for OFFLINE and "now - lastMovedAt" for WAITING.

const IDLE_SPEED_KMH = 2;
const OFFLINE_AFTER_MS = 15 * 60_000;
const IDLE_MIN_MS = 10 * 60_000;

interface DeviceRow {
  id: string;
  name: string;
  imei: string;
  plateNumber: string | null;
  online: boolean;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeed: number | null;
  lastSeenAt: string | null;
  driverId: string | null;
  driver?: { id: string; fullName: string; phone: string | null } | null;
  group?: { id: string; name: string } | null;
}

interface LivePosition {
  deviceId: string;
  lat: number;
  lng: number;
  speed: number;
  time: number;
}

type Status = 'MOVING' | 'WAITING' | 'OFFLINE';

interface Row extends DeviceRow {
  status: Status;
  inStatusForMs: number;
  effectiveSpeed: number;
}

export function Dispatch() {
  const [search, setSearch] = useState('');
  const [livePos, setLivePos] = useState<Record<string, LivePosition>>({});
  // Tracks the wall-clock instant we first observed each device in its
  // current non-MOVING state, so the badge can show "Идэвхгүй 25м"
  // without persisting transition events to the DB. Reset whenever the
  // device starts moving again.
  const [statusSince, setStatusSince] = useState<Record<string, number>>({});
  // 5-sec tick so the elapsed-time labels stay live without re-rendering
  // the entire query result.
  const [, setTick] = useState(0);

  const devices = useQuery<DeviceRow[]>({
    queryKey: ['dispatch-devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = WS_URL.startsWith('ws')
      ? `${WS_URL}?token=${encodeURIComponent(token)}`
      : `${proto}://${window.location.host}${WS_URL}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type !== 'position') return;
        setLivePos((prev) => ({ ...prev, [m.data.deviceId]: m.data }));
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, []);

  const rows: Row[] = useMemo(() => {
    const list = devices.data ?? [];
    const now = Date.now();
    const next: Record<string, number> = { ...statusSince };
    let mutated = false;
    const out = list.map<Row>((d) => {
      const live = livePos[d.id];
      const effectiveSpeed = live?.speed ?? d.lastSpeed ?? 0;
      const lastSeen = live ? live.time : d.lastSeenAt ? Date.parse(d.lastSeenAt) : 0;
      const stale = !lastSeen || now - lastSeen > OFFLINE_AFTER_MS;
      const isOnline = (live ? true : d.online) && !stale;
      let status: Status;
      if (!isOnline) status = 'OFFLINE';
      else if (effectiveSpeed >= IDLE_SPEED_KMH) status = 'MOVING';
      else status = 'WAITING';

      // Maintain the per-device transition timestamp without trampling
      // the React state every render.
      const key = `${d.id}:${status}`;
      if (!next[key]) {
        next[key] = lastSeen || now;
        mutated = true;
      }
      const inStatusForMs = Math.max(0, now - next[key]);
      // WAITING only fires after the idle threshold to avoid flicker
      // when a vehicle pauses for a few seconds at a traffic light.
      if (status === 'WAITING' && inStatusForMs < IDLE_MIN_MS) {
        status = 'MOVING';
      }
      return {
        ...d,
        status,
        inStatusForMs,
        effectiveSpeed,
      };
    });
    if (mutated) {
      // Defer to avoid setState-in-useMemo warning.
      queueMicrotask(() => setStatusSince(next));
    }
    return out;
  }, [devices.data, livePos, statusSince]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      (r.plateNumber ?? '').toLowerCase().includes(q) ||
      (r.driver?.fullName ?? '').toLowerCase().includes(q)
    );
  });

  const grouped = {
    MOVING: filtered.filter((r) => r.status === 'MOVING'),
    WAITING: filtered.filter((r) => r.status === 'WAITING'),
    OFFLINE: filtered.filter((r) => r.status === 'OFFLINE'),
  };

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Dispatcher</h1>
            <p className="text-sm text-slate-500 mt-1">
              Машин бүрийн одоогийн төлвийг нэг харагдацанд. Идэвхгүй удсан машин болон холбоо тасарсан машин дээр анхаарлаа төвлөрүүлээрэй.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Машин / жолооч / дугаар…"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm w-64"
            />
            <SummaryPill label="Хөдөлж" count={grouped.MOVING.length} color="emerald" />
            <SummaryPill label="Идэвхгүй" count={grouped.WAITING.length} color="amber" />
            <SummaryPill label="Холбоогүй" count={grouped.OFFLINE.length} color="slate" />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Column title="Хөдөлж байгаа" subtitle="≥ 2 km/h" tone="emerald" rows={grouped.MOVING} />
          <Column title="Хүлээж буй" subtitle={`${IDLE_MIN_MS / 60000}+ минут зогссон`} tone="amber" rows={grouped.WAITING} />
          <Column title="Холбоо тасарсан" subtitle={`${OFFLINE_AFTER_MS / 60000}+ минут чимээгүй`} tone="slate" rows={grouped.OFFLINE} />
        </div>
      </div>
    </div>
  );
}

function SummaryPill({ label, count, color }: { label: string; count: number; color: 'emerald' | 'amber' | 'slate' }) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-200 text-slate-700',
  };
  return (
    <span className={clsx('rounded-full text-xs font-medium px-3 py-1.5', tones[color])}>
      {label} <span className="font-bold ml-1">{count}</span>
    </span>
  );
}

function Column({
  title,
  subtitle,
  tone,
  rows,
}: {
  title: string;
  subtitle: string;
  tone: 'emerald' | 'amber' | 'slate';
  rows: Row[];
}) {
  const headerTone: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
      <div className={clsx('px-4 py-3 border-b flex items-center justify-between', headerTone[tone])}>
        <div>
          <div className="font-semibold text-sm">{title}</div>
          <div className="text-[11px] opacity-75">{subtitle}</div>
        </div>
        <span className="text-2xl font-bold tabular-nums">{rows.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[calc(100vh-260px)]">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">Энэ бүлэгт машин алга.</div>
        ) : (
          rows.map((r) => <DispatchCard key={r.id} row={r} />)
        )}
      </div>
    </div>
  );
}

function DispatchCard({ row }: { row: Row }) {
  const elapsed = formatElapsed(row.inStatusForMs);
  const speed = row.effectiveSpeed.toFixed(0);
  const name = row.name || row.plateNumber || row.imei;
  return (
    <div className="p-3 hover:bg-slate-50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm text-slate-900 truncate">{name}</div>
          {row.plateNumber && row.name !== row.plateNumber && (
            <div className="text-xs text-slate-500">{row.plateNumber}</div>
          )}
        </div>
        <span className="text-[11px] text-slate-500 whitespace-nowrap">{elapsed}</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-600">
        {row.status === 'MOVING' && (
          <span className="text-emerald-700 font-medium">{speed} km/h</span>
        )}
        {row.driver?.fullName && (
          <span className="truncate" title={row.driver.fullName}>{row.driver.fullName}</span>
        )}
        {row.group?.name && (
          <span className="text-slate-400">· {row.group.name}</span>
        )}
      </div>
      {row.lastLat != null && row.lastLng != null && (
        <a
          href={`/app/map?focus=${row.id}`}
          className="mt-1 inline-block text-[11px] text-brand-600 hover:underline"
        >
          Зураг дээр харах →
        </a>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}ц ${remM}м`;
  const d = Math.floor(h / 24);
  return `${d}ө ${h % 24}ц`;
}
