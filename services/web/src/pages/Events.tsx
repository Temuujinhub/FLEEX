import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useLiveSocket } from '../lib/useLiveSocket';

// Дохиоллууд хуудас.
//
// События үүсэх замнал:
//   1) Машин дээрх Teltonika төхөөрөмж байршлаа TCP-ээр gps-ingestor руу илгээнэ.
//   2) Ingestor нь positions хүснэгтэд хадгалаад Redis Pub/Sub `fleex.positions`
//      сувгаар орчуулна.
//   3) events-engine сервис уг сувгаар сонсож, идэвхтэй geofence бүс
//      болон төхөөрөмжийн speedLimit-ийг шалгаад зөрчил гарвал
//      `events` хүснэгтэд бичиж `fleex.events` сувгаар дахин нийтэлнэ.
//   4) API-ийн WebSocket gateway нь уг сувгаас тус компанийн дашбоард руу
//      шууд дамжуулна — энэ хуудас бодит цагт шинэчлэгдэнэ.
//
// Уг хуудас REST-ээр хамгийн сүүлийн 100-ыг ачаалж, дараа нь WS-аар шинэ
// дохиоллыг жагсаалтын дээд хэсэгт залгаж явна.

const TYPE_LABELS: Record<string, string> = {
  GEOFENCE_ENTER: 'Бүсэд орлоо',
  GEOFENCE_EXIT:  'Бүснээс гарлаа',
  OVERSPEED:      'Хурд хэтэрсэн',
  PANIC:          'Сэрэмжлүүлэг',
  HARSH_ACCEL:    'Огцом хурдсалт',
  HARSH_BRAKE:    'Огцом тоормосолт',
  HARSH_CORNER:   'Огцом эргэлт',
  IGNITION_ON:    'Ассан',
  IGNITION_OFF:   'Унтарсан',
  IDLE_START:     'Сул ажиллагаа эхэлсэн',
  IDLE_END:       'Сул ажиллагаа дууссан',
  POWER_CUT:      'Цахилгаан тасарсан',
  LOW_BATTERY:    'Батарей бага',
  DEVICE_OFFLINE: 'Холбоо тасарсан',
  DEVICE_ONLINE:  'Холбогдсон',
  TAMPER:         'Гэмтсэн / Эвдсэн',
  LONE_WORKER_RISK: 'Lone-worker эрсдэл',
  CUSTOM:         'Бусад',
};

const SEVERITY_TINT: Record<string, string> = {
  INFO:     'bg-sky-50 text-sky-700 border-sky-200',
  WARNING:  'bg-amber-50 text-amber-800 border-amber-200',
  CRITICAL: 'bg-rose-50 text-rose-800 border-rose-200',
};

type EventRow = {
  id: string;
  companyId: string;
  deviceId: string;
  geofenceId?: string | null;
  type: string;
  severity: string;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  message?: string | null;
  acknowledged?: boolean;
  acknowledgedById?: string | null;
  acknowledgedAt?: string | null;
  occurredAt: string;
};

const FILTER_GROUPS: { id: string; label: string; types: string[] }[] = [
  { id: 'all',      label: 'Бүгд',          types: [] },
  { id: 'safety',   label: 'Аюулгүй байдал', types: ['PANIC', 'LONE_WORKER_RISK'] },
  { id: 'geo',      label: 'Geofence',      types: ['GEOFENCE_ENTER', 'GEOFENCE_EXIT'] },
  { id: 'overspeed',label: 'Хурд',          types: ['OVERSPEED'] },
  { id: 'driving',  label: 'Жолоодлого',    types: ['HARSH_ACCEL', 'HARSH_BRAKE', 'HARSH_CORNER'] },
  { id: 'device',   label: 'Төхөөрөмж',     types: ['DEVICE_OFFLINE', 'DEVICE_ONLINE', 'POWER_CUT', 'LOW_BATTERY', 'TAMPER'] },
];

