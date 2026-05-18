import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';

// "Маршрут · Түүх" — pick a device + date range, draw the traveled path
// on the map as a continuous polyline. Each stop (speed under 2 km/h
// for more than 5 minutes) becomes a small grey marker; the start and
// end of the range get green / red flags. The data source is the
// `positions` hypertable, queried via the existing
// `/positions/:deviceId/history` endpoint.

const startIcon = L.divIcon({
  className: 'fleex-marker',
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:#10b981;border:2px solid #064e3b;box-shadow:0 0 0 2px rgba(16,185,129,.25)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8],
});
const endIcon = L.divIcon({
  className: 'fleex-marker',
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:#ef4444;border:2px solid #7f1d1d;box-shadow:0 0 0 2px rgba(239,68,68,.25)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8],
});
const stopIcon = L.divIcon({
  className: 'fleex-marker',
  html: '<div style="width:10px;height:10px;border-radius:9999px;background:#475569;border:2px solid #1e293b"></div>',
  iconSize: [10, 10], iconAnchor: [5, 5],
});

interface Position {
  time: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  altitude: number | null;
}

export function History() {
  const [deviceId, setDeviceId] = useState('');
  const [from, setFrom] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
  });
  const history = useQuery<Position[]>({
    queryKey: ['history', deviceId, from, to],
    queryFn: () =>
      api
        .get(`/positions/${deviceId}/history?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}&limit=5000`)
        .then((r) => r.data),
    enabled: Boolean(deviceId),
  });

  const list = history.data ?? [];

  // Track summary: distance, duration, peak / avg speed, stop count.
  const summary = useMemo(() => {
    if (list.length < 2) return null;
    let distKm = 0;
    let maxSpeed = 0;
    let speedSum = 0;
    let speedCount = 0;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      distKm += haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
      const s = b.speed ?? 0;
      if (s > maxSpeed) maxSpeed = s;
      if (s > 0) { speedSum += s; speedCount++; }
    }
    const tStart = new Date(list[0].time).getTime();
    const tEnd = new Date(list[list.length - 1].time).getTime();
    const durationS = Math.max(0, Math.round((tEnd - tStart) / 1000));
    return {
      distKm,
      maxSpeed,
      avgSpeed: speedCount > 0 ? speedSum / speedCount : 0,
      durationS,
      stops: detectStops(list).length,
    };
  }, [list]);

  const polyline = useMemo<[number, number][]>(
    () => list.filter((p) => p.latitude !== 0 || p.longitude !== 0)
              .map((p) => [p.latitude, p.longitude]),
    [list],
  );
  const stops = useMemo(() => detectStops(list), [list]);
  const start = list[0];
  const end = list[list.length - 1];

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-4 bg-white border-b border-slate-200">
        <h1 className="text-2xl font-bold">Маршрут · Түүх</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Машины тодорхой хугацаанд явсан замыг газрын зураг дээр сэргээж харна.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 items-end">
          <Field label="Машин">
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm min-w-[180px]"
            >
              <option value="">— Сонгох —</option>
              {(devices.data ?? []).map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Эхлэл">
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </Field>
          <Field label="Төгсгөл">
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </Field>
          {summary && (
            <div className="ml-auto flex flex-wrap gap-2 text-xs">
              <Stat label="Замын урт"  value={`${summary.distKm.toFixed(1)} km`} />
              <Stat label="Үргэлжилсэн" value={formatDuration(summary.durationS)} />
              <Stat label="Хамгийн их хурд" value={`${summary.maxSpeed.toFixed(0)} km/h`} />
              <Stat label="Дундаж хурд"  value={`${summary.avgSpeed.toFixed(0)} km/h`} />
              <Stat label="Зогсолт"      value={`${summary.stops}`} />
              <Stat label="Цэгийн тоо"   value={`${list.length}`} />
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 relative">
        {!deviceId && (
          <div className="absolute inset-0 z-[400] flex items-center justify-center bg-slate-100/40 pointer-events-none">
            <div className="bg-white rounded-lg border border-slate-200 shadow px-6 py-4 text-sm text-slate-600">
              Машинаа сонгож, эхлэл / төгсгөлийн огноог өгнө үү.
            </div>
          </div>
        )}
        {history.isLoading && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] bg-white border border-slate-200 rounded-md shadow px-3 py-1.5 text-sm">
            Уншиж байна…
          </div>
        )}
        <MapContainer
          center={[47.92, 106.91]}
          zoom={11}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          {polyline.length >= 2 && (
            <Polyline positions={polyline} pathOptions={{ color: '#1670f1', weight: 4, opacity: 0.85 }} />
          )}
          {start && (start.latitude !== 0 || start.longitude !== 0) && (
            <Marker position={[start.latitude, start.longitude]} icon={startIcon} />
          )}
          {end && end !== start && (end.latitude !== 0 || end.longitude !== 0) && (
            <Marker position={[end.latitude, end.longitude]} icon={endIcon} />
          )}
          {stops.map((s, i) => (
            <Marker key={i} position={[s.lat, s.lng]} icon={stopIcon} />
          ))}
          <FitToBoundsOnce points={polyline} />
        </MapContainer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 min-w-[88px]">
      <div className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

// Re-center the map on the polyline once fresh data lands.
function FitToBoundsOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [points.length, map]);
  return null;
}

// Haversine distance in km between two WGS84 points. Approximate (~0.5%
// error) but more than enough for fleet mileage at street scale.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// A "stop" is a contiguous run of points with speed under 2 km/h that
// lasted at least 5 minutes. We mark its centroid on the map so the
// operator can spot loading bays, fuel stops, idle parking.
function detectStops(list: Position[]): { lat: number; lng: number; sec: number }[] {
  const out: { lat: number; lng: number; sec: number }[] = [];
  let runStart = -1;
  for (let i = 0; i < list.length; i++) {
    const slow = (list[i].speed ?? 0) < 2;
    if (slow && runStart < 0) runStart = i;
    if ((!slow || i === list.length - 1) && runStart >= 0) {
      const end = !slow ? i - 1 : i;
      if (end > runStart) {
        const t0 = new Date(list[runStart].time).getTime();
        const t1 = new Date(list[end].time).getTime();
        const sec = Math.max(0, (t1 - t0) / 1000);
        if (sec >= 300) {
          let lat = 0, lng = 0, n = 0;
          for (let k = runStart; k <= end; k++) {
            lat += list[k].latitude;
            lng += list[k].longitude;
            n++;
          }
          out.push({ lat: lat / n, lng: lng / n, sec });
        }
      }
      runStart = -1;
    }
  }
  return out;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}
