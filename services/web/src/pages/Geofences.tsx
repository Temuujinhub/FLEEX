import { ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Circle, Polygon, Polyline, useMapEvents, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

// Geofence (газарзүйн хашаа) дизайн.
//
// 2 төрөл дэмжинэ:
//   • CIRCLE  – {lat,lng,radiusM}
//   • POLYGON – {points: [[lng,lat], ...]} (GeoJSON-тэй нийцтэй [lng,lat] дараалал)
//
// Зургийн дээр хэлбэр зурахдаа гадны library ашиглаагүй (leaflet-draw нь
// react-leaflet 4-тэй сайн ажиллахгүй) — leaflet-н L.LatLng + useMapEvents
// hook-уудаар гараар хийсэн. Тойргийн хувьд center дарж radius slider-аар
// тохируулна; олон өнцөгтөн нь vertex бүрийг дарж "Дуусгах" товчоор хаана.

type Shape = 'CIRCLE' | 'POLYGON';
type Mode = 'view' | 'draw_circle' | 'draw_polygon';

type Geofence = {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  shape: Shape;
  geometry: any;
  speedLimit: number | null;
  active: boolean;
  alertOnEnter: boolean;
  alertOnExit: boolean;
  createdAt: string;
};

const UB_CENTER: [number, number] = [47.918, 106.917];

export function Geofences() {
  const hasRole = useAuth((s) => s.hasRole);
  const canEdit = hasRole('FLEET_MANAGER');
  const canDelete = hasRole('COMPANY_ADMIN');

  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState<DraftGeofence | null>(null);
  const [selected, setSelected] = useState<Geofence | null>(null);
  const [showHelp, setShowHelp] = useState(true);

  const list = useQuery({
    queryKey: ['geofences'],
    queryFn: () => api.get<Geofence[]>('/geofences').then((r) => r.data),
  });

  const cancelDraft = () => { setDraft(null); setMode('view'); };

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-4 bg-white border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Geofence бүс</h1>
          <p className="text-sm text-slate-500 mt-0.5">Газарзүйн хашаа болон ороход/гарахад илгээх дохиолол.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHelp((v) => !v)} className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2 text-slate-700">
            {showHelp ? 'Зааврыг хаах' : 'Заавар үзэх'}
          </button>
          {canEdit && mode === 'view' && !draft && (
            <>
              <button onClick={() => setMode('draw_circle')} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow-sm">
                ◯ Тойрог зурах
              </button>
              <button onClick={() => setMode('draw_polygon')} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow-sm">
                ▱ Олон өнцөгт
              </button>
            </>
          )}
          {(mode !== 'view' || draft) && (
            <button onClick={cancelDraft} className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2 text-slate-700">
              Цуцлах
            </button>
          )}
        </div>
      </header>

      {showHelp && (
        <div className="mx-6 md:mx-8 mt-4 bg-gradient-to-br from-brand-50 to-white border border-brand-200 rounded-xl p-5 space-y-3 text-sm">
          <div>
            <b className="text-brand-900">Geofence гэж юу вэ?</b> Газарзүйн "хашаа" — машин ороход / гарахад
            автомат дохиолол үүсгэдэг бүс. Жишээ:
            <ul className="list-disc list-inside mt-1 ml-1 text-slate-700">
              <li><b>Уурхайн нутаг</b> — машин нутгаас гарвал диспетчерт даруй мэдэгдэнэ</li>
              <li><b>Бензин шатахуун станц</b> — машин ороход цаг тэмдэглэх</li>
              <li><b>Хурдны хязгаартай бүс</b> — заасан хурдыг хэтэрвэл дохиолол</li>
            </ul>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-white border border-slate-200 rounded-lg p-3">
              <div className="font-semibold text-slate-900 mb-1">◯ Тойрог үүсгэх</div>
              <ol className="list-decimal list-inside text-xs text-slate-600 space-y-0.5">
                <li>"Тойрог зурах" дар</li>
                <li>Газрын зураг дээр <b>төв цэгийг даран</b> сонго</li>
                <li>Радиус slider-аар хэмжээг тогтоо</li>
                <li>Нэр, тохиргоо оруулан "Хадгалах"</li>
              </ol>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-3">
              <div className="font-semibold text-slate-900 mb-1">▱ Олон өнцөгтөн</div>
              <ol className="list-decimal list-inside text-xs text-slate-600 space-y-0.5">
                <li>"Олон өнцөгт" дар</li>
                <li>Зураг дээр <b>vertex бүрийг даран</b> зурна</li>
                <li>3+ цэгтэй болсны дараа "Дуусгах" товч идэвхжинэ</li>
                <li>Нэр, тохиргоо оруулан "Хадгалах"</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <MapContainer center={UB_CENTER} zoom={11} className="h-full w-full" scrollWheelZoom>
            <LayersControl position="topright">
              <LayersControl.BaseLayer checked name="OpenStreetMap">
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="© OpenStreetMap" />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite (Esri)">
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
              </LayersControl.BaseLayer>
            </LayersControl>

            {(list.data ?? []).filter((g) => g.id !== selected?.id).map((g) => (
              <ExistingShape key={g.id} g={g} faded={!g.active} onClick={() => setSelected(g)} />
            ))}
            {selected && <ExistingShape g={selected} highlighted />}

            <DrawingLayer mode={mode} draft={draft} setDraft={setDraft} setMode={setMode} />
          </MapContainer>

          {(mode === 'draw_circle' || mode === 'draw_polygon') && !draft && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg">
              {mode === 'draw_circle' ? 'Тойргийн төв цэгийг зураг дээр дар' : 'Олон өнцөгтийн эхний vertex-ийг дар'}
            </div>
          )}
          {mode === 'draw_polygon' && draft?.shape === 'POLYGON' && draft.points.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg flex items-center gap-3">
              <span>{draft.points.length} цэг — vertex нэмэх эсвэл</span>
              {draft.points.length >= 3 ? (
                <button
                  onClick={() => setDraft({ ...draft, finished: true })}
                  className="bg-white text-brand-700 px-2 py-0.5 rounded text-xs hover:bg-brand-50"
                >
                  Дуусгах
                </button>
              ) : (
                <span className="text-xs opacity-80">(дор хаяж 3 цэг)</span>
              )}
            </div>
          )}
        </div>

        <aside className="w-80 shrink-0 bg-white border-l border-slate-200 overflow-y-auto">
          {draft ? (
            <DraftForm
              draft={draft}
              setDraft={setDraft}
              onCancel={cancelDraft}
              onSaved={cancelDraft}
            />
          ) : selected ? (
            <SelectedPanel
              g={selected}
              canEdit={canEdit}
              canDelete={canDelete}
              onClose={() => setSelected(null)}
            />
          ) : (
            <GeofenceList items={list.data ?? []} loading={list.isLoading} onSelect={setSelected} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ExistingShape({ g, faded, highlighted, onClick }: { g: Geofence; faded?: boolean; highlighted?: boolean; onClick?: () => void }) {
  const color = highlighted ? '#dc2626' : faded ? '#94a3b8' : '#1670f1';
  const opacity = faded ? 0.3 : 0.6;
  if (g.shape === 'CIRCLE') {
    const { lat, lng, radiusM } = g.geometry as { lat: number; lng: number; radiusM: number };
    return (
      <Circle
        center={[lat, lng]}
        radius={radiusM}
        pathOptions={{ color, fillOpacity: opacity * 0.3, weight: highlighted ? 3 : 2 }}
        eventHandlers={onClick ? { click: onClick } : undefined}
      />
    );
  }
  const points = (g.geometry as { points: number[][] }).points;
  const positions: [number, number][] = points.map(([lng, lat]) => [lat, lng]);
  return (
    <Polygon
      positions={positions}
      pathOptions={{ color, fillOpacity: opacity * 0.3, weight: highlighted ? 3 : 2 }}
      eventHandlers={onClick ? { click: onClick } : undefined}
    />
  );
}

type DraftGeofence =
  | { shape: 'CIRCLE'; lat: number; lng: number; radiusM: number }
  | { shape: 'POLYGON'; points: number[][]; finished?: boolean };

function DrawingLayer({
  mode, draft, setDraft, setMode,
}: { mode: Mode; draft: DraftGeofence | null; setDraft: (d: DraftGeofence | null) => void; setMode: (m: Mode) => void }) {
  useMapEvents({
    click(e) {
      if (mode === 'draw_circle' && !draft) {
        setDraft({ shape: 'CIRCLE', lat: e.latlng.lat, lng: e.latlng.lng, radiusM: 500 });
        setMode('view');
      } else if (mode === 'draw_polygon') {
        const next: number[][] = draft?.shape === 'POLYGON' && !draft.finished
          ? [...draft.points, [e.latlng.lng, e.latlng.lat]]
          : [[e.latlng.lng, e.latlng.lat]];
        setDraft({ shape: 'POLYGON', points: next, finished: false });
      }
    },
    dblclick(e) {
      if (mode === 'draw_polygon' && draft?.shape === 'POLYGON' && draft.points.length >= 3) {
        e.originalEvent.preventDefault();
        setDraft({ ...draft, finished: true });
      }
    },
  });

  if (!draft) return null;

  if (draft.shape === 'CIRCLE') {
    return (
      <>
        <Marker position={[draft.lat, draft.lng]} icon={crosshairIcon} />
        <Circle center={[draft.lat, draft.lng]} radius={draft.radiusM} pathOptions={{ color: '#1670f1', dashArray: '5,5', fillOpacity: 0.15 }} />
      </>
    );
  }

  const latlngs: [number, number][] = draft.points.map(([lng, lat]) => [lat, lng]);
  return (
    <>
      {latlngs.map((p, i) => <Marker key={i} position={p} icon={vertexIcon} />)}
      {draft.finished
        ? <Polygon positions={latlngs} pathOptions={{ color: '#1670f1', fillOpacity: 0.15 }} />
        : latlngs.length >= 2
          ? <Polyline positions={latlngs} pathOptions={{ color: '#1670f1', dashArray: '5,5' }} />
          : null}
    </>
  );
}

const crosshairIcon = L.divIcon({
  className: 'fleex-marker',
  html: '<div style="width:18px;height:18px;border:3px solid #1670f1;border-radius:9999px;background:white;box-shadow:0 0 0 2px rgba(22,112,241,.25)"></div>',
  iconSize: [18, 18], iconAnchor: [9, 9],
});
const vertexIcon = L.divIcon({
  className: 'fleex-marker',
  html: '<div style="width:10px;height:10px;background:#1670f1;border:2px solid white;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
  iconSize: [10, 10], iconAnchor: [5, 5],
});

function DraftForm({
  draft, setDraft, onCancel, onSaved,
}: { draft: DraftGeofence; setDraft: (d: DraftGeofence) => void; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [speedLimit, setSpeedLimit] = useState<string>('');
  const [alertOnEnter, setAlertOnEnter] = useState(true);
  const [alertOnExit, setAlertOnExit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const polygonReady = draft.shape === 'POLYGON' ? draft.points.length >= 3 && !!draft.finished : true;

  const mutation = useMutation({
    mutationFn: () => {
      const geometry = draft.shape === 'CIRCLE'
        ? { lat: draft.lat, lng: draft.lng, radiusM: draft.radiusM }
        : { points: draft.points };
      const body: Record<string, any> = {
        name: name.trim(), shape: draft.shape, geometry, alertOnEnter, alertOnExit,
      };
      if (description.trim()) body.description = description.trim();
      if (speedLimit) body.speedLimit = Number(speedLimit);
      return api.post('/geofences', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['geofences'] });
      onSaved();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа');
    },
  });

  const submit = () => {
    setError(null);
    if (name.trim().length < 2) { setError('Нэр оруулна уу'); return; }
    if (!polygonReady) { setError('Олон өнцөгтийг "Дуусгах" дарж хаа'); return; }
    mutation.mutate();
  };

  return (
    <div className="p-5 space-y-4">
      <h3 className="text-base font-bold">Шинэ geofence</h3>
      <div className="bg-slate-100 rounded-md px-3 py-2 text-xs text-slate-700">
        {draft.shape === 'CIRCLE'
          ? <>◯ Тойрог · {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}</>
          : <>▱ Олон өнцөгт · {draft.points.length} vertex {draft.finished ? '· бэлэн' : '· "Дуусгах" товч дар'}</>}
      </div>

      <Field label="Нэр *">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Уурхайн нутаг" className={input} />
      </Field>

      <Field label="Тайлбар">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Тайлбар (заавал биш)" rows={2} className={input} />
      </Field>

      {draft.shape === 'CIRCLE' && (
        <Field label={`Радиус: ${draft.radiusM} м`}>
          <input
            type="range" min="50" max="20000" step="50" value={draft.radiusM}
            onChange={(e) => setDraft({ ...draft, radiusM: Number(e.target.value) })}
            className="w-full"
          />
          <input
            type="number" min="10" value={draft.radiusM}
            onChange={(e) => setDraft({ ...draft, radiusM: Math.max(10, Number(e.target.value)) })}
            className={input + ' mt-1'}
          />
        </Field>
      )}

      <Field label="Хурдны хязгаар (km/h, заавал биш)">
        <input type="number" min="0" value={speedLimit} onChange={(e) => setSpeedLimit(e.target.value)} placeholder="40" className={input} />
      </Field>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={alertOnEnter} onChange={(e) => setAlertOnEnter(e.target.checked)} />
          <span>Ороход дохиолол</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={alertOnExit} onChange={(e) => setAlertOnExit(e.target.checked)} />
          <span>Гарахад дохиолол</span>
        </label>
      </div>

      {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}

      <div className="flex gap-2 pt-2 border-t border-slate-200">
        <button onClick={onCancel} className="flex-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
        <button onClick={submit} disabled={mutation.isPending} className="flex-1 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 disabled:opacity-60">
          {mutation.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
      </div>
    </div>
  );
}

function SelectedPanel({
  g, canEdit, canDelete, onClose,
}: { g: Geofence; canEdit: boolean; canDelete: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useMutation({
    mutationFn: (data: Partial<Geofence>) => api.patch(`/geofences/${g.id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geofences'] }),
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/geofences/${g.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofences'] }); onClose(); },
  });

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-start justify-between">
        <h3 className="text-base font-bold">{g.name}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
      </div>
      <div className="text-xs text-slate-500">
        {g.shape === 'CIRCLE' ? '◯ Тойрог' : '▱ Олон өнцөгт'} · {g.active ? <span className="text-emerald-700">идэвхтэй</span> : <span className="text-slate-500">идэвхгүй</span>}
      </div>
      {g.description && <p className="text-sm text-slate-700">{g.description}</p>}

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat label="Хурдны хязгаар" value={g.speedLimit ? `${g.speedLimit} km/h` : '—'} />
        <Stat label="Үүсгэсэн" value={new Date(g.createdAt).toLocaleDateString()} />
        <Stat label="Орох дохиолол" value={g.alertOnEnter ? 'Тийм' : 'Үгүй'} />
        <Stat label="Гарах дохиолол" value={g.alertOnExit ? 'Тийм' : 'Үгүй'} />
      </div>

      {canEdit && (
        <div className="space-y-2 pt-2 border-t border-slate-200">
          <button onClick={() => update.mutate({ active: !g.active })} disabled={update.isPending} className="w-full rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2 text-slate-700">
            {g.active ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх'}
          </button>
          <button onClick={() => update.mutate({ alertOnEnter: !g.alertOnEnter })} disabled={update.isPending} className="w-full rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2 text-slate-700">
            {g.alertOnEnter ? 'Ороход дохиолол хаах' : 'Ороход дохиолол асаах'}
          </button>
          <button onClick={() => update.mutate({ alertOnExit: !g.alertOnExit })} disabled={update.isPending} className="w-full rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2 text-slate-700">
            {g.alertOnExit ? 'Гарахад дохиолол хаах' : 'Гарахад дохиолол асаах'}
          </button>
        </div>
      )}

      {canDelete && (
        <div className="pt-2 border-t border-slate-200">
          {confirmDelete ? (
            <div className="space-y-2">
              <p className="text-xs text-rose-700">Бүрмөсөн устгах уу? Буцаах боломжгүй.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-md border border-slate-300 bg-white text-sm px-3 py-1.5">Цуцлах</button>
                <button onClick={() => del.mutate()} disabled={del.isPending} className="flex-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-3 py-1.5">
                  Тийм устга
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="w-full rounded-md border border-rose-300 bg-white hover:bg-rose-50 text-sm font-medium px-3 py-2 text-rose-700">
              Устгах
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GeofenceList({ items, loading, onSelect }: { items: Geofence[]; loading: boolean; onSelect: (g: Geofence) => void }) {
  if (loading) return <div className="p-5 text-sm text-slate-400">Ачаалж байна…</div>;
  if (items.length === 0) {
    return (
      <div className="p-5 text-sm text-slate-500 text-center">
        Geofence үүсгээгүй байна.<br />
        Дээрх "Тойрог зурах" товчоор эхлээрэй.
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-100">
      {items.map((g) => (
        <button key={g.id} onClick={() => onSelect(g)} className="w-full text-left px-4 py-3 hover:bg-slate-50 transition">
          <div className="flex items-center gap-2">
            <span className="text-xs">{g.shape === 'CIRCLE' ? '◯' : '▱'}</span>
            <span className="font-medium text-slate-900 truncate flex-1">{g.name}</span>
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', g.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600')}>
              {g.active ? 'ON' : 'OFF'}
            </span>
          </div>
          {g.description && <div className="text-xs text-slate-500 mt-0.5 truncate">{g.description}</div>}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className="text-slate-900 font-medium">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}

const input =
  'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';
