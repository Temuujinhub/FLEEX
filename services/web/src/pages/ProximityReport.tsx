import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MapContainer, Marker, Circle, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, API_BASE, getToken } from '../lib/api';
import { BasemapPicker } from '../components/BasemapPicker';

// Historical proximity report — "which vehicles passed within R meters of
// point (lat, lng) between [from, to]". Mostly used for incident review:
// pin the point where something happened, set a radius, see who was
// nearby. Backs the Oyu Tolgoi GPS service "proximity search and
// historical reports" requirement that's been an open gap.

const UB_CENTER: [number, number] = [47.92, 106.91];

interface ProximityResult {
  query: { lat: number; lng: number; radiusM: number; from: string; to: string };
  truncated: boolean;
  summary: {
    deviceId: string;
    deviceName: string;
    plateNumber: string | null;
    imei: string;
    hits: number;
    minDistanceM: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }[];
  hits: {
    deviceId: string;
    deviceName: string;
    plateNumber: string | null;
    imei: string;
    time: string;
    lat: number;
    lng: number;
    speed: number | null;
    distanceM: number;
  }[];
}

const targetIcon = L.divIcon({
  className: 'fleex-target',
  html: '<span style="display:inline-block;width:18px;height:18px;border-radius:9999px;background:#dc2626;border:3px solid #fff;box-shadow:0 0 0 2px rgba(220,38,38,.35)"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const hitIcon = L.divIcon({
  className: 'fleex-hit',
  html: '<span style="display:inline-block;width:10px;height:10px;border-radius:9999px;background:#0891b2;border:2px solid #083344;opacity:0.8"></span>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProximityReport() {
  const [target, setTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusM, setRadiusM] = useState<number>(200);
  const [from, setFrom] = useState<string>(toLocalInput(new Date(Date.now() - 24 * 3600_000)));
  const [to, setTo] = useState<string>(toLocalInput(new Date()));
  const [result, setResult] = useState<ProximityResult | null>(null);

  const places = useQuery({
    queryKey: ['places'],
    queryFn: () => api.get('/places').then((r) => r.data),
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('Цэг сонгоно уу');
      const params = new URLSearchParams({
        lat: String(target.lat),
        lng: String(target.lng),
        radiusM: String(radiusM),
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      const r = await api.get<ProximityResult>(`/reports/proximity?${params}`);
      return r.data;
    },
    onSuccess: (data) => setResult(data),
  });

  const downloadExcel = () => {
    if (!target) return;
    const params = new URLSearchParams({
      lat: String(target.lat),
      lng: String(target.lng),
      radiusM: String(radiusM),
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    const token = getToken();
    const url = `${API_BASE}/reports/proximity/excel?${params}`;
    // Use a one-shot anchor with Authorization header isn't possible in
    // a plain <a download> — we fetch the buffer and trigger save.
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `proximity-${Date.now()}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  const usePlace = (placeId: string) => {
    const p = (places.data ?? []).find((x: any) => x.id === placeId);
    if (!p) return;
    setTarget({ lat: p.latitude, lng: p.longitude });
  };

  return (
    <div className="p-6 md:p-8 space-y-4 bg-slate-100 min-h-full">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Орчмын тайлан</h1>
          <p className="text-sm text-slate-500 mt-1">
            Тогтсон цэгийн орчмоор өнгөрсөн машинуудыг түүхэн өгөгдөл дотроос хайна. Ослын мөрдөн
            шалгалт, гэрчийн илрүүлэлтэд ашиглана.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-4">
        {/* Controls */}
        <aside className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 h-fit">
          <Field label="Цэг сонгох арга">
            <div className="text-xs text-slate-500">
              Газрын зураг дээр шууд дарах эсвэл доорх "Байршил"-аас сонгох.
            </div>
          </Field>

          <Field label="Байршил (Places)">
            <select
              onChange={(e) => e.target.value && usePlace(e.target.value)}
              value=""
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">— сонгох —</option>
              {(places.data ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Сонгосон цэг">
            <div className="text-sm font-mono">
              {target ? (
                <span>
                  {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
                </span>
              ) : (
                <span className="text-slate-400">сонгоогүй</span>
              )}
            </div>
          </Field>

          <Field label={`Радиус: ${radiusM} м`}>
            <input
              type="range"
              min={10}
              max={5000}
              step={10}
              value={radiusM}
              onChange={(e) => setRadiusM(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex gap-1 mt-1 text-xs">
              {[50, 100, 200, 500, 1000, 2000].map((r) => (
                <button
                  key={r}
                  onClick={() => setRadiusM(r)}
                  className={`flex-1 rounded px-1 py-0.5 ${
                    radiusM === r ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {r}м
                </button>
              ))}
            </div>
          </Field>

          <Field label="Эхлэл">
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Төгсгөл">
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>

          <button
            onClick={() => run.mutate()}
            disabled={!target || run.isPending}
            className="w-full rounded-md bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2.5 disabled:opacity-50"
          >
            {run.isPending ? 'Хайж байна…' : 'Тайлан үүсгэх'}
          </button>
          {run.error && (
            <div className="rounded-md bg-rose-50 text-rose-800 px-3 py-2 text-xs">
              {(run.error as Error).message}
            </div>
          )}
          <button
            onClick={downloadExcel}
            disabled={!result}
            className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm py-2 disabled:opacity-50"
          >
            Excel татах
          </button>
        </aside>

        {/* Map + results */}
        <section className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden" style={{ height: 520 }}>
            <MapContainer center={UB_CENTER} zoom={11} className="h-full w-full">
              <BasemapPicker />
              <ClickPicker onPick={(latlng) => setTarget(latlng)} />
              {target && (
                <>
                  <Marker position={[target.lat, target.lng]} icon={targetIcon}>
                    <Popup>
                      Сонгосон цэг
                      <br />
                      {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
                    </Popup>
                  </Marker>
                  <Circle
                    center={[target.lat, target.lng]}
                    radius={radiusM}
                    pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.08, weight: 1.5 }}
                  />
                </>
              )}
              {(result?.hits ?? []).slice(0, 500).map((h, i) => (
                <Marker key={i} position={[h.lat, h.lng]} icon={hitIcon}>
                  <Popup>
                    <div className="text-xs">
                      <div className="font-semibold">{h.deviceName}</div>
                      <div>{new Date(h.time).toLocaleString()}</div>
                      <div>Зай: {Math.round(h.distanceM)} м</div>
                      {h.speed != null && <div>Хурд: {h.speed.toFixed(1)} km/h</div>}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          <SummaryTable result={result} />
        </section>
      </div>
    </div>
  );
}

function SummaryTable({ result }: { result: ProximityResult | null }) {
  const totalHits = result?.hits.length ?? 0;
  const uniqueDevices = result?.summary.length ?? 0;

  if (!result) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
        Цэг сонгоод хайлт хийнэ үү.
      </div>
    );
  }

  if (uniqueDevices === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
        Заасан хугацаа болон радиусын дотор машин олдсонгүй.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm">
          <span className="font-semibold">{uniqueDevices}</span> машин · нийт{' '}
          <span className="font-semibold">{totalHits}</span> позиц
          {result.truncated && <span className="text-amber-600 ml-2">(5000 хязгаарт хүрсэн)</span>}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-4 py-2">Машин</th>
            <th className="text-left px-4 py-2">Улсын дугаар</th>
            <th className="text-right px-4 py-2">Хүрэлт</th>
            <th className="text-right px-4 py-2">Хамгийн ойр</th>
            <th className="text-left px-4 py-2">Анх</th>
            <th className="text-left px-4 py-2">Сүүлд</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {result.summary.map((s) => (
            <tr key={s.deviceId} className="hover:bg-slate-50">
              <td className="px-4 py-2 font-medium">{s.deviceName}</td>
              <td className="px-4 py-2 text-slate-600">{s.plateNumber ?? '—'}</td>
              <td className="px-4 py-2 text-right tabular-nums">{s.hits}</td>
              <td className="px-4 py-2 text-right tabular-nums">{Math.round(s.minDistanceM)} м</td>
              <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                {new Date(s.firstSeenAt).toLocaleString()}
              </td>
              <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                {new Date(s.lastSeenAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClickPicker({ onPick }: { onPick: (latlng: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

