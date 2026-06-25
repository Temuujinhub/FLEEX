import { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, API_BASE, getToken } from '../lib/api';

// Mining-ops reports library. Categories on the left, configuration in the
// middle, results panel on the right — matches the muscle memory of a
// Wialon/Gaikham user but tightened up and lightly localised. Real backend
// only exposes /reports/trip and /reports/events today; everything else is
// derived from those (event filters, idle / engine slices of trip) or
// flagged "удахгүй" so we don't pretend something is wired up.

type Kind = 'trip' | 'trip-idle' | 'trip-engine' | 'events' | 'idle-billing' | 'mileage' | 'utilization' | 'fuel-consumption' | 'coming-soon';

interface Template {
  id: string;
  cat: string;
  name: string;
  description: string;
  kind: Kind;
  filter?: string[];
  icon: ReactNode;
}

// Inline SVG glyphs (declared up here so the TEMPLATES array below can
// reference them as JSX without hitting a TDZ — see Vite/Rollup TDZ
// error fix history).
function svg(children: ReactNode) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      {children}
    </svg>
  );
}
const I = {
  Route:    () => svg(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M6 8.5v4a3 3 0 003 3h6a3 3 0 013 3" /></>),
  Pause:    () => svg(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>),
  Driver:   () => svg(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0114 0" /></>),
  Gauge:    () => svg(<><path d="M4 14a8 8 0 1116 0" /><path d="M12 14l4-3" /><circle cx="12" cy="14" r="1.2" fill="currentColor" /></>),
  Panic:    () => svg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4M12 16v.5" /></>),
  Shield:   () => svg(<><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  AlertList:() => svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>),
  Engine:   () => svg(<><rect x="5" y="9" width="14" height="8" rx="1" /><path d="M9 9V6h6v3M3 13h2M19 13h2" /></>),
  Fuel:     () => svg(<><rect x="4" y="4" width="9" height="16" rx="1.5" /><path d="M13 9h3l2 3v6a2 2 0 01-2 2" /><path d="M7 8h3" /></>),
  Power:    () => svg(<><path d="M12 4v8" /><path d="M8 6a6 6 0 108 0" /></>),
  Signal:   () => svg(<><path d="M5 12.5a10 10 0 0114 0" /><path d="M8 15.5a6 6 0 018 0" /><circle cx="12" cy="18.5" r="1.5" /></>),
  Battery:  () => svg(<><rect x="3" y="7" width="16" height="10" rx="1.5" /><rect x="20" y="10" width="2" height="4" rx="0.5" /><path d="M6 12h8" /></>),
  Lock:     () => svg(<><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 018 0v3" /></>),
  Calendar: () => svg(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></>),
  Chart:    () => svg(<><path d="M4 20V4M4 20h16" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="9" width="3" height="8" /><rect x="17" y="6" width="3" height="11" /></>),
};

const TEMPLATES: Template[] = [
  // ── Жолоодлого ───────────────────────────────────────────
  { id: 'trip',     cat: 'Жолоодлогын тайлан', name: 'Зорчилт',
    description: 'Нийт зам, жолоодлогын цаг, дундаж/дээд хурд.',
    kind: 'trip', icon: <I.Route /> },
  { id: 'idle',     cat: 'Жолоодлогын тайлан', name: 'Зогсолт',
    description: 'Хөдөлгүүр асаалттай, хөдөлгөөнгүй зогссон цаг.',
    kind: 'trip-idle', icon: <I.Pause /> },
  { id: 'driver',   cat: 'Жолоодлогын тайлан', name: 'Жолоочийн зан төлөв',
    description: 'Огцом хурдсалт, тоормосолт, эргэлт.',
    kind: 'events', filter: ['HARSH_ACCEL', 'HARSH_BRAKE', 'HARSH_CORNER'], icon: <I.Driver /> },

  // ── Аюулгүй байдал ───────────────────────────────────────
  { id: 'overspeed', cat: 'Аюулгүй байдал', name: 'Хурд хэтрэлт',
    description: 'Хурдны хязгаар давсан тохиолдол.',
    kind: 'events', filter: ['OVERSPEED'], icon: <I.Gauge /> },
  { id: 'panic',     cat: 'Аюулгүй байдал', name: 'Panic дохио',
    description: 'Жолоочийн яаралтай товчлуур.',
    kind: 'events', filter: ['PANIC'], icon: <I.Panic /> },
  { id: 'geofence',  cat: 'Аюулгүй байдал', name: 'Хязгаар бүс зөрчил',
    description: 'Geofence-д орсон / гарсан түүх.',
    kind: 'events', filter: ['GEOFENCE_ENTER', 'GEOFENCE_EXIT'], icon: <I.Shield /> },
  { id: 'safety',    cat: 'Аюулгүй байдал', name: 'Аюулгүй байдлын тойм',
    description: 'Бүх дохиоллыг нэгтгэн харах.',
    kind: 'events', icon: <I.AlertList /> },

  // ── Ашиглалт ─────────────────────────────────────────────
  { id: 'mileage', cat: 'Ашиглалт',   name: 'Гүйлт (өдрөөр)',
    description: 'Өдөр бүрийн туулсан зам, хөдөлгөөнтэй цаг, дээд хурд.',
    kind: 'mileage', icon: <I.Calendar /> },
  { id: 'utilization', cat: 'Ашиглалт', name: 'Ашиглалт (өдрөөр)',
    description: 'Хөдөлгүүр асаалттай / хөдөлгөөнд / сул зогссон цаг ба ашиглалтын %.',
    kind: 'utilization', icon: <I.Chart /> },
  { id: 'engine',  cat: 'Ашиглалт',   name: 'Мото цаг',
    description: 'Хөдөлгүүрийн ажилласан цаг.',
    kind: 'trip-engine', icon: <I.Engine /> },
  { id: 'fuel',    cat: 'Ашиглалт',   name: 'Түлш — цэнэглэлт/хулгай',
    description: 'Fuel-level мэдрэгчээс цэнэглэлт ба гэнэтийн алдагдал (хулгай).',
    kind: 'events', filter: ['FUEL_FILL', 'FUEL_DRAIN'], icon: <I.Fuel /> },
  { id: 'fuel_consumption', cat: 'Ашиглалт', name: 'Шатхууны зарцуулалт (норм)',
    description: 'Туулсан зам × машины L/100км нормоор тооцсон зарцуулалт. Мэдрэгч шаардахгүй.',
    kind: 'fuel-consumption', icon: <I.Fuel /> },
  { id: 'idle-billing', cat: 'Ашиглалт', name: 'Idle нэхэмжлэл',
    description: 'Жолооч тус бүрийн зогссон цаг × тарифаар тооцсон дүн.',
    kind: 'idle-billing', icon: <I.Pause /> },

  // ── Төхөөрөмж ────────────────────────────────────────────
  { id: 'ignition', cat: 'Төхөөрөмж', name: 'Хөдөлгүүр асаалт/унтраалт',
    description: 'IGNITION_ON / IGNITION_OFF үйлдлийн түүх.',
    kind: 'events', filter: ['IGNITION_ON', 'IGNITION_OFF'], icon: <I.Power /> },
  { id: 'offline',  cat: 'Төхөөрөмж', name: 'Сүлжээ тасалдалт',
    description: 'Төхөөрөмж онлайн / офлайн.',
    kind: 'events', filter: ['DEVICE_OFFLINE', 'DEVICE_ONLINE'], icon: <I.Signal /> },
  { id: 'power',    cat: 'Төхөөрөмж', name: 'Цахилгаан · батарей',
    description: 'Power cut, бага батарейн дохиолол.',
    kind: 'events', filter: ['POWER_CUT', 'LOW_BATTERY'], icon: <I.Battery /> },
  { id: 'tamper',   cat: 'Төхөөрөмж', name: 'Хөндөлт (Tamper)',
    description: 'Төхөөрөмжийг хөндөх оролдлого.',
    kind: 'events', filter: ['TAMPER'], icon: <I.Lock /> },
];

const CATS = ['Жолоодлогын тайлан', 'Аюулгүй байдал', 'Ашиглалт', 'Төхөөрөмж'];

// Authenticated file download. If the server returned a Content-Disposition
// header with a filename, we use that (the template export endpoint does);
// otherwise we fall back to the caller-supplied default.
function downloadFromUrl(url: string, fallbackName?: string) {
  fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cd = r.headers.get('content-disposition') ?? '';
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const filename = m?.[1] ?? fallbackName ?? 'report';
      return r.blob().then((b) => ({ blob: b, filename }));
    })
    .then(({ blob, filename }) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    })
    .catch((err) => {
      console.error('Report download failed:', err);
      alert('Тайланг татаж чадсангүй: ' + (err as Error).message);
    });
}

