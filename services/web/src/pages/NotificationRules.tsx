// "Дохиоллын дүрэм" — UI for the NotificationRule CRUD endpoints. The
// events-engine reads these rules and routes matching events to the
// configured channels (in-app / email / sms / webhook). Replaces the
// old hard-coded routing.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';

const EVENT_TYPES = [
  { value: 'PANIC',          label: 'Эвакуац / SOS' },
  { value: 'OVERSPEED',      label: 'Хурд хэтрэв' },
  { value: 'HARSH_ACCEL',    label: 'Гэнэт хурдалсан' },
  { value: 'HARSH_BRAKE',    label: 'Гэнэт тоормосолсон' },
  { value: 'HARSH_CORNER',   label: 'Гэнэт эргэсэн' },
  { value: 'GEOFENCE_ENTER', label: 'Бүсэд оров' },
  { value: 'GEOFENCE_EXIT',  label: 'Бүснээс гарав' },
  { value: 'IGNITION_ON',    label: 'Хөдөлгүүр асав' },
  { value: 'IGNITION_OFF',   label: 'Хөдөлгүүр унтрав' },
  { value: 'IDLE_START',     label: 'Зогссон (idle эхэлсэн)' },
  { value: 'IDLE_END',       label: 'Зогсолтоос гарсан' },
  { value: 'POWER_CUT',      label: 'Гадаад тэжээл салсан' },
  { value: 'LOW_BATTERY',    label: 'Хүчдэл доогуур' },
  { value: 'DEVICE_OFFLINE', label: 'Холболт салсан' },
  { value: 'DEVICE_ONLINE',  label: 'Холболт сэргэсэн' },
  { value: 'TAMPER',         label: 'Хөдөлгөөн / халдлага' },
  { value: 'LONE_WORKER_RISK', label: 'Lone-worker эрсдэл (2ц+ хариу алга)' },
  { value: 'CUSTOM',         label: 'Тусгай' },
];

const CHANNELS = [
  { value: 'IN_APP',  label: 'Системд (хонх)' },
  { value: 'EMAIL',   label: 'Имэйл' },
  { value: 'SMS',     label: 'SMS' },
  { value: 'WEBHOOK', label: 'Webhook' },
];

const input = 'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

