// "Messages" tab — read-only raw packet viewer. Polls every 10 s and
// shows the last few hundred raw frames the ingestor has stored. Used by
// support / installation engineers to debug "why isn't this device
// reporting?" or "is the fuel sensor wiring right?".

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { EmptyState, formatBytes } from './shared';

export function MessagesTab({ deviceId }: { deviceId: string }) {
  const [auto, setAuto] = useState(true);
  const msgs = useQuery({
    queryKey: ['messages', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}/messages?limit=200`).then((r) => r.data),
    refetchInterval: auto ? 10_000 : false,
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const list: any[] = msgs.data?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900">Түүхий мессеж</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            GPS-ээс ирсэн сүүлийн ~500 пакетын debug viewer. Сүүлийн 200-г харуулна.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Авто-сэргээх (10 сек)
        </label>
      </div>

      {msgs.isLoading && <div className="text-slate-400 text-sm">Уншиж байна…</div>}
      {!msgs.isLoading && list.length === 0 && (
        <EmptyState
          title="Мессеж байхгүй байна"
          hint="GPS төхөөрөмж сервертэй холбогдсон үед энд тогтмол мессеж гарч ирнэ."
        />
      )}

      {list.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Хугацаа</th>
                <th className="text-left px-3 py-2 font-semibold">Протокол</th>
                <th className="text-right px-3 py-2 font-semibold">Хурд</th>
                <th className="text-left px-3 py-2 font-semibold">Asaalt</th>
                <th className="text-right px-3 py-2 font-semibold">Хэмжээ</th>
                <th className="text-left px-3 py-2 font-semibold">IO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((m) => {
                const isOpen = expanded === m.id;
                const ioCount = m.payload && typeof m.payload === 'object'
                  ? Object.keys(m.payload).filter((k) => k.startsWith('io_')).length
                  : 0;
                return (
                  <>
                    <tr key={m.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(isOpen ? null : m.id)}>
                      <td className="px-3 py-2 text-xs text-slate-600 tabular-nums">{new Date(m.receivedAt).toLocaleTimeString('mn-MN')}</td>
                      <td className="px-3 py-2 text-xs">{m.protocol}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">{m.speed != null ? `${m.speed.toFixed(0)} km/h` : '—'}</td>
                      <td className="px-3 py-2 text-xs">{m.ignition == null ? '—' : (m.ignition ? '🟢 On' : '⚪ Off')}</td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500 tabular-nums">{formatBytes(m.byteSize ?? 0)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{ioCount} param</td>
                    </tr>
                    {isOpen && (
                      <tr key={m.id + '-payload'} className="bg-slate-50">
                        <td colSpan={6} className="px-3 py-2">
                          <pre className="text-[11px] font-mono text-slate-700 overflow-x-auto max-h-64 whitespace-pre-wrap">
                            {JSON.stringify({ lat: m.lat, lng: m.lng, ...m.payload }, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
