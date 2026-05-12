import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, API_BASE, getToken } from '../lib/api';

export function Reports() {
  const [deviceId, setDeviceId] = useState('');
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));

  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get('/devices').then((r) => r.data) });
  const trip = useQuery({
    queryKey: ['trip-report', deviceId, from, to],
    queryFn: () =>
      api.get(`/reports/trip/${deviceId}?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`).then((r) => r.data),
    enabled: Boolean(deviceId),
  });

  const download = (kind: 'excel' | 'pdf') => {
    if (!deviceId) return;
    const url = `${API_BASE}/reports/trip/${deviceId}/${kind}?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`;
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `trip-${deviceId}.${kind === 'excel' ? 'xlsx' : 'pdf'}`;
        a.click();
      });
  };

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Тайлан</h1>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Төхөөрөмж</label>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">— Сонгох —</option>
            {(devices.data ?? []).map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Эхлэл</label>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Төгсгөл</label>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button onClick={() => download('excel')} disabled={!deviceId} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-50">Excel</button>
        <button onClick={() => download('pdf')} disabled={!deviceId} className="rounded-md bg-rose-600 text-white px-4 py-2 text-sm disabled:opacity-50">PDF</button>
      </div>

      {trip.data && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <Stat label="Зам, км" value={trip.data.totalDistanceKm?.toFixed(2)} />
          <Stat label="Жолоодлогын цаг" value={trip.data.totalDrivingHours?.toFixed(2)} />
          <Stat label="Сул зогсолт цаг" value={trip.data.totalIdleHours?.toFixed(2)} />
          <Stat label="Хамгийн их хурд" value={trip.data.maxSpeed?.toFixed(1)} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