// Date range presets.
const PRESETS: { id: string; label: string; range: () => [Date, Date] }[] = [
  { id: 'today',     label: 'Өнөөдөр', range: () => [startOfDay(new Date()), new Date()] },
  { id: 'yesterday', label: 'Өчигдөр', range: () => {
    const y = new Date(Date.now() - 86_400_000);
    return [startOfDay(y), endOfDay(y)];
  } },
  { id: '7d',  label: '7 хоног',  range: () => [new Date(Date.now() - 7 * 86_400_000), new Date()] },
  { id: '30d', label: '30 хоног', range: () => [new Date(Date.now() - 30 * 86_400_000), new Date()] },
  { id: 'mtd', label: 'Энэ сар', range: () => {
    const d = new Date();
    return [new Date(d.getFullYear(), d.getMonth(), 1), d];
  } },
];

// ── Page ──────────────────────────────────────────────────────
export function Reports() {
  const [tplId, setTplId] = useState<string>('trip');
  const [search, setSearch] = useState('');
  const [deviceId, setDeviceId] = useState('');
  // Idle-billing tariff is decoupled from device selection — the report is
  // a cross-driver aggregate, so we ask for an ₮/цаг rate instead.
  const [tariff, setTariff] = useState('50000');
  const [shiftId, setShiftId] = useState('');
  const [preset, setPreset] = useState<string>('7d');
  const [from, setFrom] = useState<string>(toLocalInput(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState<string>(toLocalInput(new Date()));
  const [generated, setGenerated] = useState<{ tplId: string; deviceId: string; from: string; to: string; tariff: string; shiftId: string } | null>(null);

  const shifts = useQuery({
    queryKey: ['shifts'],
    queryFn: () => api.get('/shifts').then((r) => r.data as Array<{ id: string; name: string; color: string | null }>),
  });

  const tpl = TEMPLATES.find((t) => t.id === tplId) ?? TEMPLATES[0];

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return TEMPLATES;
    const q = search.trim().toLowerCase();
    return TEMPLATES.filter((t) =>
      (t.name + ' ' + t.description + ' ' + t.cat).toLowerCase().includes(q),
    );
  }, [search]);

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const [f, t] = p.range();
    setFrom(toLocalInput(f));
    setTo(toLocalInput(t));
  };

  const isIdleBilling = tpl.kind === 'idle-billing';
  const canRun = tpl.kind === 'coming-soon'
    ? false
    : isIdleBilling
      ? Number(tariff) > 0
      : Boolean(deviceId);

  const run = () => {
    if (!canRun) return;
    setGenerated({ tplId: tpl.id, deviceId, from, to, tariff, shiftId });
  };

  const download = (fmt: 'excel' | 'pdf') => {
    if (!generated) return;
    if (generated.tplId === 'idle-billing') {
      // PDF not yet supported for idle billing — Excel is sufficient
      // for back-office invoicing today.
      if (fmt !== 'excel') return;
      const url =
        `${API_BASE}/reports/idle-billing/excel` +
        `?from=${new Date(generated.from).toISOString()}&to=${new Date(generated.to).toISOString()}` +
        `&tariff=${encodeURIComponent(generated.tariff)}` +
        (generated.shiftId ? `&shiftId=${encodeURIComponent(generated.shiftId)}` : '');
      downloadFromUrl(url, `idle-billing-${generated.from}_${generated.to}.xlsx`);
      return;
    }
    // Template-aware export. The backend picks the right shaper + filename
    // based on tplId — engine-hours-{plate}-{from}_{to}.xlsx for "Мото
    // цаг", ignition-{plate}-...xlsx for the ignition event report, etc.
    const url =
      `${API_BASE}/reports/template/${generated.tplId}/${generated.deviceId}/${fmt}` +
      `?from=${new Date(generated.from).toISOString()}&to=${new Date(generated.to).toISOString()}`;
    downloadFromUrl(url);
  };

  return (
    <div className="h-full flex flex-col bg-slate-100">
      {/* Page header */}
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Тайлан</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Уурхайн флотын ажиллагаа, аюулгүй байдал, шатхуун, төхөөрөмжийн тайлан.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Шаблон: <span className="text-brand-700 font-medium">{TEMPLATES.length}</span> ·
            Сүлжээний хэмжээ: <span className="font-medium">{devices.data?.length ?? 0}</span> машин
          </div>
        </div>
      </header>

      {/* 3-column body */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[280px_320px_1fr] gap-4 p-4">
        {/* Column 1 — Templates */}
        <aside className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
              Тайлангийн шаблон
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Хайх..."
              className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
            {CATS.map((cat) => {
              const items = filtered.filter((t) => t.cat === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="px-2 mb-1.5 text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                    {cat}
                  </div>
                  <div className="space-y-1">
                    {items.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTplId(t.id)}
                        className={clsx(
                          'w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 transition',
                          tplId === t.id
                            ? 'bg-brand-50 border border-brand-200'
                            : 'border border-transparent hover:bg-slate-50',
                        )}
                      >
                        <span
                          className={clsx(
                            'h-7 w-7 shrink-0 rounded-md flex items-center justify-center',
                            tplId === t.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600',
                          )}
                        >
                          <span className="h-4 w-4">{t.icon}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{t.name}</span>
                            {t.kind === 'coming-soon' && (
                              <span className="text-[9px] uppercase tracking-widest bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                                Удахгүй
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-slate-500 mt-0.5 line-clamp-2">
                            {t.description}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-8">Олдсонгүй</div>
            )}
          </div>
        </aside>

        {/* Column 2 — Configuration */}
        <aside className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
              Тохиргоо
            </div>
            <div className="mt-1 text-base font-semibold">{tpl.name}</div>
            <div className="text-xs text-slate-500">{tpl.description}</div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {isIdleBilling ? (
              <>
                <Field label="Тариф (₮/цаг)">
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={tariff}
                    onChange={(e) => setTariff(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <div className="mt-1 text-[11px] text-slate-500">
                    Жнь: 50000. Тариф × нийт idle цаг = тус жолоочид нэхэмжлэх дүн.
                  </div>
                </Field>
                <Field label="Ээлжээр шүүх (заавал биш)">
                  <select
                    value={shiftId}
                    onChange={(e) => setShiftId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">— Бүгд —</option>
                    {(shifts.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Сонгосон ээлжид харьяалагдах жолооч нарын тооцоог л харуулна.
                  </div>
                </Field>
              </>
            ) : (
              <Field label="Машин">
                <select
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— Сонгох —</option>
                  {(devices.data ?? []).map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.plateNumber ? `· ${d.plateNumber}` : ''}
                    </option>
                  ))}
                </select>
                {(devices.data ?? []).length === 0 && (
                  <div className="mt-1 text-[11px] text-amber-700">
                    Бүртгэгдсэн машин алга — эхлээд "Машин · Төхөөрөмж" хэсэгт нэмнэ үү.
                  </div>
                )}
              </Field>
            )}

            <Field label="Хугацааны хүрээ">
              <div className="grid grid-cols-3 gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    className={clsx(
                      'text-xs rounded-md px-2 py-1.5 border transition',
                      preset === p.id
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Эхлэл">
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPreset(''); }}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </Field>
            <Field label="Төгсгөл">
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPreset(''); }}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </Field>

            {tpl.kind === 'coming-soon' && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
                <div><strong>Шатхууны тайлан хараахан идэвхэжээгүй.</strong></div>
                <div>
                  Энэ тайланг гаргахын тулд машинд <strong>CAN-bus унших адаптер</strong> эсвэл
                  <strong> fuel-probe мэдрэгч</strong> суурилуулж, GPS төхөөрөмж нь түвшний өгөгдлийг
                  ingestor руу дамжуулдаг байх шаардлагатай. Уг интеграцийг 2026 Q3 roadmap дотор
                  төлөвлөсөн (CAN-bus PID listener).
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-slate-100 p-4 space-y-2">
            <button
              onClick={run}
              disabled={!canRun}
              className="w-full rounded-md bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2.5 disabled:opacity-50 transition"
            >
              Тайлан үүсгэх
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => download('excel')}
                disabled={!generated || tpl.kind === 'coming-soon'}
                className="flex-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm py-2 disabled:opacity-50 transition"
              >
                Excel
              </button>
              <button
                onClick={() => download('pdf')}
                disabled={!generated || tpl.kind === 'coming-soon' || isIdleBilling}
                title={isIdleBilling ? 'PDF удахгүй гарна — одоохондоо Excel ашиглана уу' : ''}
                className="flex-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm py-2 disabled:opacity-50 transition"
              >
                PDF
              </button>
            </div>
          </div>
        </aside>

        {/* Column 3 — Results */}
        <main className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          {!generated ? (
            <EmptyResult tpl={tpl} />
          ) : generated.tplId === 'idle-billing' ? (
            <IdleBillingResult
              from={generated.from}
              to={generated.to}
              tariff={Number(generated.tariff)}
              shiftId={generated.shiftId}
            />
          ) : (
            <ReportResult
              tpl={TEMPLATES.find((t) => t.id === generated.tplId) ?? tpl}
              deviceId={generated.deviceId}
              from={generated.from}
              to={generated.to}
              deviceName={
                (devices.data ?? []).find((d: any) => d.id === generated.deviceId)?.name ??
                generated.deviceId
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ── Result rendering ──────────────────────────────────────────
function EmptyResult({ tpl }: { tpl: Template }) {
  return (
    <div className="flex-1 flex items-center justify-center text-center p-10">
      <div className="max-w-sm">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center">
          <span className="h-8 w-8">{tpl.icon}</span>
        </div>
        <h2 className="mt-4 text-lg font-semibold">{tpl.name}</h2>
        <p className="mt-1 text-sm text-slate-500">{tpl.description}</p>
        <p className="mt-6 text-xs text-slate-400">
          Машин, огноо сонгоод <span className="text-brand-700 font-medium">"Тайлан үүсгэх"</span> дарна уу.
        </p>
      </div>
    </div>
  );
}

function ReportResult(props: {
  tpl: Template;
  deviceId: string;
  from: string;
  to: string;
  deviceName: string;
}) {
  const isEvents = props.tpl.kind === 'events';
  const isEngine = props.tpl.kind === 'trip-engine';
  const isTrip = props.tpl.kind === 'trip';
  const isIdle = props.tpl.kind === 'trip-idle';
  const isMileage = props.tpl.kind === 'mileage';
  const isUtilization = props.tpl.kind === 'utilization';
  const isDaily = isMileage || isUtilization;
  const isFuelConsumption = props.tpl.kind === 'fuel-consumption';
  const fromIso = new Date(props.from).toISOString();
  const toIso = new Date(props.to).toISOString();

  // Trip endpoint still backs the speed chart for trip/idle/engine — the
  // chart needs raw points to draw cliff edges, the dedicated builder
  // endpoints return shaped session/segment lists.
  const trip = useQuery({
    queryKey: ['reports', 'trip', props.deviceId, props.from, props.to],
    queryFn: () =>
      api.get(`/reports/trip/${props.deviceId}?from=${fromIso}&to=${toIso}`).then((r) => r.data),
    enabled: !isEvents,
  });
  const engine = useQuery({
    queryKey: ['reports', 'engine-sessions', props.deviceId, props.from, props.to],
    queryFn: () =>
      api.get(`/reports/engine-sessions/${props.deviceId}?from=${fromIso}&to=${toIso}`).then((r) => r.data),
    enabled: isEngine,
  });
  const segments = useQuery({
    queryKey: ['reports', 'trip-segments', props.deviceId, props.from, props.to],
    queryFn: () =>
      api.get(`/reports/trip-segments/${props.deviceId}?from=${fromIso}&to=${toIso}`).then((r) => r.data),
    enabled: isTrip,
  });
  const idle = useQuery({
    queryKey: ['reports', 'idle-periods', props.deviceId, props.from, props.to],
    queryFn: () =>
      api.get(`/reports/idle-periods/${props.deviceId}?from=${fromIso}&to=${toIso}`).then((r) => r.data),
    enabled: isIdle,
  });
  const events = useQuery({
    queryKey: ['reports', 'events', props.deviceId, props.from, props.to],
    queryFn: () =>
      api.get(`/reports/events/${props.deviceId}?from=${fromIso}&to=${toIso}`).then((r) => r.data),
    enabled: isEvents,
  });
  const daily = useQuery({
    queryKey: ['reports', 'daily-summary', props.deviceId, props.from, props.to],
    queryFn: () =>
      api.get(`/reports/daily-summary/${props.deviceId}?from=${fromIso}&to=${toIso}`).then((r) => r.data),
    enabled: isDaily,
  });
  const fuelCons = useQuery({
    queryKey: ['reports', 'fuel-consumption', props.deviceId, props.from, props.to],
    queryFn: () =>
      api.get(`/reports/fuel-consumption/${props.deviceId}?from=${fromIso}&to=${toIso}`).then((r) => r.data),
    enabled: isFuelConsumption,
  });

  const loading = isEvents
    ? events.isLoading
    : isEngine
      ? engine.isLoading || trip.isLoading
      : isTrip
        ? segments.isLoading || trip.isLoading
        : isIdle
          ? idle.isLoading || trip.isLoading
          : isDaily
            ? daily.isLoading
            : isFuelConsumption
              ? fuelCons.isLoading
              : trip.isLoading;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs uppercase tracking-widest text-brand-700/80 font-semibold">
            {props.tpl.cat}
          </div>
          <h2 className="text-lg font-bold mt-0.5">{props.tpl.name}</h2>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div className="font-medium text-slate-700">{props.deviceName}</div>
          <div>
            {new Date(props.from).toLocaleString('mn-MN')} → {new Date(props.to).toLocaleString('mn-MN')}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading && <SkeletonResult />}
        {!loading && isEvents && (
          <EventsResult
            kind={props.tpl.id}
            allowedTypes={props.tpl.filter}
            rows={events.data ?? []}
          />
        )}
        {!loading && isEngine && engine.data && (
          <EngineResult engine={engine.data} chartPoints={trip.data?.points ?? []} />
        )}
        {!loading && isTrip && segments.data && (
          <TripsResult segments={segments.data} chartPoints={trip.data?.points ?? []} />
        )}
        {!loading && isIdle && idle.data && (
          <IdleResult idle={idle.data} />
        )}
        {!loading && isMileage && daily.data && (
          <MileageResult data={daily.data} />
        )}
        {!loading && isUtilization && daily.data && (
          <UtilizationResult data={daily.data} />
        )}
        {!loading && isFuelConsumption && fuelCons.data && (
          <FuelConsumptionResult data={fuelCons.data} />
        )}
      </div>
    </div>
  );
}

function SkeletonResult() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="h-40 rounded-xl bg-slate-100" />
      <div className="h-60 rounded-xl bg-slate-100" />
    </div>
  );
}

// ── Engine sessions (Мото цаг) ────────────────────────────────
function EngineResult({ engine, chartPoints }: { engine: any; chartPoints: any[] }) {
  const t = engine.totals ?? {};
  const sessions: any[] = engine.sessions ?? [];
  const efficiencyPct = t.totalEngineHours > 0
    ? Math.round((t.totalDrivingHours / t.totalEngineHours) * 100)
    : 0;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Мото цаг"        value={hours(t.totalEngineHours)}  accent="emerald" />
        <Kpi label="Хөдөлгөөнд"      value={hours(t.totalDrivingHours)} accent="brand" />
        <Kpi label="Сул зогсолт"     value={hours(t.totalIdleHours)}    accent="amber" />
        <Kpi label="Үр ашиг"         value={`${efficiencyPct}%`}        accent="slate" />
      </div>
      {engine.detection === 'motion' && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Анхаар: энэ төхөөрөмж <strong>ignition signal илгээгээгүй</strong> учир session-ийг
          хөдөлгөөн дээр (speed &gt; 3 км/ц) тулгуурлан тооцлоо. Хөдөлгүүр асаалттай боловч хөдөлсөнгүй
          үе сесшнд орохгүй.
        </div>
      )}

      <Panel title="Хурдны түүх" subtitle="Цэг тутмын хурд">
        <SpeedChart points={chartPoints} />
      </Panel>

      <Panel
        title="Engine sessions"
        subtitle={sessions.length === 0
          ? 'Сонгосон хугацаанд session алга'
          : `Нийт ${sessions.length} session — Excel-д бүтнээр ордог`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Эхлэлт</th>
                <th className="text-left px-3 py-2">Дуусгавар</th>
                <th className="text-right px-3 py-2">Үргэлжлэл</th>
                <th className="text-right px-3 py-2">Хөдөлгөөн</th>
                <th className="text-right px-3 py-2">Сул</th>
                <th className="text-right px-3 py-2">Зам</th>
                <th className="text-right px-3 py-2">Max км/ц</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => (
                <tr key={s.sessionNum} className="hover:bg-slate-50">
                  <td className="px-3 py-2 tabular-nums">{s.sessionNum}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(s.startAt).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(s.endAt).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(s.durationMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(s.drivingMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(s.idleMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.distanceKm.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.maxSpeed.toFixed(0)}</td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-400">Хоосон</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ── Trip segments (Зорчилт) ──────────────────────────────────
function TripsResult({ segments, chartPoints }: { segments: any; chartPoints: any[] }) {
  const t = segments.totals ?? {};
  const rows: any[] = segments.segments ?? [];
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Нийт зам"        value={km(t.distanceKm)}            accent="brand" />
        <Kpi label="Жолоодлогын цаг" value={hours((t.durationMin ?? 0) / 60)} accent="emerald" />
        <Kpi label="Дундаж хурд"     value={`${(t.avgSpeed ?? 0).toFixed(1)} км/ц`} accent="slate" />
        <Kpi label="Дээд хурд"       value={`${(t.maxSpeed ?? 0).toFixed(1)} км/ц`} accent="rose" />
      </div>

      <Panel title="Хурдны түүх" subtitle="Цэг тутмын хурд">
        <SpeedChart points={chartPoints} />
      </Panel>

      <Panel
        title="Trip жагсаалт"
        subtitle={rows.length === 0 ? 'Сонгосон хугацаанд trip алга' : `Нийт ${rows.length} trip`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Эхлэлт</th>
                <th className="text-left px-3 py-2">Дуусгавар</th>
                <th className="text-right px-3 py-2">Үргэлжлэл</th>
                <th className="text-right px-3 py-2">Зам (км)</th>
                <th className="text-right px-3 py-2">Avg км/ц</th>
                <th className="text-right px-3 py-2">Max км/ц</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((s) => (
                <tr key={s.segmentNum} className="hover:bg-slate-50">
                  <td className="px-3 py-2 tabular-nums">{s.segmentNum}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(s.startAt).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(s.endAt).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(s.durationMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.distanceKm.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.avgSpeedKmh.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.maxSpeedKmh.toFixed(0)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">Хоосон</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ── Idle periods (Зогсолт) ───────────────────────────────────
function IdleResult({ idle }: { idle: any }) {
  const t = idle.totals ?? {};
  const rows: any[] = idle.periods ?? [];
  const longest = rows.length === 0 ? 0 : Math.max(...rows.map((p: any) => p.durationMin));
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Нийт сул зогсолт" value={hours(t.totalIdleHours)} accent="amber" />
        <Kpi label="Зогсолтын тоо"    value={fmtNum(t.periodCount ?? 0)} accent="brand" />
        <Kpi label="Хамгийн урт"      value={fmtMin(longest)} accent="rose" />
        <Kpi label="Дундаж урт"       value={rows.length > 0 ? fmtMin(((t.totalIdleHours ?? 0) * 60) / rows.length) : '—'} accent="slate" />
      </div>

      <Panel
        title="Зогсолтын жагсаалт"
        subtitle={rows.length === 0 ? 'Сонгосон хугацаанд зогсолт алга' : `Нийт ${rows.length} зогсолт`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Эхлэлт</th>
                <th className="text-left px-3 py-2">Дуусгавар</th>
                <th className="text-right px-3 py-2">Үргэлжлэл</th>
                <th className="text-right px-3 py-2">Lat</th>
                <th className="text-right px-3 py-2">Lng</th>
                <th className="text-left px-3 py-2">Шалтгаан</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.periodNum} className="hover:bg-slate-50">
                  <td className="px-3 py-2 tabular-nums">{p.periodNum}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(p.startAt).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(p.endAt).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(p.durationMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.lat.toFixed(5)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.lng.toFixed(5)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {p.reason === 'ENGINE_ON_NO_MOTION'
                      ? 'Хөдөлгүүр асаалттай хөдөлгөөнгүй'
                      : 'Trip-үүдийн хооронд зогссон'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">Хоосон</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ── Mileage (Гүйлт — өдрөөр) ──────────────────────────────────
function MileageResult({ data }: { data: any }) {
  const t = data.totals ?? {};
  const days: any[] = data.days ?? [];
  const activeDays = days.filter((d) => (d.distanceKm ?? 0) >= 0.1).length;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Нийт зам"         value={km(t.distanceKm)} accent="brand" />
        <Kpi label="Хөдөлгөөнтэй цаг" value={hours((t.movingMin ?? 0) / 60)} accent="emerald" />
        <Kpi label="Дээд хурд"        value={`${(t.maxSpeed ?? 0).toFixed(0)} км/ц`} accent="rose" />
        <Kpi label="Идэвхтэй өдөр"    value={`${activeDays} / ${days.length}`} accent="slate" />
      </div>
      <Panel title="Өдрийн задаргаа" subtitle={days.length === 0 ? 'Сонгосон хугацаанд мэдээ алга' : `Нийт ${days.length} өдөр`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2">Огноо</th>
                <th className="text-right px-3 py-2">Зам (км)</th>
                <th className="text-right px-3 py-2">Хөдөлгөөнд</th>
                <th className="text-right px-3 py-2">Дээд хурд</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {days.map((d) => (
                <tr key={d.date} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{d.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(d.distanceKm ?? 0).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(d.movingMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(d.maxSpeed ?? 0).toFixed(0)} км/ц</td>
                </tr>
              ))}
              {days.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-slate-400">Хоосон</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ── Utilization (Ашиглалт — өдрөөр) ───────────────────────────
function UtilizationResult({ data }: { data: any }) {
  const t = data.totals ?? {};
  const days: any[] = data.days ?? [];
  const utilPct = (engineOnMin: number, movingMin: number) =>
    engineOnMin > 0 ? Math.round((movingMin / engineOnMin) * 100) : 0;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Асаалттай"   value={hours((t.engineOnMin ?? 0) / 60)} accent="emerald" />
        <Kpi label="Хөдөлгөөнд"  value={hours((t.movingMin ?? 0) / 60)} accent="brand" />
        <Kpi label="Сул зогсолт" value={hours((t.idleMin ?? 0) / 60)} accent="amber" />
        <Kpi label="Ашиглалт"    value={`${utilPct(t.engineOnMin ?? 0, t.movingMin ?? 0)}%`} accent="slate" />
      </div>
      {data.hasIgnition === false && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Анхаар: энэ төхөөрөмж <strong>ignition signal илгээгээгүй</strong> тул сул зогсолтыг тооцоогүй
          (ашиглалт ойролцоогоор 100% харагдана).
        </div>
      )}
      <Panel title="Өдрийн задаргаа" subtitle={days.length === 0 ? 'Сонгосон хугацаанд мэдээ алга' : `Нийт ${days.length} өдөр`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2">Огноо</th>
                <th className="text-right px-3 py-2">Асаалттай</th>
                <th className="text-right px-3 py-2">Хөдөлгөөнд</th>
                <th className="text-right px-3 py-2">Сул</th>
                <th className="text-right px-3 py-2">Ашиглалт %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {days.map((d) => (
                <tr key={d.date} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{d.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(d.engineOnMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(d.movingMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMin(d.idleMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{utilPct(d.engineOnMin ?? 0, d.movingMin ?? 0)}%</td>
                </tr>
              ))}
              {days.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">Хоосон</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ── Fuel consumption (Шатхууны зарцуулалт — нормоор) ──────────
function FuelConsumptionResult({ data }: { data: any }) {
  const t = data.totals ?? {};
  const days: any[] = data.days ?? [];
  const rate = data.rateL100Km ?? 0;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Норм (L/100км)" value={rate > 0 ? rate.toFixed(1) : '—'} accent="slate" />
        <Kpi label="Нийт зам"       value={km(t.distanceKm)} accent="brand" />
        <Kpi label="Тооцоолсон"     value={`${(t.estLiters ?? 0).toFixed(1)} L`} accent="amber" />
        <Kpi label="Багтаамж (L)"   value={data.tankCapacityL != null ? String(data.tankCapacityL) : '—'} accent="emerald" />
      </div>
      {rate <= 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Машины <strong>"Шатахууны зарцуулалт (L/100км)"</strong> талбар хоосон тул тооцоо 0 байна.
          "Машин · Төхөөрөмж"-ийн засварлах цонхны Түлш хэсэгт нормоо оруулна уу.
        </div>
      )}
      <Panel title="Өдрийн задаргаа" subtitle={days.length === 0 ? 'Сонгосон хугацаанд мэдээ алга' : `Нийт ${days.length} өдөр`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2">Огноо</th>
                <th className="text-right px-3 py-2">Зам (км)</th>
                <th className="text-right px-3 py-2">Тооцоолсон (L)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {days.map((d) => (
                <tr key={d.date} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{d.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(d.distanceKm ?? 0).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(d.estLiters ?? 0).toFixed(1)}</td>
                </tr>
              ))}
              {days.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-10 text-center text-sm text-slate-400">Хоосон</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function EventsResult({
  kind,
  allowedTypes,
  rows,
}: {
  kind: string;
  allowedTypes?: string[];
  rows: any[];
}) {
  const filtered = useMemo(
    () => (allowedTypes ? rows.filter((e) => allowedTypes.includes(e.type)) : rows),
    [rows, allowedTypes],
  );
  const bySeverity = useMemo(() => {
    const m: Record<string, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
    for (const e of filtered) m[e.severity] = (m[e.severity] ?? 0) + 1;
    return m;
  }, [filtered]);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Нийт дохиолол" value={fmtNum(filtered.length)}  accent="brand"   />
        <Kpi label="Ноцтой"        value={fmtNum(bySeverity.CRITICAL)} accent="rose" />
        <Kpi label="Анхааруулга"   value={fmtNum(bySeverity.WARNING)}  accent="amber" />
        <Kpi label="Мэдэгдэл"      value={fmtNum(bySeverity.INFO)}     accent="slate" />
      </div>

      <Panel title="Дохиоллын жагсаалт" subtitle={`Шүүлтийн дараа ${filtered.length} мөр`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2">Огноо</th>
                <th className="text-left px-3 py-2">Төрөл</th>
                <th className="text-left px-3 py-2">Зэрэг</th>
                <th className="text-left px-3 py-2">Зурваас</th>
                <th className="text-right px-3 py-2">Координат</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(e.occurredAt).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 font-medium">{eventLabel(e.type)}</td>
                  <td className="px-3 py-2"><SevChip s={e.severity} /></td>
                  <td className="px-3 py-2 text-slate-600 max-w-md truncate">{e.message ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">
                    {e.lat != null && e.lng != null ? `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}` : '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">
                    Сонгосон хугацаанд "{kind}" дохиолол алга
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ── Small reusable bits ───────────────────────────────────────
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1.5 font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold">{title}</div>
        {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'brand' | 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  const tint: Record<string, string> = {
    brand:   'text-brand-700',
    emerald: 'text-emerald-700',
    amber:   'text-amber-700',
    rose:    'text-rose-700',
    slate:   'text-slate-700',
  };
  return (
    <div className="rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className={`mt-1.5 text-2xl font-extrabold tabular-nums ${tint[accent]}`}>{value}</div>
    </div>
  );
}

function SpeedChart({ points }: { points: { time: string; speed: number }[] }) {
  if (!points || points.length < 2) {
    return <div className="text-center text-sm text-slate-400 py-10">Хурдны мэдээлэл хангалтгүй</div>;
  }
  const W = 600;
  const H = 140;
  const max = Math.max(60, ...points.map((p) => p.speed));
  const step = points.length > 200 ? Math.ceil(points.length / 200) : 1;
  const sampled = points.filter((_, i) => i % step === 0);
  const pts = sampled
    .map((p, i) => {
      const x = (i / Math.max(1, sampled.length - 1)) * W;
      const y = H - (p.speed / max) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1670f1" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#1670f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={pts} fill="none" stroke="#1670f1" strokeWidth="1.5" />
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#spd)" />
      </svg>
      <div className="absolute top-1 right-2 text-[10px] text-slate-400">max {max.toFixed(0)} км/ц</div>
    </div>
  );
}

function SevChip({ s }: { s: string }) {
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

// ── Formatters / utils ────────────────────────────────────────
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d: Date)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); }
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function hours(h: number) { return `${(h ?? 0).toFixed(1)} ц`; }
function km(k: number)    { return `${(k ?? 0).toFixed(1)} км`; }
function fmtNum(n: number) { return new Intl.NumberFormat('mn-MN').format(n ?? 0); }
function fmtMin(min: number) {
  // Pretty-print a minutes count as "Hh Mm" or "Mm" for short stints. Used
  // by the engine-sessions / trip-segments / idle-periods tables — those
  // builders return durations in fractional minutes.
  const m = Math.max(0, Math.round(min ?? 0));
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ц ${m % 60} мин`;
}
function pct(part: number, whole: number) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}
function eventLabel(t: string) {
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
    IDLE_START: 'Сул зогсолт эхэлсэн',
    IDLE_END: 'Сул зогсолт дууссан',
    POWER_CUT: 'Цахилгаан тасалдсан',
    LOW_BATTERY: 'Батарей багассан',
    DEVICE_OFFLINE: 'Төхөөрөмж офлайн',
    DEVICE_ONLINE: 'Төхөөрөмж онлайн',
    TAMPER: 'Хөндөлт',
    FUEL_FILL: 'Түлш цэнэглэв',
    FUEL_DRAIN: 'Түлш буурлаа / хулгай',
  };
  return m[t] ?? t;
}

// (icon glyphs declared up top so TEMPLATES can reference them without TDZ)

function IdleBillingResult({ from, to, tariff, shiftId }: { from: string; to: string; tariff: number; shiftId: string }) {
  const q = useQuery({
    queryKey: ['reports', 'idle-billing', from, to, tariff, shiftId],
    queryFn: () =>
      api
        .get(
          `/reports/idle-billing?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}&tariff=${tariff}` +
            (shiftId ? `&shiftId=${encodeURIComponent(shiftId)}` : ''),
        )
        .then((r) => r.data as {
          tariffPerHour: number;
          rows: Array<{
            driverId: string;
            driverName: string;
            employeeId: string | null;
            shiftName: string | null;
            idleS: number;
            idleHours: number;
            amount: number;
          }>;
          totals: { idleS: number; idleHours: number; amount: number };
        }),
  });

  if (q.isLoading) return <div className="p-6"><SkeletonResult /></div>;
  if (q.isError) return <div className="p-6 text-sm text-rose-700">Алдаа гарлаа.</div>;
  if (!q.data) return null;
  const fmt = new Intl.NumberFormat('mn-MN');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs uppercase tracking-widest text-brand-700/80 font-semibold">Ашиглалт</div>
          <h2 className="text-lg font-bold mt-0.5">Idle нэхэмжлэл</h2>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{new Date(from).toLocaleDateString('mn-MN')} → {new Date(to).toLocaleDateString('mn-MN')}</div>
          <div className="font-medium text-slate-700">Тариф: {fmt.format(q.data.tariffPerHour)} ₮/цаг</div>
        </div>
      </header>

      <div className="px-6 pt-4 grid grid-cols-3 gap-3">
        <StatTile label="Нийт жолооч" value={fmt.format(q.data.rows.length)} />
        <StatTile label="Нийт idle цаг" value={fmt.format(q.data.totals.idleHours) + ' ц'} />
        <StatTile label="Нийт дүн" value={fmt.format(q.data.totals.amount) + ' ₮'} highlight />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Жолооч</th>
                <th className="px-3 py-2 text-left">Ажилтны ID</th>
                <th className="px-3 py-2 text-left">Ээлж</th>
                <th className="px-3 py-2 text-right">Idle (цаг)</th>
                <th className="px-3 py-2 text-right">Дүн (₮)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.rows.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">Энэ хугацаанд бүртгэгдсэн idle мэдээ алга.</td></tr>
              ) : q.data.rows.map((r) => (
                <tr key={r.driverId}>
                  <td className="px-3 py-2">{r.driverName}</td>
                  <td className="px-3 py-2 text-slate-500">{r.employeeId ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{r.shiftName ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.format(r.idleHours)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.format(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            {q.data.rows.length > 0 && (
              <tfoot className="bg-slate-50 font-semibold">
                <tr>
                  <td colSpan={3} className="px-3 py-2">НИЙТ</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.format(q.data.totals.idleHours)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.format(q.data.totals.amount)} ₮</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={clsx(
      'rounded-xl border px-4 py-3',
      highlight ? 'bg-brand-50 border-brand-200' : 'bg-slate-50 border-slate-200',
    )}>
      <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className={clsx('mt-1 text-2xl font-extrabold tabular-nums', highlight ? 'text-brand-700' : 'text-slate-900')}>{value}</div>
    </div>
  );
}
