import { useEffect, useRef, useState } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { useQuery } from '@tanstack/react-query';
import { api, WS_URL, getToken } from '../lib/api';

interface DeviceRow {
  id: string;
  name: string;
  imei: string;
  online: boolean;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeed: number | null;
}

export function LiveMap() {
  const mapEl = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const markers = useRef(new Map<string, google.maps.Marker>());
  const [selected, setSelected] = useState<string | null>(null);

  const devices = useQuery<DeviceRow[]>({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
    refetchInterval: 15_000,
  });

  // Load Google Maps and draw initial markers from the REST snapshot.
  useEffect(() => {
    if (!mapEl.current || map) return;
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!key) {
      console.warn('VITE_GOOGLE_MAPS_API_KEY not set — map will not load');
      return;
    }
    const loader = new Loader({ apiKey: key, version: 'weekly' });
    loader.load().then(() => {
      const m = new google.maps.Map(mapEl.current!, {
        center: { lat: 43.0, lng: 106.0 },
        zoom: 6,
        mapTypeId: 'hybrid',
      });
      setMap(m);
    });
  }, [map]);

  useEffect(() => {
    if (!map || !devices.data) return;
    for (const d of devices.data) {
      if (d.lastLat == null || d.lastLng == null) continue;
      const pos = { lat: d.lastLat, lng: d.lastLng };
      let mk = markers.current.get(d.id);
      if (!mk) {
        mk = new google.maps.Marker({
          map,
          position: pos,
          title: d.name,
          icon: dotIcon(d.online ? '#10b981' : '#94a3b8'),
        });
        mk.addListener('click', () => setSelected(d.id));
        markers.current.set(d.id, mk);
      } else {
        mk.setPosition(pos);
        mk.setIcon(dotIcon(d.online ? '#10b981' : '#94a3b8'));
      }
    }
  }, [map, devices.data]);

  // Live updates via WebSocket.
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
        const mk = markers.current.get(m.data.deviceId);
        if (mk) {
          mk.setPosition({ lat: m.data.lat, lng: m.data.lng });
          mk.setIcon(dotIcon('#10b981'));
        }
      } catch {}
    };
    ws.onclose = () => undefined;
    return () => ws.close();
  }, [map]);

  const sel = devices.data?.find((d) => d.id === selected);

  return (
    <div className="h-full flex">
      <div ref={mapEl} className="flex-1 bg-slate-200" />
      <aside className="w-80 bg-white border-l border-slate-200 overflow-y-auto scrollbar-thin">
        <div className="p-4 border-b border-slate-200 font-semibold">Төхөөрөмжүүд ({devices.data?.length ?? 0})</div>
        <ul>
          {(devices.data ?? []).map((d) => (
            <li
              key={d.id}
              onClick={() => setSelected(d.id)}
              className={`px-4 py-3 text-sm cursor-pointer border-b border-slate-100 ${selected === d.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="font-medium">{d.name}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">IMEI {d.imei}</div>
            </li>
          ))}
        </ul>
        {sel && (
          <div className="p-4 border-t border-slate-200 text-sm bg-slate-50">
            <div className="font-semibold">{sel.name}</div>
            <div className="mt-1 text-slate-600">
              Хурд: {sel.lastSpeed?.toFixed?.(1) ?? '—'} km/h
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function dotIcon(color: string): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#0f172a',
    strokeWeight: 1.5,
    scale: 8,
  };
}
