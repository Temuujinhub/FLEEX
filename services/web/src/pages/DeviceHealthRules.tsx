// "Эрүүл мэндийн дүрэм" — CRUD page for DeviceHealthRule rows. The
// events-engine evaluates these every minute against each device and
// updates DeviceHealthStatus accordingly. The dashboard donut and the
// per-device Health tab read the resulting status.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';

const CHECK_TYPES = [
  { value: 'OFFLINE_GT',     label: 'Холболтгүй илүү байх (минут)',          unit: 'мин', defaults: 30  },
  { value: 'VOLTAGE_LT',     label: 'Хүчдэл бага (V)',                       unit: 'V',   defaults: 11.5 },
  { value: 'GPS_FIX_LT',     label: 'GPS хиймэл дагуул цөөн',                unit: 'шт',  defaults: 4   },
  { value: 'IGNITION_STALE', label: 'Asaalt төлөв удаан өөрчлөгдөөгүй (цаг)', unit: 'цаг', defaults: 48  },
];

const input = 'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

export function DeviceHealthRules() {
  const qc = useQueryClient();
  const rules = useQuery({
    queryKey: ['health-rules'],
    queryFn: () => api.get('/device-health/rules').then((r) => r.data),
  });
  const status = useQuery({
    queryKey: ['health-status'],
    queryFn: () => api.get('/device-health/status').then((r) => r.data),
    refetchInterval: 60_000,
  });

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const toggle = useMutation({
    mutationFn: (r: any) => api.patch(`/device-health/rules/${r.id}`, { active: !r.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health-rules'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/device-health/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health-rules'] }),
  });

  // Donut numbers from current status.
  const counts = (status.data ?? []).reduce((acc: Record<string, number>, s: any) => {
    acc[s.state] = (acc[s.state] ?? 0) + 1;
    return acc;
  }, {});
  const total = Object.values(counts).reduce((a, b) => (a as number) + (b as number), 0) || 1;

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Эрүүл мэндийн дүрэм</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Машинуудын төхөөрөмж, холболт, хүчдэлийн зөв ажиллагааг автоматаар хянана.
          </p>
        </div>
        <button onClick={() => { setCreating(true); setEditing(null); }} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow">
          + Шинэ дүрэм
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {/* Summary chips */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StateChip label="Эрүүл"        n={counts.HEALTHY ?? 0}   total={total as number} accent="emerald" />
          <StateChip label="Анхааруулга"  n={counts.WARNING ?? 0}   total={total as number} accent="amber" />
          <StateChip label="Асуудалтай"   n={counts.UNHEALTHY ?? 0} total={total as number} accent="rose" />
          <StateChip label="Тодорхойгүй"  n={counts.UNKNOWN ?? 0}   total={total as number} accent="slate" />
        </div>

        {rules.isLoading && <div className="text-slate-400">Уншиж байна…</div>}
        {!rules.isLoading && (rules.data ?? []).length === 0 && !creating && (
          <div className="rounded-lg bg-white border border-dashed border-slate-300 p-10 text-center">
            <div className="text-slate-600">Дүрэм бүртгээгүй байна</div>
            <div className="text-xs text-slate-400 mt-1">
              Жнь: "30 минут холболтгүй бол анхааруулга", "Хүчдэл 11.5V-аас бага бол анхааруулга"
            </div>
          </div>
        )}

        {(rules.data ?? []).map((r: any) => {
          const meta = CHECK_TYPES.find((c) => c.value === r.check);
          return (
            <div key={r.id} className="bg-white rounded-lg border border-slate-200 p-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{r.name}</h3>
                  {!r.active && <span className="text-[10px] uppercase tracking-widest bg-slate-200 text-slate-700 px-2 py-0.5 rounded">Идэвхгүй</span>}
                  <span className={clsx(
                    'text-[10px] uppercase tracking-widest px-2 py-0.5 rounded',
                    r.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800',
                  )}>
                    {r.severity}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Шалгалт: <b>{meta?.label ?? r.check}</b> · Босго: <b>{r.threshold}{meta?.unit ? ' ' + meta.unit : ''}</b>
                </div>
              </div>
              <div className="flex flex-col gap-1 text-right">
                <button onClick={() => toggle.mutate(r)} className="text-xs text-slate-600 hover:underline">
                  {r.active ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх'}
                </button>
                <button onClick={() => { setEditing(r); setCreating(false); }} className="text-xs text-brand-700 hover:underline">Засах</button>
                <button onClick={() => { if (confirm('Устгах уу?')) remove.mutate(r.id); }} className="text-xs text-rose-700 hover:underline">Устгах</button>
              </div>
            </div>
          );
        })}

        {(creating || editing) && (
          <RuleForm existing={editing} onDone={() => { setCreating(false); setEditing(null); qc.invalidateQueries({ queryKey: ['health-rules'] }); }} />
        )}
      </div>
    </div>
  );
}

function StateChip({ label, n, total, accent }: { label: string; n: number; total: number; accent: 'emerald' | 'amber' | 'rose' | 'slate' }) {
  const tint: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    amber:   'bg-amber-50 text-amber-900 border-amber-200',
    rose:    'bg-rose-50 text-rose-900 border-rose-200',
    slate:   'bg-slate-50 text-slate-700 border-slate-200',
  };
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className={clsx('rounded-lg border px-4 py-3', tint[accent])}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="flex items-end justify-between mt-0.5">
        <div className="text-2xl font-extrabold tabular-nums">{n}</div>
        <div className="text-xs opacity-70">{pct}%</div>
      </div>
    </div>
  );
}

function RuleForm({ existing, onDone }: { existing: any | null; onDone: () => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [check, setCheck] = useState(existing?.check ?? 'OFFLINE_GT');
  const [threshold, setThreshold] = useState(String(existing?.threshold ?? 30));
  const [severity, setSeverity] = useState(existing?.severity ?? 'WARNING');
  const [active, setActive] = useState(existing?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const meta = CHECK_TYPES.find((c) => c.value === check);
  const save = useMutation({
    mutationFn: (payload: any) =>
      existing
        ? api.patch(`/device-health/rules/${existing.id}`, payload)
        : api.post('/device-health/rules', payload),
    onSuccess: onDone,
    onError: (e: any) => setError(e?.response?.data?.message?.toString?.() ?? 'Алдаа'),
  });

  return (
    <div className="bg-white rounded-lg border border-brand-200 p-5 space-y-4 shadow-md">
      <div className="font-bold text-slate-900">{existing ? 'Дүрэм засах' : 'Шинэ эрүүл мэндийн дүрэм'}</div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Нэр *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Жнь: 30 минут холболтгүй" className={input} />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Шалгах</label>
          <select value={check} onChange={(e) => { setCheck(e.target.value); const d = CHECK_TYPES.find((c) => c.value === e.target.value); if (d) setThreshold(String(d.defaults)); }} className={input}>
            {CHECK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Босго ({meta?.unit})</label>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} className={input} />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Хүндийн зэрэг</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={input}>
            <option value="WARNING">WARNING</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Идэвхтэй
      </label>
      {error && <div className="text-xs text-rose-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
        <button
          onClick={() => {
            if (!name.trim()) return setError('Нэр оруулна уу');
            const t = parseFloat(threshold);
            if (isNaN(t)) return setError('Босгыг тоо хэлбэрээр оруулна уу');
            save.mutate({ name: name.trim(), check, threshold: t, severity, active });
          }}
          disabled={save.isPending}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-50"
        >
          {save.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
      </div>
    </div>
  );
}
