import { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';

// Эко жолоодлого / driver-behaviour scoreboard. Pulls the new
// /api/reports/driver-scores endpoint, which returns one row per device
// with an aggregate score (100 - Σ event.count × weight) plus a per-event
// breakdown. The user can tune the weights live; the URL stays cacheable
// because we encode them as repeated `w=TYPE:N` query params.

interface Weight {
  type: string;
  label: string;
  category: 'speed' | 'driving' | 'idle';
  defaultWeight: number;
}

const WEIGHTS: Weight[] = [
  // Хурд хэтрэлт
  { type: 'OVERSPEED',     label: 'Хурд хэтрэлт',         category: 'speed',   defaultWeight: 5 },
  // Зохимжгүй жолоодлого
  { type: 'HARSH_ACCEL',   label: 'Огцом хурдсалт',       category: 'driving', defaultWeight: 5 },
  { type: 'HARSH_BRAKE',   label: 'Ширүүн тоормосолт',    category: 'driving', defaultWeight: 5 },
  { type: 'HARSH_CORNER',  label: 'Огцом эргэлт',          category: 'driving', defaultWeight: 5 },
  // Сул зогсолт
  { type: 'IDLE_START',    label: 'Сул зогсолт',           category: 'idle',    defaultWeight: 2 },
  // Эрсдэлт үйлдэл
  { type: 'PANIC',         label: 'Panic дохио',           category: 'driving', defaultWeight: 15 },
  { type: 'TAMPER',        label: 'Хөндөлт (Tamper)',      category: 'driving', defaultWeight: 10 },
  { type: 'POWER_CUT',     label: 'Цахилгаан тасалдал',    category: 'driving', defaultWeight: 8 },
];

const CATS: { id: Weight['category']; title: string; icon: string }[] = [
  { id: 'speed',   title: 'Хурд хэтрүүлэлт',    icon: 'speed' },
  { id: 'driving', title: 'Зохимжгүй жолоодлого', icon: 'driving' },
  { id: 'idle',    title: 'Сул зогсолт',         icon: 'idle' },
];

const PRESETS: { id: string; label: string; range: () => [Date, Date] }[] = [
  { id: 'today', label: 'Өнөөдөр', range: () => [startOfDay(new Date()), new Date()] },
  { id: '7d',    label: '7 хоног',  range: () => [new Date(Date.now() - 7  * 86400_000), new Date()] },
  { id: '30d',   label: '30 хоног', range: () => [new Date(Date.now() - 30 * 86400_000), new Date()] },
  { id: 'mtd',   label: 'Энэ сар',  range: () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1), d]; } },
];

