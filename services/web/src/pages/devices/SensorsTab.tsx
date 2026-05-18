// "Sensors" tab — manages logical sensors for a device. Each sensor maps
// a raw protocol IO id (`io.239`, `io.66`, ...) onto a named value with
// a linear calibration. The list shows the latest cached value so the
// operator can sanity-check wiring.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { Field, input, EmptyState } from './shared';

const SENSOR_TYPES = [
  { value: 'IGNITION', label: 'Хөдөлгүүр / асаалт', unit: '' },
  { value: 'FUEL_LEVEL', label: 'Түлшний түвшин', unit: 'L' },
  { value: 'VOLTAGE', label: 'Хүчдэл', unit: 'V' },
  { value: 'TEMPERATURE', label: 'Температур', unit: '°C' },
  { value: 'DOOR', label: 'Хаалга', unit: '' },
  { value: 'ENGINE_RPM', label: 'Хөдөлгүүрийн RPM', unit: 'rpm' },
  { value: 'ODOMETER', label: 'Гүйлт (одометр)', unit: 'km' },
  { value: 'ENGINE_HOURS', label: 'Хөдөлгүүрийн цаг', unit: 'h' },
  { value: 'WEIGHT', label: 'Жин', unit: 'kg' },
  { value: 'PRESSURE', label: 'Даралт', unit: 'kPa' },
  { value: 'DRIVER_RFID', label: 'Жолоочийн RFID', unit: '' },
  { value: 'CUSTOM_DIGITAL', label: 'Захиалгат — тоон', unit: '' },
  { value: 'CUSTOM_ANALOG', label: 'Захиалгат — аналог', unit: '' },
] as const;

const COMMON_SOURCES = [
  { v: 'io.239', l: 'Teltonika io.239 — Ignition' },
  { v: 'io.66', l: 'Teltonika io.66 — External voltage (mV)' },
  { v: 'io.67', l: 'Teltonika io.67 — Battery voltage (mV)' },
  { v: 'io.48', l: 'Teltonika io.48 — Fuel level' },
  { v: 'io.16', l: 'Teltonika io.16 — Total odometer' },
  { v: 'io.234', l: 'Teltonika io.234 — Engine hours' },
  { v: 'io.36', l: 'Teltonika io.36 — Engine RPM' },
  { v: 'io.78', l: 'Teltonika io.78 — RFID' },
];

export function SensorsTab({ deviceId }: { deviceId: string }) {
  const qc = useQueryClient();
  const sensors = useQuery({
    queryKey: ['sensors', deviceId],
    queryFn: () => api.get(`/sensors?deviceId=${deviceId}`).then((r) => r.data),
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/sensors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sensors', deviceId] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900">Мэдрэгчүүд</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            GPS төхөөрөмжийн түүхий IO дохиог нэрлэсэн, тооцоолсон утга болгох тохиргоо.
          </p>
        </div>
        <button
          onClick={() => { setAdding(true); setEditing(null); }}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-3 py-2"
        >
          + Шинэ мэдрэгч
        </button>
      </div>

      {sensors.isLoading && <div className="text-slate-400 text-sm">Уншиж байна…</div>}
      {!sensors.isLoading && (sensors.data ?? []).length === 0 && !adding && (
        <EmptyState
          title="Мэдрэгч бүртгээгүй байна"
          hint="Жнь: Teltonika FMC650-н хувьд хүчдэлийн io.66, түлшний io.48-ыг 'Хүчдэл' / 'Түлш' нэрээр оруулна."
        />
      )}

      {(sensors.data ?? []).length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Нэр</th>
                <th className="text-left px-3 py-2 font-semibold">Төрөл</th>
                <th className="text-left px-3 py-2 font-semibold">Эх (IO)</th>
                <th className="text-right px-3 py-2 font-semibold">Сүүлийн утга</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(sensors.data ?? []).map((s: any) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-slate-600">{labelOf(s.type)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{s.sourceParam}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {renderValue(s)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => { setEditing(s); setAdding(false); }} className="text-brand-700 hover:underline text-xs mr-2">Засах</button>
                    <button onClick={() => remove.mutate(s.id)} className="text-rose-700 hover:underline text-xs">Устгах</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <SensorForm
          deviceId={deviceId}
          existing={editing}
          onDone={() => { setAdding(false); setEditing(null); qc.invalidateQueries({ queryKey: ['sensors', deviceId] }); }}
        />
      )}
    </div>
  );
}

function SensorForm({ deviceId, existing, onDone }: { deviceId: string; existing: any | null; onDone: () => void }) {
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    type: existing?.type ?? 'VOLTAGE',
    sourceParam: existing?.sourceParam ?? 'io.66',
    unit: existing?.unit ?? 'V',
    multiplier: String(existing?.multiplier ?? 0.001),
    offset: String(existing?.offset ?? 0),
    invert: !!existing?.invert,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (payload: any) =>
      existing
        ? api.patch(`/sensors/${existing.id}`, payload)
        : api.post('/sensors', { ...payload, deviceId }),
    onSuccess: onDone,
    onError: (e: any) => setError(e?.response?.data?.message?.toString?.() ?? 'Хадгалах үед алдаа'),
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="font-semibold text-slate-900">{existing ? 'Мэдрэгч засах' : 'Шинэ мэдрэгч'}</div>
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Нэр *">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Хүчдэл" className={input} />
        </Field>
        <Field label="Төрөл *">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={input}>
            {SENSOR_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Эх параметр (IO) *" hint="Жнь: io.66 = Teltonika гадаад хүчдэл (мВ).">
          <input value={form.sourceParam} onChange={(e) => setForm({ ...form, sourceParam: e.target.value })} placeholder="io.66" className={clsx(input, 'font-mono')} list="sensor-sources" />
          <datalist id="sensor-sources">
            {COMMON_SOURCES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </datalist>
        </Field>
        <Field label="Нэгж">
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="V" className={input} />
        </Field>
        <Field label="Үржигдэхүүн" hint="value = raw × мульти + offset">
          <input value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} className={input} />
        </Field>
        <Field label="Offset">
          <input value={form.offset} onChange={(e) => setForm({ ...form, offset: e.target.value })} className={input} />
        </Field>
      </div>
      {error && <div className="text-xs text-rose-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-3 py-2">Цуцлах</button>
        <button
          onClick={() => {
            if (form.name.trim().length < 1) return setError('Нэрээ оруулна уу');
            if (!form.sourceParam.trim()) return setError('Эх параметр оруулна уу');
            save.mutate({
              name: form.name.trim(),
              type: form.type,
              sourceParam: form.sourceParam.trim(),
              unit: form.unit || undefined,
              multiplier: parseFloat(form.multiplier) || 1,
              offset: parseFloat(form.offset) || 0,
              invert: form.invert,
            });
          }}
          disabled={save.isPending}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 disabled:opacity-60"
        >
          {save.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
      </div>
    </div>
  );
}

function labelOf(value: string) {
  return SENSOR_TYPES.find((t) => t.value === value)?.label ?? value;
}

function renderValue(s: any): string {
  if (s.lastAt == null) return '—';
  if (s.valueKind === 'BOOL') return s.lastBool ? 'Тийм' : 'Үгүй';
  if (s.lastValue != null) return `${s.lastValue}${s.unit ? ' ' + s.unit : ''}`;
  if (s.lastText) return s.lastText;
  return '—';
}