export function NotificationRules() {
  const qc = useQueryClient();
  const rules = useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => api.get('/notification-rules').then((r) => r.data),
  });
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const toggle = useMutation({
    mutationFn: (r: any) => api.patch(`/notification-rules/${r.id}`, { active: !r.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-rules'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/notification-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-rules'] }),
  });

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Дохиоллын дүрэм</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Тодорхой үйл явдал бүртгэгдэхэд хэн рүү, ямар сувгаар дохио илгээхийг тохируулна.
          </p>
        </div>
        <button onClick={() => { setCreating(true); setEditing(null); }} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow">
          + Шинэ дүрэм
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
        {rules.isLoading && <div className="text-slate-400">Уншиж байна…</div>}
        {!rules.isLoading && (rules.data ?? []).length === 0 && !creating && (
          <div className="rounded-lg bg-white border border-dashed border-slate-300 p-10 text-center">
            <div className="text-slate-600">Дүрэм бүртгээгүй байна</div>
            <div className="text-xs text-slate-400 mt-1">Жнь: "Хурд хэтрэвэл диспетчер рүү SMS илгээ"</div>
          </div>
        )}

        {(rules.data ?? []).map((r: any) => (
          <div key={r.id} className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{r.name}</h3>
                  {!r.active && <span className="text-[10px] uppercase tracking-widest bg-slate-200 text-slate-700 px-2 py-0.5 rounded">Идэвхгүй</span>}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Үед: <b>{labelEvent(r.triggerType)}</b> · Хамгийн доод түвшин: <b>{r.minSeverity}</b>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {r.channels.map((c: string) => (
                    <span key={c} className="text-[10px] uppercase tracking-widest bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded">
                      {labelChannel(c)}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono">{r.template}</div>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => toggle.mutate(r)} className="text-xs text-slate-600 hover:underline">
                  {r.active ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх'}
                </button>
                <button onClick={() => { setEditing(r); setCreating(false); }} className="text-xs text-brand-700 hover:underline">Засах</button>
                <button onClick={() => { if (confirm('Устгах уу?')) remove.mutate(r.id); }} className="text-xs text-rose-700 hover:underline">Устгах</button>
              </div>
            </div>
          </div>
        ))}

        {(creating || editing) && (
          <RuleForm
            existing={editing}
            onDone={() => { setCreating(false); setEditing(null); qc.invalidateQueries({ queryKey: ['notification-rules'] }); }}
          />
        )}
      </div>
    </div>
  );
}

function RuleForm({ existing, onDone }: { existing: any | null; onDone: () => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [triggerType, setTriggerType] = useState(existing?.triggerType ?? 'OVERSPEED');
  const [minSeverity, setMinSeverity] = useState(existing?.minSeverity ?? 'INFO');
  const [channels, setChannels] = useState<string[]>(existing?.channels ?? ['IN_APP']);
  const [recipientEmails, setRecipientEmails] = useState((existing?.recipientEmails ?? []).join(', '));
  const [recipientPhones, setRecipientPhones] = useState((existing?.recipientPhones ?? []).join(', '));
  const [webhookUrl, setWebhookUrl] = useState(existing?.webhookUrl ?? '');
  const [placeIds, setPlaceIds] = useState<string[]>(existing?.placeIds ?? []);
  const [template, setTemplate] = useState(existing?.template ?? '{DEVICE}: {TYPE} ({LOCATION})');
  const [active, setActive] = useState(existing?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  // Place picker only shows for geofence-enter/exit triggers — Places
  // are anchors that auto-create a circle geofence in the background.
  const placeFilterApplies = triggerType === 'GEOFENCE_ENTER' || triggerType === 'GEOFENCE_EXIT';
  const placesQ = useQuery({
    queryKey: ['places', 'for-rule'],
    queryFn: () => api.get('/places').then((r) => r.data as Array<{ id: string; name: string; type: string; geofenceId: string | null }>),
    enabled: placeFilterApplies,
  });

  const emailIssues = recipientEmails
    .split(',').map((s) => s.trim()).filter(Boolean)
    .filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const phoneIssues = recipientPhones
    .split(',').map((s) => s.trim()).filter(Boolean)
    .filter((p) => !/^\+?\d{8,15}$/.test(p));
  const webhookIssue = webhookUrl && !/^https?:\/\/\S+$/i.test(webhookUrl)
    ? 'Webhook URL http(s):// эхэлсэн бүрэн хаяг байх ёстой.'
    : null;

  const save = useMutation({
    mutationFn: (payload: any) =>
      existing
        ? api.patch(`/notification-rules/${existing.id}`, payload)
        : api.post('/notification-rules', payload),
    onSuccess: onDone,
    onError: (e: any) => setError(e?.response?.data?.message?.toString?.() ?? 'Алдаа гарлаа'),
  });

  return (
    <div className="bg-white rounded-lg border border-brand-200 p-5 space-y-4 shadow-md">
      <div className="font-bold text-slate-900">{existing ? 'Дүрэм засах' : 'Шинэ дохиоллын дүрэм'}</div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Нэр *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Жнь: Хурдны анхааруулга" className={input} />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Үед</label>
          <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className={input}>
            {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Хамгийн доод түвшин</label>
          <select value={minSeverity} onChange={(e) => setMinSeverity(e.target.value)} className={input}>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm mt-7">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Идэвхтэй
          </label>
        </div>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Сувгууд</label>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => {
            const on = channels.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setChannels(on ? channels.filter((x) => x !== c.value) : [...channels, c.value])}
                className={clsx(
                  'rounded-md border px-3 py-1.5 text-sm transition',
                  on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {channels.includes('EMAIL') && (
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Имэйлүүд (таслалаар тусгаарлана)</label>
          <input value={recipientEmails} onChange={(e) => setRecipientEmails(e.target.value)} placeholder="ops@example.com, manager@example.com" className={input} />
          {emailIssues.length > 0 && (
            <div className="mt-1 text-xs text-amber-700">
              Зөв бус имэйл: {emailIssues.join(', ')}
            </div>
          )}
        </div>
      )}
      {channels.includes('SMS') && (
        <div>
          <div className="mb-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            ⚠ SMS суваг идэвхгүй байж болзошгүй — системийн админтай холбогдож идэвхжүүлээрэй.
          </div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Утаснууд (таслалаар тусгаарлана)</label>
          <input value={recipientPhones} onChange={(e) => setRecipientPhones(e.target.value)} placeholder="+97699112233, +97688220011" className={input} />
          {phoneIssues.length > 0 && (
            <div className="mt-1 text-xs text-amber-700">
              Зөв бус утас (+ ба 8-15 орон): {phoneIssues.join(', ')}
            </div>
          )}
        </div>
      )}
      {channels.includes('WEBHOOK') && (
        <div>
          <div className="mb-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            ⚠ Webhook суваг идэвхгүй байж болзошгүй — системийн админтай холбогдож идэвхжүүлээрэй.
          </div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Webhook URL</label>
          <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://example.com/hook" className={input} />
          {webhookIssue && <div className="mt-1 text-xs text-amber-700">{webhookIssue}</div>}
        </div>
      )}

      {placeFilterApplies && (
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">
            Тодорхой Place-ээр шүүх (заавал биш)
          </label>
          {placesQ.isLoading ? (
            <div className="text-xs text-slate-400">Уншиж байна…</div>
          ) : (placesQ.data ?? []).filter((p) => p.geofenceId).length === 0 ? (
            <div className="text-xs text-slate-500">
              radiusM-тэй Place алга байна. Эхлээд "Байршил · Цэгүүд" хуудаснаас радиустай цэг үүсгэнэ үү.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(placesQ.data ?? []).filter((p) => p.geofenceId).map((p) => {
                const on = placeIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setPlaceIds(on ? placeIds.filter((x) => x !== p.id) : [...placeIds, p.id])
                    }
                    className={clsx(
                      'rounded-md border px-3 py-1.5 text-xs transition',
                      on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                    )}
                  >
                    {p.name}
                    <span className="ml-1 text-[10px] text-slate-400">{p.type}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-1 text-[11px] text-slate-500">
            Хоосон үлдээвэл бүх geofence-д хүчинтэй. Place сонгосон үед тухайн Place-ийн авто-geofence-д л зориулагдана.
          </div>
        </div>
      )}

      <div>
        <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Текстийн загвар</label>
        <input value={template} onChange={(e) => setTemplate(e.target.value)} className={clsx(input, 'font-mono')} />
        <div className="text-[11px] text-slate-500 mt-1">
          Дараах placeholder ашиглах боломжтой: <code>{'{DEVICE}'}</code>, <code>{'{TYPE}'}</code>, <code>{'{LOCATION}'}</code>, <code>{'{SPEED}'}</code>, <code>{'{TIME}'}</code>
        </div>
      </div>

      {error && <div className="text-xs text-rose-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
        <button
          onClick={() => {
            if (!name.trim()) return setError('Нэрээ оруулна уу');
            if (emailIssues.length > 0) return setError('Имэйлийн формат буруу байна');
            if (phoneIssues.length > 0) return setError('Утасны формат буруу байна');
            if (webhookIssue) return setError(webhookIssue);
            save.mutate({
              name: name.trim(),
              triggerType,
              minSeverity,
              channels,
              recipientEmails: recipientEmails.split(',').map((s) => s.trim()).filter(Boolean),
              recipientPhones: recipientPhones.split(',').map((s) => s.trim()).filter(Boolean),
              webhookUrl: webhookUrl || undefined,
              placeIds: placeFilterApplies ? placeIds : [],
              template,
              active,
            });
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

function labelEvent(v: string) { return EVENT_TYPES.find((t) => t.value === v)?.label ?? v; }
function labelChannel(v: string) { return CHANNELS.find((t) => t.value === v)?.label ?? v; }