export function Events() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('all');
  const [onlyUnack, setOnlyUnack] = useState(false);
  const [live, setLive] = useState<EventRow[]>([]);
  const liveIds = useRef<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/events?limit=100').then((r) => r.data.items as EventRow[]),
    refetchInterval: 30_000,
  });

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data as any[]),
    refetchInterval: 60_000,
  });
  const deviceName = (id: string) =>
    devices.data?.find((d) => d.id === id)?.name ?? `${id.slice(0, 8)}…`;

  const geofences = useQuery({
    queryKey: ['geofences'],
    queryFn: () => api.get('/geofences').then((r) => r.data as any[]),
    refetchInterval: 60_000,
  });
  const geofenceName = (id?: string | null) =>
    id ? geofences.data?.find((g) => g.id === id)?.name ?? '—' : null;

  // ── WebSocket: prepend live events as they arrive ──────────
  useLiveSocket((m) => {
    if (m.type !== 'event') return;
    const row: EventRow = m.data;
    if (liveIds.current.has(row.id)) return;
    liveIds.current.add(row.id);
    setLive((prev) => [row, ...prev].slice(0, 200));
  });

  const ack = async (id: string) => {
    await api.patch(`/events/${id}/ack`, {});
    setLive((prev) => prev.map((e) => (e.id === id ? { ...e, acknowledged: true } : e)));
    qc.invalidateQueries({ queryKey: ['events'] });
  };

  // Merge REST + live, dedup by id, keep most recent first.
  const merged = useMemo<EventRow[]>(() => {
    const seen = new Set<string>();
    const out: EventRow[] = [];
    for (const arr of [live, data ?? []]) {
      for (const e of arr) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
    }
    out.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return out;
  }, [data, live]);

  const active = FILTER_GROUPS.find((f) => f.id === filter)!;
  const filtered = useMemo(() => {
    let xs = merged;
    if (active.types.length > 0) xs = xs.filter((e) => active.types.includes(e.type));
    if (onlyUnack) xs = xs.filter((e) => !e.acknowledged);
    return xs;
  }, [merged, active, onlyUnack]);

  const stats = useMemo(() => {
    const total = merged.length;
    const unack = merged.filter((e) => !e.acknowledged).length;
    const critical = merged.filter((e) => e.severity === 'CRITICAL').length;
    const last24h = merged.filter((e) => +new Date(e.occurredAt) > Date.now() - 86_400_000).length;
    return { total, unack, critical, last24h };
  }, [merged]);

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Дохиоллууд</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Geofence бүс орох/гарах, хурд хэтрэх зэрэг үйл явдлыг бодит цагт хяна.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyUnack} onChange={(e) => setOnlyUnack(e.target.checked)} />
            Зөвхөн баталгаажаагүй
          </label>
        </div>
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Нийт" value={stats.total} accent="brand" />
          <Stat label="Баталгаажаагүй" value={stats.unack} accent="amber" />
          <Stat label="Сүүлийн 24ц" value={stats.last24h} accent="emerald" />
          <Stat label="Маш ноцтой" value={stats.critical} accent="rose" />
        </div>
      </header>

      <div className="px-6 md:px-8 py-3 bg-white border-b border-slate-200 flex flex-wrap gap-1.5">
        {FILTER_GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => setFilter(g.id)}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium border transition',
              filter === g.id
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold w-44">Цаг</th>
                <th className="text-left px-4 py-3 font-semibold">Төрөл</th>
                <th className="text-left px-4 py-3 font-semibold">Машин</th>
                <th className="text-left px-4 py-3 font-semibold">Бүс / Тайлбар</th>
                <th className="text-left px-4 py-3 font-semibold w-24">Хүндрэл</th>
                <th className="text-right px-4 py-3 font-semibold w-32">Үйлдэл</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Уншиж байна…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-slate-400 text-sm">
                  Дохиолол алга. Geofence бүс үүсгэж, машин дотогш орох/гарахад автоматаар нэмэгдэнэ.
                </td></tr>
              )}
              {filtered.map((e) => {
                const isFresh = +new Date(e.occurredAt) > Date.now() - 60_000;
                return (
                  <tr key={e.id} className={clsx('hover:bg-slate-50', e.acknowledged && 'opacity-60', isFresh && 'animate-pulse-once')}>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {formatTime(e.occurredAt)}
                    </td>
                    <td className="px-4 py-3 font-medium">{TYPE_LABELS[e.type] ?? e.type}</td>
                    <td className="px-4 py-3 text-slate-700">{deviceName(e.deviceId)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {geofenceName(e.geofenceId) && (
                        <span className="inline-block mr-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">{geofenceName(e.geofenceId)}</span>
                      )}
                      {e.message ?? (e.speed != null ? `${e.speed.toFixed(0)} км/ц` : '—')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border', SEVERITY_TINT[e.severity] ?? SEVERITY_TINT.WARNING)}>
                        {e.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!e.acknowledged ? (
                        <button onClick={() => ack(e.id)} className="text-brand-700 hover:underline text-xs font-medium">
                          Баталгаажуулах
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs">Хаасан</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: 'brand' | 'emerald' | 'amber' | 'rose' }) {
  const tint: Record<string, string> = {
    brand:   'text-brand-700 bg-brand-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    amber:   'text-amber-700 bg-amber-50',
    rose:    'text-rose-700 bg-rose-50',
  };
  return (
    <div className={`rounded-xl px-4 py-3 ${tint[accent]}`}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'Дөнгөж сая';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин өмнө`;
  return d.toLocaleString('mn-MN');
}
