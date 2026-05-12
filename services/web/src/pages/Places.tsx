import { ReactNode, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Circle, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import clsx from 'clsx';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';

// Байршил / Places — drop named markers on the map for depots, loading
// bays, refuelling stations, etc. The right column is a Leaflet map; the
// left column is the list. Clicking a list row pans the map; clicking the
// map (in edit mode) drops a new pin.

const TYPES = [
  { value: 'DEPOT',       label: 'Гранж',          color: '#1670f1' },
  { value: 'LOADING',     label: 'Ачаа ачих',      color: '#10b981' },
  { value: 'UNLOADING',   label: 'Ачаа буулгах',   color: '#84cc16' },
  { value: 'REFUEL',      label: 'Шатхуун цэнэг',  color: '#f59e0b' },
  { value: 'WEIGHBRIDGE', label: 'Жинлүүр',        color: '#a855f7' },
  { value: 'WORKSHOP',    label: 'Засвар',         color: '#ef4444' },
  { value: 'OFFICE',      label: 'Алба',            color: '#64748b' },
  { value: 'CHECKPOINT',  label: 'Хяналтын цэг',   color: '#0ea5e9' },
  { value: 'OTHER',       label: 'Бусад',          color: '#94a3b8' },
] as const;

const UB_CENTER: [number, number] = [47.918, 106.917];

export function Places() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ lat: number; lng: number } | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const places = useQuery({
    queryKey: ['places', typeFilter, search],
    queryFn: () => {
      const u = new URLSearchParams();
      if (typeFilter) u.set('type', typeFilter);
      if (search)     u.set('search', search);
      return api.get(`/places?${u.toString()}`).then((r) => r.data);
    },
  });

  const list: any[] = places.data ?? [];
  const selected = list.find((p) => p.id === selectedId);

  const stats = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const p of list) byType[p.type] = (byType[p.type] ?? 0) + 1;
    return { total: list.length, byType };
  }, [list]);

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Байршил · Цэгүүд</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Гранж, ачаалах талбай, шатхуун цэнэглэлт зэрэг өргөн хэрэглэгддэг газруудыг газрын зураг дээр тэмдэглэнэ.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowAdd(true); setPicking(null); }}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow"
            >
              + Шинэ цэг
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 p-4">
        {/* Left list */}
        <aside className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 space-y-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Хайх..."
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="flex flex-wrap gap-1">
              <Pill active={typeFilter === ''} onClick={() => setTypeFilter('')} label={`Бүгд · ${stats.total}`} />
              {TYPES.map((t) => (
                <Pill
                  key={t.value}
                  active={typeFilter === t.value}
                  onClick={() => setTypeFilter(t.value)}
                  label={`${t.label} · ${stats.byType[t.value] ?? 0}`}
                  color={t.color}
                />
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {places.isLoading && <div className="p-6 text-center text-slate-400 text-sm">Уншиж байна…</div>}
            {!places.isLoading && list.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-sm">
                Цэг бүртгэгдээгүй. Газрын зураг дээр товшоод "Шинэ цэг" нэмнэ үү.
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {list.map((p) => {
                const tpl = TYPES.find((t) => t.value === p.type) ?? TYPES[TYPES.length - 1];
                return (
                  <li
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={clsx(
                      'px-4 py-3 cursor-pointer flex items-start gap-3 transition',
                      selectedId === p.id ? 'bg-brand-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <span className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                          style={{ backgroundColor: (p.color ?? tpl.color) + '22', color: p.color ?? tpl.color }}>
                      <span className="h-4 w-4"><PinIcon /></span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{p.name}</div>
                      <div className="text-xs text-slate-500 truncate">{tpl.label}{p.address ? ` · ${p.address}` : ''}</div>
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-slate-400 tabular-nums">
                      {p.latitude.toFixed(3)}, {p.longitude.toFixed(3)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* Map */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
          <div className="absolute top-3 left-3 z-[1000] flex flex-wrap items-center gap-2">
            {picking && (
              <div className="rounded-md bg-amber-100 border border-amber-300 px-3 py-2 text-xs text-amber-900 shadow">
                Шинэ цэг: {picking.lat.toFixed(5)}, {picking.lng.toFixed(5)}
              </div>
            )}
            <div className="rounded-md bg-white border border-slate-200 px-3 py-2 text-[11px] text-slate-600 shadow">
              💡 Газрын зураг дээр товшиж шинэ цэг сонгоно
            </div>
          </div>

          <MapContainer center={UB_CENTER} zoom={11} className="h-full w-full">
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickPicker onPick={(latlng) => { setPicking(latlng); setShowAdd(true); }} />
            {selected && <PanTo lat={selected.latitude} lng={selected.longitude} />}
            {list.map((p) => {
              const tpl = TYPES.find((t) => t.value === p.type) ?? TYPES[TYPES.length - 1];
              const color = p.color ?? tpl.color;
              return (
                <Marker key={p.id} position={[p.latitude, p.longitude]} icon={pinIcon(color)} eventHandlers={{ click: () => setSelectedId(p.id) }}>
                  <Popup>
                    <div className="text-xs">
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-slate-500">{tpl.label}</div>
                      {p.address && <div className="mt-1">{p.address}</div>}
                      {p.description && <div className="mt-1 text-slate-700">{p.description}</div>}
                    </div>
                  </Popup>
                  {p.radiusM ? <Circle center={[p.latitude, p.longitude]} radius={p.radiusM} pathOptions={{ color, weight: 1, fillOpacity: 0.08 }} /> : null}
                </Marker>
              );
            })}
            {picking && <Marker position={[picking.lat, picking.lng]} icon={pinIcon('#f59e0b')} />}
          </MapContainer>
        </div>
      </div>

      {showAdd && (
        <AddPlaceModal
          initial={picking}
          onClose={() => { setShowAdd(false); setPicking(null); }}
        />
      )}
    </div>
  );
}

// ── Add Place Modal ───────────────────────────────────────────
function AddPlaceModal({
  initial,
  onClose,
}: {
  initial: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<typeof TYPES[number]['value']>('DEPOT');
  const [color, setColor] = useState<string>(TYPES[0].color);
  const [lat, setLat] = useState(initial?.lat?.toString() ?? '');
  const [lng, setLng] = useState(initial?.lng?.toString() ?? '');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [radiusM, setRadiusM] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/places', payload).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['places'] }); onClose(); },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    if (name.trim().length < 2) { setError('Цэгийн нэрийг 2-оос дээш тэмдэгтээр оруулна уу'); return; }
    const latN = parseFloat(lat), lngN = parseFloat(lng);
    if (Number.isNaN(latN) || Number.isNaN(lngN)) { setError('Координат буруу байна'); return; }
    if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180) { setError('Координат хязгаараас гарсан байна'); return; }
    const payload: any = { name: name.trim(), type, latitude: latN, longitude: lngN, color };
    if (address)     payload.address     = address;
    if (description) payload.description = description;
    const r = parseInt(radiusM, 10);
    if (!Number.isNaN(r) && r > 0) payload.radiusM = r;
    mutation.mutate(payload);
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">Шинэ цэг</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        <div className="p-6 space-y-4 overflow-y-auto">
          <Field label="Нэр *">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Жишээ: Уурхайн талбай-А" className={input} />
          </Field>
          <Field label="Төрөл">
            <div className="grid grid-cols-3 gap-1.5">
              {TYPES.map((t) => (
                <button key={t.value} type="button"
                  onClick={() => { setType(t.value); setColor(t.color); }}
                  className={clsx(
                    'rounded-md border px-2 py-1.5 text-xs transition flex items-center justify-center gap-1.5',
                    type === t.value ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-200' : 'border-slate-200 hover:border-brand-300',
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Өргөрөг *">
              <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="47.918" className={input} />
            </Field>
            <Field label="Уртраг *">
              <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="106.917" className={input} />
            </Field>
          </div>
          <Field label="Хаяг">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Улаанбаатар, БЗД..." className={input} />
          </Field>
          <Field label="Радиус (метр, нэмэлт)">
            <input value={radiusM} onChange={(e) => setRadiusM(e.target.value)} placeholder="500" className={input} />
          </Field>
          <Field label="Тайлбар">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={input + ' resize-none'} />
          </Field>
          {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
        </div>
        <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">
            Цуцлах
          </button>
          <button onClick={submit} disabled={mutation.isPending}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60">
            {mutation.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Map helpers ───────────────────────────────────────────────
function MapClickPicker({ onPick }: { onPick: (latlng: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}
function PanTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  map.setView([lat, lng], Math.max(13, map.getZoom()));
  return null;
}
function pinIcon(color: string) {
  return L.divIcon({
    className: 'fleex-place-marker',
    html: `<span style="
      display:inline-block;width:18px;height:18px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);background:${color};border:2px solid #fff;
      box-shadow:0 1px 3px rgba(0,0,0,.3);
    "></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}

// ── UI bits ───────────────────────────────────────────────────
const input = 'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  label,
  color,
}: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-full px-3 py-1 text-[11px] border transition flex items-center gap-1.5',
        active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300',
      )}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: active ? '#fff' : color }} />}
      {label}
    </button>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
      <path d="M12 2C7.6 2 4 5.6 4 10c0 6 8 12 8 12s8-6 8-12c0-4.4-3.6-8-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z" />
    </svg>
  );
}
