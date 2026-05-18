// "Trips" tab — recent trips for this device. Trips are produced by the
// events-engine on ignition off→on / on→off transitions.

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { EmptyState } from './shared';

export function TripsTab({ deviceId }: { deviceId: string }) {
  const trips = useQuery({
    queryKey: ['trips', deviceId],
    queryFn: () => api.get(`/trips?deviceId=${deviceId}&limit=100`).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const list: any[] = trips.data ?? [];

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-bold text-slate-900">Замууд</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Хөдөлгүүр асаалт-унтраалт хооронд хийсэн замын бичлэг.
        </p>
      </div>

      {trips.isLoading && <div className="text-slate-400 text-sm">Уншиж байна…</div>}
      {!trips.isLoading && list.length === 0 && (
        <EmptyState
          title="Зам бичигдээгүй байна"
          hint="Хөдөлгүүр асаалт илрүүлсний дараа автоматаар үүснэ."
        />
      )}

      {list.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Эхэлсэн</th>
                <th className="text-left px-3 py-2 font-semibold">Дууссан</th>
                <th className="text-right px-3 py-2 font-semibold">Үргэлжилсэн</th>
                <th className="text-right px-3 py-2 font-semibold">Зай</th>
                <th className="text-right px-3 py-2 font-semibold">Хамгийн их хурд</th>
                <th className="text-left px-3 py-2 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((t: any) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs">{new Date(t.startedAt).toLocaleString('mn-MN')}</td>
                  <td className="px-3 py-2 text-xs">{t.endedAt ? new Date(t.endedAt).toLocaleString('mn-MN') : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDuration(t.durationS)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.distanceKm != null ? `${t.distanceKm.toFixed(1)} km` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.maxSpeed != null ? `${t.maxSpeed.toFixed(0)} km/h` : '—'}</td>
                  <td className="px-3 py-2">
                    <span className={clsx(
                      'inline-flex text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-0.5',
                      t.status === 'IN_PROGRESS' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800',
                    )}>
                      {t.status === 'IN_PROGRESS' ? 'Явж байна' : 'Дууссан'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDuration(s: number): string {
  if (!s || s < 60) return `${s ?? 0}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
