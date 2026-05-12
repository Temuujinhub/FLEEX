import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function History() {
  const [deviceId, setDeviceId] = useState('');
  const [from, setFrom] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
  });
  const history = useQuery({
    queryKey: ['history', deviceId, from, to],
    queryFn: () =>
      api
        .get(`/positions/${deviceId}/history?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}&limit=2000`)
        .then((r) => r.data),
    enabled: Boolean(deviceId),
  });

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Түүх</h1>
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="Төхөөрөмж">
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
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
      </div>
      <div className="text-sm text-slate-500">
        Нийт цэг: {history.data?.length ?? 0}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2">Цаг</th>
              <th className="text-left px-4 py-2">Хурд</th>
              <th className="text-left px-4 py-2">Координат</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(history.data ?? []).slice(0, 200).map((p: any, i: number) => (
              <tr key={i}>
                <td className="px-4 py-2">{new Date(p.time).toLocaleString()}</td>
                <td className="px-4 py-2">{p.speed?.toFixed?.(1) ?? '—'} km/h</td>
                <td className="px-4 py-2 text-slate-600">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
