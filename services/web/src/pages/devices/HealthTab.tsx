// "Health" tab — shows the current health status for this device based
// on the company-wide rules. Rules themselves live on a separate page;
// here we just surface what's failing.

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { EmptyState, formatRelative } from './shared';

const STATE_STYLE: Record<string, string> = {
  HEALTHY:   'bg-emerald-100 text-emerald-900 border-emerald-200',
  WARNING:   'bg-amber-100 text-amber-900 border-amber-200',
  UNHEALTHY: 'bg-rose-100 text-rose-900 border-rose-200',
  UNKNOWN:   'bg-slate-100 text-slate-700 border-slate-200',
};

const STATE_LABEL: Record<string, string> = {
  HEALTHY:   'Эрүүл',
  WARNING:   'Анхааруулга',
  UNHEALTHY: 'Асуудалтай',
  UNKNOWN:   'Тодорхойгүй',
};

export function HealthTab({ deviceId }: { deviceId: string }) {
  const health = useQuery({
    queryKey: ['device-health', deviceId],
    queryFn: () => api.get(`/device-health/status/${deviceId}`).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const data = health.data;
  const diagnoses: any[] = data?.diagnoses ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-slate-900">Эрүүл мэндийн шалгалт</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Системийн дүрэм бүрийг 60 секунд тутамд шалгаж энэ машины төлвийг шинэчилнэ.
        </p>
      </div>

      {!data && (
        <EmptyState
          title="Шалгалт хийгдээгүй байна"
          hint="Эрүүл мэндийн дүрэм идэвхтэй болсон үед автоматаар шалгана."
        />
      )}

      {data && (
        <>
          <div className={clsx('rounded-lg border p-4', STATE_STYLE[data.state])}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest font-semibold opacity-80">Төлөв</div>
                <div className="text-2xl font-bold mt-1">{STATE_LABEL[data.state]}</div>
              </div>
              <div className="text-right text-xs opacity-70">
                <div>Сүүлд шалгасан</div>
                <div className="font-mono">{new Date(data.evaluatedAt).toLocaleString('mn-MN')}</div>
              </div>
            </div>
          </div>

          {diagnoses.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Илрүүлсэн асуудал ({diagnoses.length})
              </div>
              <div className="space-y-2">
                {diagnoses.map((d, i) => (
                  <div key={i} className={clsx(
                    'rounded-md border px-3 py-2 text-sm',
                    d.severity === 'CRITICAL' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900',
                  )}>
                    <div className="font-semibold">{d.rule}</div>
                    <div className="text-xs mt-0.5">{d.message}</div>
                    <div className="text-[10px] opacity-70 mt-1">{formatRelative(d.since)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {diagnoses.length === 0 && data.state === 'HEALTHY' && (
            <div className="text-sm text-emerald-700">✓ Тус машинд илэрсэн асуудал байхгүй.</div>
          )}
        </>
      )}
    </div>
  );
}