export function EcoDriving() {
  const [preset, setPreset] = useState('7d');
  const [from, setFrom] = useState<Date>(new Date(Date.now() - 7 * 86400_000));
  const [to, setTo] = useState<Date>(new Date());
  const [weights, setWeights] = useState<Record<string, number>>(
    () => Object.fromEntries(WEIGHTS.map((w) => [w.type, w.defaultWeight])),
  );

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const [f, t] = p.range();
    setFrom(f); setTo(t);
  };

  const params = useMemo(() => {
    const u = new URLSearchParams();
    u.set('from', from.toISOString());
    u.set('to',   to.toISOString());
    for (const w of WEIGHTS) {
      const v = weights[w.type] ?? 0;
      if (v > 0) u.append('w', `${w.type}:${v}`);
    }
    return u.toString();
  }, [from, to, weights]);

  const scores = useQuery({
    queryKey: ['driver-scores', params],
    queryFn: () => api.get(`/reports/driver-scores?${params}`).then((r) => r.data),
  });

  const rows: any[] = scores.data?.rows ?? [];
  const summary = useMemo(() => {
    if (rows.length === 0) return { avg: 0, top: null, worst: null, totalEvents: 0 };
    const avg = Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length);
    const top = rows[0];
    const worst = rows[rows.length - 1];
    const totalEvents = rows.reduce((a, r) => a + r.totalEvents, 0);
    return { avg, top, worst, totalEvents };
  }, [rows]);

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Эко жолоодлого</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Жолооч нар хэр анхааралтай байна вэ? Зөрчилд өгөх онооны жинг тохируулж бодит цагийн үнэлгээ авна.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={clsx(
                  'text-xs rounded-md px-2.5 py-1.5 border transition',
                  preset === p.id ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Дундаж оноо" value={summary.avg + '/100'} accent="brand" />
          <Stat label="Шилдэг" value={summary.top ? summary.top.score + '/100' : '—'} hint={summary.top?.driver?.fullName ?? summary.top?.device?.name ?? ''} accent="emerald" />
          <Stat label="Хамгийн муу" value={summary.worst ? summary.worst.score + '/100' : '—'} hint={summary.worst?.driver?.fullName ?? summary.worst?.device?.name ?? ''} accent="rose" />
          <Stat label="Нийт зөрчил" value={String(summary.totalEvents)} accent="amber" />
        </div>
      </header>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 p-4">
        {/* Weights panel */}
        <aside className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Үнэлгээний тохиргоо</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Зөрчил тус бүрд өгөх оноо. 100 онооноос хасагдан явна.
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {CATS.map((cat) => {
              const items = WEIGHTS.filter((w) => w.category === cat.id);
              return (
                <div key={cat.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-7 w-7 rounded-md bg-brand-50 text-brand-700 flex items-center justify-center">
                      <span className="h-4 w-4"><CatIcon name={cat.icon} /></span>
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{cat.title}</span>
                  </div>
                  <div className="space-y-3 pl-1">
                    {items.map((w) => (
                      <div key={w.type}>
                        <div className="flex items-center justify-between text-xs text-slate-700">
                          <span>{w.label}</span>
                          <span className="tabular-nums text-slate-900 font-semibold">{weights[w.type]}</span>
                        </div>
                        <input
                          type="range" min={0} max={30} step={1}
                          value={weights[w.type]}
                          onChange={(e) => setWeights((s) => ({ ...s, [w.type]: Number(e.target.value) }))}
                          className="w-full mt-1 accent-brand-600"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <button
              onClick={() => setWeights(Object.fromEntries(WEIGHTS.map((w) => [w.type, w.defaultWeight])))}
              className="w-full text-xs rounded-md border border-slate-200 hover:bg-slate-50 py-2"
            >
              Үндсэн тохиргоонд буцах
            </button>
          </div>
        </aside>

        {/* Leaderboard */}
        <main className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Жолоодлогын үнэлгээ</h2>
              <div className="text-xs text-slate-500">
                {from.toLocaleDateString('mn-MN')} → {to.toLocaleDateString('mn-MN')} · {rows.length} машин
              </div>
            </div>
            <Legend />
          </header>
          <div className="flex-1 overflow-y-auto">
            {scores.isLoading && (
              <div className="p-10 text-center text-slate-400">Тооцоолж байна…</div>
            )}
            {!scores.isLoading && rows.length === 0 && (
              <div className="p-16 text-center text-slate-400 text-sm">
                Сонгосон хугацаанд зөрчил алга — бүх машин 100 оноотой.
              </div>
            )}
            {!scores.isLoading && rows.length > 0 && (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">#</th>
                    <th className="text-left px-4 py-3 font-semibold">Машин · Жолооч</th>
                    <th className="text-left px-4 py-3 font-semibold">Оноо</th>
                    <th className="text-left px-4 py-3 font-semibold">Зөрчил (нийт)</th>
                    <th className="text-left px-4 py-3 font-semibold">Хамгийн нөлөөтэй</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={r.device.id} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-3 text-xs text-slate-400 tabular-nums pt-4">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.driver?.fullName ?? '— жолоочгүй —'}</div>
                        <div className="text-xs text-slate-500">
                          {r.device.name}{r.device.plateNumber ? ` · ${r.device.plateNumber}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 w-[280px]">
                        <ScoreBar score={r.score} />
                      </td>
                      <td className="px-4 py-3 tabular-nums">{r.totalEvents}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {r.breakdown.slice(0, 3).map((b: any) => (
                            <span key={b.type} className="text-[10px] uppercase tracking-widest bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                              {eventLabel(b.type)} · {b.count}
                            </span>
                          ))}
                          {r.breakdown.length === 0 && <span className="text-xs text-slate-400">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────
function Stat({
  label, value, hint, accent,
}: { label: string; value: string; hint?: string; accent: 'brand' | 'emerald' | 'rose' | 'amber' }) {
  const tint: Record<string, string> = {
    brand:   'text-brand-700 bg-brand-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    rose:    'text-rose-700 bg-rose-50',
    amber:   'text-amber-700 bg-amber-50',
  };
  return (
    <div className={`rounded-xl px-4 py-3 ${tint[accent]}`}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] mt-0.5 opacity-80 truncate">{hint}</div>}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-emerald-500'
    : score >= 60 ? 'bg-lime-500'
    : score >= 40 ? 'bg-amber-500'
    : score >= 20 ? 'bg-orange-500'
    : 'bg-rose-500';
  const rating =
    score >= 80 ? 'Маш сайн'
    : score >= 60 ? 'Сайн'
    : score >= 40 ? 'Дунд'
    : score >= 20 ? 'Муу'
    : 'Маш муу';
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold tabular-nums text-slate-900">{score}/100</span>
        <span className="text-slate-500">{rating}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden md:flex items-center gap-3 text-[10px] uppercase tracking-widest text-slate-500">
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />80–100</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-lime-500" />60–80</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />40–60</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-500" />20–40</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />0–20</span>
    </div>
  );
}

function eventLabel(t: string) {
  const m: Record<string, string> = {
    OVERSPEED: 'Хурд хэтрэлт',
    HARSH_ACCEL: 'Огцом хурдсалт',
    HARSH_BRAKE: 'Ширүүн тоормосолт',
    HARSH_CORNER: 'Огцом эргэлт',
    IDLE_START: 'Сул зогсолт',
    PANIC: 'Panic',
    TAMPER: 'Tamper',
    POWER_CUT: 'Power cut',
  };
  return m[t] ?? t;
}

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function CatIcon({ name }: { name: string }) {
  const map: Record<string, ReactNode> = {
    speed:   <><path d="M4 14a8 8 0 1116 0" /><path d="M12 14l4-3" /><circle cx="12" cy="14" r="1.2" fill="currentColor" /></>,
    driving: <><circle cx="12" cy="7" r="3" /><path d="M5 21a7 7 0 0114 0" /></>,
    idle:    <><circle cx="12" cy="12" r="9" /><path d="M9 9l2 2-2 2M15 9l-2 2 2 2" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      {map[name]}
    </svg>
  );
}
