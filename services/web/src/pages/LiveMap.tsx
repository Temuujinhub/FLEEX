import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { api, WS_URL, getToken } from '../lib/api';
import { BasemapPicker } from '../components/BasemapPicker';
import 'leaflet/dist/leaflet.css';

// Leaflet's default marker icons are loaded from a CDN that breaks under
// strict CSP. Inline two small SVG icons (online/offline) instead.
const onlineIcon = L.divIcon({
  className: 'fleex-marker',
  html: '<span style="display:inline-block;width:14px;height:14px;border-radius:9999px;background:#10b981;border:2px solid #064e3b;box-shadow:0 0 0 2px rgba(16,185,129,.25)"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});
const offlineIcon = L.divIcon({
  className: 'fleex-marker',
  html: '<span style="display:inline-block;width:14px;height:14px;border-radius:9999px;background:#94a3b8;border:2px solid #334155"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

interface DeviceRow {
  id: string;
  name: string;
  imei: string;
  online: boolean;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeed: number | null;
  lastSeenAt: string | null;
  groupId: string | null;
  group?: { id: string; name: string } | null;
  garageId?: string | null;
  garage?: { id: string; name: string } | null;
}

interface LivePosition {
  deviceId: string;
  lat: number;
  lng: number;
  speed: number;
  course: number;
  time: number;
}

export function LiveMap() {
  const [selected, setSelected] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [garageFilter, setGarageFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  // Real-time positions arriving over WebSocket override REST snapshots.
  const [livePos, setLivePos] = useState<Record<string, LivePosition>>({});

  const devices = useQuery<DeviceRow[]>({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
    refetchInterval: 15_000,
  });
  const groups = useQuery<any[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then((r) => r.data),
  });
  const garages = useQuery<any[]>({
    queryKey: ['garages'],
    queryFn: () => api.get('/garages').then((r) => r.data),
  });

  // WebSocket live updates.
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
      } catch {}
    };
    return () => ws.close();
  }, []);

  // Merge REST snapshot with WS live positions.
  const merged = useMemo(() => {
    return (devices.data ?? []).map((d) => {
      const live = livePos[d.id];
      return {
        ...d,
        lastLat: live?.lat ?? d.lastLat,
        lastLng: live?.lng ?? d.lastLng,
        lastSpeed: live?.speed ?? d.lastSpeed,
        // A live position arrived → treat as online regardless of stale REST.
        online: live ? true : d.online,
      };
    });
  }, [devices.data, livePos]);

  // Sidebar and map both filter by group / garage / free-text search.
  // Keeping the filter at the merged level means the map markers + the
  // sidebar list always stay in sync.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return merged.filter((d) => {
      if (groupFilter && d.groupId !== groupFilter) return false;
      if (garageFilter && d.garageId !== garageFilter) return false;
      if (q) {
        const hay = `${d.name} ${d.imei} ${d.group?.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [merged, groupFilter, garageFilter, search]);

  const withCoords = filtered.filter((d) => d.lastLat != null && d.lastLng != null);
  // Default center: Oyu Tolgoi area in southern Mongolia.
  const center: [number, number] = withCoords.length
    ? [withCoords[0].lastLat!, withCoords[0].lastLng!]
    : [43.0, 106.0];

  return (
    <div className="h-full flex">
      <div className="flex-1">
        <MapContainer
          center={center}
          zoom={6}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          {/* Default to Google Hybrid (satellite + labels) to match the
              Oyu Tolgoi requirement. OSM/Esri remain as offline-friendly
              fallbacks if the Google Maps script fails to load. */}
          <BasemapPicker />

          {withCoords.map((d) => (
            <Marker
              key={d.id}
              position={[d.lastLat!, d.lastLng!]}
              icon={d.online ? onlineIcon : offlineIcon}
              eventHandlers={{ click: () => setSelected(d.id) }}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-slate-500 text-xs mt-1">IMEI {d.imei}</div>
                  <div className="mt-2">
                    Хурд: <b>{d.lastSpeed?.toFixed?.(1) ?? '—'}</b> km/h
                  </div>
                  <div>
                    Сүүлд: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          <FitToBoundsOnce
            points={withCoords.map((d) => [d.lastLat!, d.lastLng!] as [number, number])}
          />
        </MapContainer>
      </div>

      <aside className="w-80 bg-white border-l border-slate-200 overflow-y-auto scrollbar-thin flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold">Төхөөрөмжүүд</span>
            <span className="text-xs text-slate-500">
              {filtered.length}{filtered.length !== merged.length ? ` / ${merged.length}` : ''}
            </span>
          </div>
          <div className="space-y-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Хайх (нэр / IMEI)…"
              className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Бүх алба нэгж</option>
              {(groups.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <select
              value={garageFilter}
              onChange={(e) => setGarageFilter(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Бүх гранж</option>
              {(garages.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        </div>
        <ul className="flex-1">
          {filtered.map((d) => (
            <li
              key={d.id}
              onClick={() => setSelected(d.id)}
              className={`px-4 py-3 text-sm cursor-pointer border-b border-slate-100 ${
                selected === d.id ? 'bg-brand-50' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    d.online ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                />
                <span className="font-medium">{d.name}</span>
              </div>
              {d.group?.name && (
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-0.5">{d.group.name}</div>
              )}
              <div className="text-xs text-slate-500 mt-0.5">
                {d.lastLat != null && d.lastLng != null
                  ? `${d.lastLat.toFixed(4)}, ${d.lastLng.toFixed(4)}`
                  : 'Байршил алга'}
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="p-6 text-sm text-slate-400 text-center">
              {merged.length === 0 ? 'Төхөөрөмж бүртгэгдээгүй' : 'Шүүлтэнд тохирох машин олдсонгүй'}
            </li>
          )}
        </ul>
      </aside>
    </div>
  );
}

// Fit map bounds to the device set the first time we have coordinates.
function FitToBoundsOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 12);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    }
    fitted.current = true;
  }, [points, map]);
  return null;
}
