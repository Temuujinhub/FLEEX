// "Counters" tab — exposes the per-device GPRS byte counter and a small
// summary of the live odometer / engine hours snapshot from the device
// row itself. Manual reset is per-month.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { EmptyState, formatBytes } from './shared';

export function CountersTab({ deviceId }: { deviceId: string }) {
  const qc = useQueryClient();
  const device = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}`).then((r) => r.data),
  });
  const gprs = useQuery({
    queryKey: ['gprs', deviceId],
    queryFn: () => api.get(`/gprs?deviceId=${deviceId}`).then((r) => r.data),
    refetchInterval: 30_000,
  });
  const ym = new Date().toISOString().slice(0, 7);
  const reset = useMutation({
    mutationFn: () => api.post(`/gprs/${deviceId}/reset/${ym}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gprs', deviceId] }),
  });
  const [confirmReset, setConfirmReset] = useState(false);

  const rows: any[] = gprs.data ?? [];
  const d = device.data;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-slate-900">Тоолуурууд</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Гүйлт, хөдөлгүүрийн цаг, GPRS дата хэрэглээний хяналт.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Stat label="Гүйлт (одометр)" value={d?.odometerKm != null ? `${d.odometerKm.toFixed(0)} km` : '—'} hint="GPS-аас уншигдсан утга" />
        <Stat label="Хөдөлгүүрийн цаг" value={d?.engineHours != null ? `${d.engineHours.toFixed(1)} h` : '—'} hint="GPS-аас уншигдсан утга" />
        <Stat label="Хүчдэл (батарей)" value={d?.batteryVolt != null ? `${d.batteryVolt.toFixed(1)} V` : '—'} hint="Гадаад тэжээлийн хүчдэл" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">GPRS дата хэрэглээ (саруудаар)</div>
          <button
            onClick={() => setConfirmReset(true)}
            className="text-xs text-rose-700 hover:underline"
          >
            Энэ сарыг тэглэх
          </button>
        </div>

        {gprs.isLoading && <div className="text-slate-400 text-sm">Уншиж байна…</div>}
        {!gprs.isLoading && rows.length === 0 && (
          <EmptyState title="GPRS дата бүртгэгдээгүй байна" hint="GPS-ээс мессеж ирэхэд автоматаар тоологдоно." />
        )}
        {rows.length > 0 && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Сар</th>
                  <th className="text-right px-3 py-2 font-semibold">Хүлээн авсан</th>
                  <th className="text-right px-3 py-2 font-semibold">Пакетын тоо</th>
                  <th className="text-right px-3 py-2 font-semibold">Сүүлд тэглэсэн</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r: any) => (
                  <tr key={`${r.deviceId}-${r.yearMonth}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{r.yearMonth}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBytes(Number(r.bytesRx))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.packetCount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">
                      {r.resetAt ? new Date(r.resetAt).toLocaleDateString('mn-MN') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmReset && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-3">
            <div className="font-bold text-slate-900">Тоолуур тэглэх — {ym}</div>
            <p className="text-sm text-slate-700">
              Энэ машины <b>{ym}</b> сарын GPRS дата тоологчийг 0 болгож тэглэнэ. Үргэлжлүүлэх үү?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmReset(false)} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-3 py-2">Цуцлах</button>
              <button
                onClick={() => { reset.mutate(); setConfirmReset(false); }}
                disabled={reset.isPending}
                className="rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"
              >
                Тэглэх
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}
