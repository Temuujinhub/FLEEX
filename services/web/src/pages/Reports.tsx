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

type Kind = 'trip' | 'trip-idle' | 'trip-engine' | 'events' | 'idle-billing' | 'coming-soon';

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
  { id: 'engine',  cat: 'Ашиглалт',   name: 'Мото цаг',
    description: 'Хөдөлгүүрийн ажилласан цаг.',
    kind: 'trip-engine', icon: <I.Engine /> },
  { id: 'fuel',    cat: 'Ашиглалт',   name: 'Шатхууны зарцуулалт',
    description: 'Цэнэглэлт, хэрэглээ, гэнэтийн алдагдал.',
    kind: 'coming-soon', icon: <I.Fuel /> },
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
  const [preset, setPreset] = useState<string>('7d');
  const [from, setFrom] = useState<string>(toLocalInput(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState<string>(toLocalInput(new Date()));
  const [generated, setGenerated] = useState<{ tplId: string; deviceId: string; from: string; to: string; tariff: string } | null>(null);

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
    setGenerated({ tplId: tpl.id, deviceId, from, to, tariff });
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
        `&tariff=${encodeURIComponent(generated.tariff)}`;
      fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
        .then((r) => r.blob())
        .then((b) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = `idle-billing-${generated.from}_${generated.to}.xlsx`;
          a.click();
        });
      return;
    }
    const url =
      `${API_BASE}/reports/trip/${generated.deviceId}/${fmt}` +
      `?from=${new Date(generated.from).toISOString()}&to=${new Date(generated.to).toISOString()}`;
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${tpl.id}-${generated.deviceId}.${fmt === 'excel' ? 'xlsx' : 'pdf'}`;
        a.click();
      });
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
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                Энэ тайлан удахгүй гарна. CAN-bus / fuel-probe мэдрэгчтэй машин дээр идэвхждэг.
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
  const trip = useQuery({
    queryKey: ['reports', 'trip', props.deviceId, props.from, props.to],
    queryFn: () =>
      api
        .get(`/reports/trip/${props.deviceId}?from=${new Date(props.from).toISOString()}&to=${new Date(props.to).toISOString()}`)
        .then((r) => r.data),
    enabled: !isEvents,
  });
  const events = useQuery({
    queryKey: ['reports', 'events', props.deviceId, props.from, props.to],
    queryFn: () =>
      api
        .get(`/reports/events/${props.deviceId}?from=${new Date(props.from).toISOString()}&to=${new Date(props.to).toISOString()}`)
        .then((r) => r.data),
    enabled: isEvents,
  });

  const loading = isEvents ? events.isLoading : trip.isLoading;

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
        {!loading && !isEvents && trip.data && (
          <TripResult kind={props.tpl.kind as 'trip' | 'trip-idle' | 'trip-engine'} data={trip.data} />
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

function TripResult({ kind, data }: { kind: 'trip' | 'trip-idle' | 'trip-engine'; data: any }) {
  const kpis = (() => {
    if (kind === 'trip-idle') {
      return [
        { label: 'Сул зогсолтын цаг', value: hours(data.totalIdleHours),  accent: 'amber' as const },
        { label: 'Хөдөлгөөнтэй цаг',  value: hours(data.totalDrivingHours), accent: 'emerald' as const },
        { label: 'Idle / Total %',     value: pct(data.totalIdleHours, data.totalIdleHours + data.totalDrivingHours), accent: 'slate' as const },
        { label: 'Цэгийн тоо',         value: fmtNum(data.sampleCount),     accent: 'brand' as const },
      ];
    }
    if (kind === 'trip-engine') {
      return [
        { label: 'Мото цаг',          value: hours(data.totalDrivingHours + data.totalIdleHours), accent: 'emerald' as const },
        { label: 'Жолоодлогын цаг',   value: hours(data.totalDrivingHours), accent: 'brand'   as const },
        { label: 'Сул зогсолт',       value: hours(data.totalIdleHours),    accent: 'amber'   as const },
        { label: 'Үр ашиг',           value: pct(data.totalDrivingHours, data.totalDrivingHours + data.totalIdleHours), accent: 'slate' as const },
      ];
    }
    return [
      { label: 'Нийт зам',         value: km(data.totalDistanceKm),       accent: 'brand'   as const },
      { label: 'Жолоодлогын цаг',  value: hours(data.totalDrivingHours),  accent: 'emerald' as const },
      { label: 'Сул зогсолт',      value: hours(data.totalIdleHours),     accent: 'amber'   as const },
      { label: 'Дээд хурд',        value: `${(data.maxSpeed ?? 0).toFixed(1)} км/ц`, accent: 'rose' as const },
    ];
  })();

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <Panel title="Хурдны түүх" subtitle="Цэг тутмын хурд">
        <SpeedChart points={data.points ?? []} />
      </Panel>

      <Panel title="Зүсэлт цэгүүд" subtitle={`Эхний ${Math.min(50, data.points?.length ?? 0)} цэг`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2">Огноо</th>
                <th className="text-left px-3 py-2">Өргөрөг</th>
                <th className="text-left px-3 py-2">Уртраг</th>
                <th className="text-right px-3 py-2">Хурд</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data.points ?? []).slice(0, 50).map((p: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2">{new Date(p.time).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 tabular-nums">{p.lat.toFixed(5)}</td>
                  <td className="px-3 py-2 tabular-nums">{p.lng.toFixed(5)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.speed.toFixed(1)}</td>
                </tr>
              ))}
              {(data.points ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-sm text-slate-400">
                    Сонгосон хугацаанд өгөгдөл алга
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
  };
  return m[t] ?? t;
}

// (icon glyphs declared up top so TEMPLATES can reference them without TDZ)

function IdleBillingResult({ from, to, tariff }: { from: string; to: string; tariff: number }) {
  const q = useQuery({
    queryKey: ['reports', 'idle-billing', from, to, tariff],
    queryFn: () =>
      api
        .get(
          `/reports/idle-billing?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}&tariff=${tariff}`,
        )
        .then((r) => r.data as {
          tariffPerHour: number;
          rows: Array<{
            driverId: string;
            driverName: string;
            employeeId: string | null;
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
                <th className="px-3 py-2 text-right">Idle (цаг)</th>
                <th className="px-3 py-2 text-right">Дүн (₮)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.rows.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-400">Энэ хугацаанд бүртгэгдсэн idle мэдээ алга.</td></tr>
              ) : q.data.rows.map((r) => (
                <tr key={r.driverId}>
                  <td className="px-3 py-2">{r.driverName}</td>
                  <td className="px-3 py-2 text-slate-500">{r.employeeId ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.format(r.idleHours)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.format(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            {q.data.rows.length > 0 && (
              <tfoot className="bg-slate-50 font-semibold">
                <tr>
                  <td colSpan={2} className="px-3 py-2">НИЙТ</td>
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
