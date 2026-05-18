// "Custom fields" tab — per-tenant extension columns on the Device
// entity. Definitions are managed company-wide (any operator with
// FLEET_MANAGER role can add them inline here). Values are stored per
// device.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Field, input, EmptyState } from './shared';

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Текст' },
  { value: 'NUMBER', label: 'Тоо' },
  { value: 'DATE', label: 'Огноо' },
  { value: 'BOOLEAN', label: 'Тийм / Үгүй' },
  { value: 'SELECT', label: 'Сонголт' },
];

export function CustomFieldsTab({ deviceId }: { deviceId: string }) {
  const qc = useQueryClient();
  const fields = useQuery({
    queryKey: ['custom-fields', 'device'],
    queryFn: () => api.get('/custom-fields?entity=device').then((r) => r.data),
  });
  const values = useQuery({
    queryKey: ['custom-field-values', deviceId],
    queryFn: () => api.get(`/custom-fields/values/${deviceId}`).then((r) => r.data),
  });
  const [adding, setAdding] = useState(false);

  const valueMap = new Map<string, string>(
    (values.data ?? []).map((v: any) => [v.fieldId, v.valueText ?? '']),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900">Нэмэлт талбар</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Танай байгууллагынхаа онцлогт тохирсон нэмэлт мэдээллийг машин болгонд бүртгэх.
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2">
          + Шинэ талбар тодорхойлох
        </button>
      </div>

      {fields.isLoading && <div className="text-slate-400 text-sm">Уншиж байна…</div>}
      {!fields.isLoading && (fields.data ?? []).length === 0 && !adding && (
        <EmptyState
          title="Нэмэлт талбар тодорхойлоогүй байна"
          hint="Жнь: 'Гарал үүсэл', 'Үйлдвэрлэсэн он', 'Дотоод ID', 'Дугаарын төрөл'..."
        />
      )}

      {(fields.data ?? []).length > 0 && (
        <div className="space-y-2">
          {(fields.data ?? []).map((f: any) => (
            <ValueRow key={f.id} field={f} value={valueMap.get(f.id) ?? ''} deviceId={deviceId} onSaved={() => qc.invalidateQueries({ queryKey: ['custom-field-values', deviceId] })} />
          ))}
        </div>
      )}

      {adding && (
        <NewFieldForm onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['custom-fields', 'device'] }); }} />
      )}
    </div>
  );
}

function ValueRow({ field, value, deviceId, onSaved }: { field: any; value: string; deviceId: string; onSaved: () => void }) {
  const [v, setV] = useState(value);
  // Keep local state in sync if the parent refetches after a save and the
  // canonical value changes from elsewhere.
  useEffect(() => { setV(value); }, [value]);
  const save = useMutation({
    mutationFn: () => api.post('/custom-fields/values', { fieldId: field.id, entityId: deviceId, value: v }),
    onSuccess: onSaved,
  });
  const dirty = v !== value;
  return (
    <div className="flex items-center gap-3">
      <div className="w-1/3">
        <div className="text-sm font-medium">{field.label}</div>
        <div className="text-[10px] text-slate-400 uppercase tracking-widest">{field.type}</div>
      </div>
      <div className="flex-1">
        {field.type === 'BOOLEAN' ? (
          <select value={v} onChange={(e) => setV(e.target.value)} className={input}>
            <option value="">— Сонгоогүй —</option>
            <option value="true">Тийм</option>
            <option value="false">Үгүй</option>
          </select>
        ) : field.type === 'SELECT' ? (
          <select value={v} onChange={(e) => setV(e.target.value)} className={input}>
            <option value="">— Сонгох —</option>
            {(field.options ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : field.type === 'DATE' ? (
          <input type="date" value={v} onChange={(e) => setV(e.target.value)} className={input} />
        ) : field.type === 'NUMBER' ? (
          <input type="number" value={v} onChange={(e) => setV(e.target.value)} className={input} />
        ) : (
          <input value={v} onChange={(e) => setV(e.target.value)} className={input} />
        )}
      </div>
      <button
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
        className="rounded-md bg-brand-600 hover:bg-brand-500 disabled:opacity-30 text-white text-sm font-semibold px-3 py-2"
      >
        Хадгалах
      </button>
    </div>
  );
}

function NewFieldForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState('TEXT');
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post('/custom-fields', {
      entity: 'device',
      name: name.trim(),
      label: label.trim(),
      type,
      options: type === 'SELECT' ? options.split(',').map((s) => s.trim()).filter(Boolean) : [],
    }),
    onSuccess: onDone,
    onError: (e: any) => setError(e?.response?.data?.message?.toString?.() ?? 'Алдаа гарлаа'),
  });
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="font-semibold">Шинэ нэмэлт талбар</div>
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Системийн нэр (хоосон зайгүй)">
          <input value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, '_'))} placeholder="origin_country" className={input} />
        </Field>
        <Field label="Харагдах нэр *">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Гарал үүсэл" className={input} />
        </Field>
        <Field label="Төрөл">
          <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        {type === 'SELECT' && (
          <Field label="Сонголтууд (таслалаар тусгаарлана)">
            <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Япон, Хятад, Солонгос" className={input} />
          </Field>
        )}
      </div>
      {error && <div className="text-xs text-rose-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-3 py-2">Цуцлах</button>
        <button
          onClick={() => { if (!name || !label) return setError('Нэрээ оруулна уу'); save.mutate(); }}
          disabled={save.isPending}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"
        >
          Үүсгэх
        </button>
      </div>
    </div>
  );
}
