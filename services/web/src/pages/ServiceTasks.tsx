import { ReactNode, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, API_BASE, getToken } from '../lib/api';

// Засвар үйлчилгээ. Each row is one service task tied to a vehicle with
// optional schedule (date / odometer / engine-hours), completion data,
// cost, free-text notes, and image attachments stored as Postgres bytea.

const KIND_OPTIONS = [
  { value: 'MAINTENANCE', label: 'Урьдчилан сэргийлэх засвар' },
  { value: 'REPAIR',      label: 'Засвар' },
  { value: 'INSPECTION',  label: 'Үзлэг' },
  { value: 'OIL_CHANGE',  label: 'Тос солилт' },
  { value: 'TIRE',        label: 'Дугуй солилт / эргүүлэлт' },
  { value: 'WASH',        label: 'Угаалга' },
  { value: 'OTHER',       label: 'Бусад' },
] as const;

const STATUS_OPTIONS = [
  { value: 'PLANNED',     label: 'Төлөвлөгсөн',   color: 'bg-sky-100 text-sky-800' },
  { value: 'IN_PROGRESS', label: 'Хийгдэж байна', color: 'bg-amber-100 text-amber-800' },
  { value: 'COMPLETED',   label: 'Биелэгдсэн',    color: 'bg-emerald-100 text-emerald-800' },
  { value: 'OVERDUE',     label: 'Хугацаа хэтэрсэн', color: 'bg-rose-100 text-rose-800' },
  { value: 'CANCELLED',   label: 'Цуцлагдсан',    color: 'bg-slate-100 text-slate-600' },
] as const;

const KIND_LABEL: Record<string, string> = Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label]));
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((k) => [k.value, k.label]));
const STATUS_COLOR: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((k) => [k.value, k.color]));

export function ServiceTasks() {
  const [statusFilter, setStatusFilter] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const tasks = useQuery({
    queryKey: ['service-tasks', statusFilter, deviceFilter],
    queryFn: () => {
      const u = new URLSearchParams();
      if (statusFilter) u.set('status', statusFilter);
      if (deviceFilter) u.set('deviceId', deviceFilter);
      return api.get(`/service-tasks?${u.toString()}`).then((r) => r.data);
    },
  });
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
  });

  const summary = useMemo(() => {
    const list: any[] = tasks.data ?? [];
    const m = { PLANNED: 0, IN_PROGRESS: 0, COMPLETED: 0, OVERDUE: 0, CANCELLED: 0 } as Record<string, number>;
    let cost = 0;
    for (const t of list) {
      m[t.status] = (m[t.status] ?? 0) + 1;
      if (t.cost) cost += t.cost;
    }
    return { ...m, total: list.length, cost };
  }, [tasks.data]);

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Засвар үйлчилгээ</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Машин тус бүрд хийгдсэн засвар, үзлэг, дугуй / тос солилтын бүртгэл, зураг хавсаргаж хадгална.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow"
            >
              + Шинэ үйлчилгээ
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Төлөвлөгсөн" value={summary.PLANNED} accent="brand" />
          <Stat label="Хийгдэж байна" value={summary.IN_PROGRESS} accent="amber" />
          <Stat label="Биелэгдсэн" value={summary.COMPLETED} accent="emerald" />
          <Stat label="Хугацаа хэтэрсэн" value={summary.OVERDUE} accent="rose" />
          <Stat label="Нийт зардал (₮)" value={summary.cost.toLocaleString('mn-MN')} accent="slate" />
        </div>
      </header>

      <div className="px-6 md:px-8 py-3 bg-white border-b border-slate-200">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Машин</label>
            <select
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Бүх машин</option>
              {(devices.data ?? []).map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}{d.plateNumber ? ` · ${d.plateNumber}` : ''}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Төлөв</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Бүх төлөв</option>
              {STATUS_OPTIONS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Машин</th>
                <th className="text-left px-4 py-3 font-semibold">Үйлчилгээ</th>
                <th className="text-left px-4 py-3 font-semibold">Төлөв</th>
                <th className="text-left px-4 py-3 font-semibold">Огноо</th>
                <th className="text-right px-4 py-3 font-semibold">Зардал (₮)</th>
                <th className="text-center px-4 py-3 font-semibold">Зураг</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.isLoading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Уншиж байна…</td></tr>
              )}
              {!tasks.isLoading && (tasks.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="text-slate-400 text-sm">Бүртгэгдсэн үйлчилгээ алга</div>
                    <button onClick={() => setShowAdd(true)} className="mt-3 text-brand-700 hover:underline text-sm font-medium">
                      Эхний засвараа нэмье →
                    </button>
                  </td>
                </tr>
              )}
              {(tasks.data ?? []).map((t: any) => (
                <tr key={t.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(t.id)}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.device?.name ?? '—'}</div>
                    <div className="text-xs text-slate-500">{t.device?.plateNumber ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-slate-500">{KIND_LABEL[t.kind] ?? t.kind}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-1 ${STATUS_COLOR[t.status] ?? 'bg-slate-100'}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                    {t.unplanned && <span className="ml-2 text-[10px] uppercase tracking-widest bg-amber-100 text-amber-800 px-2 py-1 rounded-full">Төлөвлөөгүй</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.completedAt
                      ? <span title="Биелэгдсэн">✓ {new Date(t.completedAt).toLocaleDateString('mn-MN')}</span>
                      : t.scheduledAt
                        ? <span>📅 {new Date(t.scheduledAt).toLocaleDateString('mn-MN')}</span>
                        : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.cost ? Number(t.cost).toLocaleString('mn-MN') : '—'}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500">
                    {t.attachmentCount > 0 ? `🖼 ${t.attachmentCount}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddServiceTaskModal devices={devices.data ?? []} onClose={() => setShowAdd(false)} />}
      {openId && <ViewServiceTaskModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ── Add Modal ─────────────────────────────────────────────────
function AddServiceTaskModal({ devices, onClose }: { devices: any[]; onClose: () => void }) {
  const [form, setForm] = useState({
    deviceId: '', title: '', description: '', kind: 'MAINTENANCE' as string,
    status: 'PLANNED' as string,
    cost: '', unplanned: false,
    scheduledAt: '', reminderDays: '',
    completedAt: '', performedBy: '', completionNotes: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const qc = useQueryClient();

  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async (payload: any) => {
      const created = await api.post('/service-tasks', payload).then((r) => r.data);
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        await api.post(`/service-tasks/${created.id}/attachments`, fd);
      }
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-tasks'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    if (!form.deviceId) { setError('Машин сонгоно уу'); return; }
    if (form.title.trim().length < 2) { setError('Үйлчилгээний нэр оруулна уу'); return; }
    const payload: any = {
      deviceId: form.deviceId,
      title: form.title.trim(),
      kind: form.kind,
      status: form.status,
      unplanned: form.unplanned,
    };
    if (form.description.trim())    payload.description = form.description.trim();
    if (form.performedBy.trim())    payload.performedBy = form.performedBy.trim();
    if (form.completionNotes.trim()) payload.completionNotes = form.completionNotes.trim();
    if (form.cost) {
      const n = parseFloat(form.cost);
      if (!Number.isNaN(n)) payload.cost = n;
    }
    if (form.reminderDays) {
      const n = parseInt(form.reminderDays, 10);
      if (!Number.isNaN(n)) payload.reminderDays = n;
    }
    if (form.scheduledAt) payload.scheduledAt = new Date(form.scheduledAt).toISOString();
    if (form.completedAt) payload.completedAt = new Date(form.completedAt).toISOString();
    mutation.mutate(payload);
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    const filtered = list.filter((f) => f.size <= 5 * 1024 * 1024 && /^image\//.test(f.type));
    if (filtered.length < list.length) setError('5 МБ-аас том эсвэл зураг бус файл хасагдсан');
    setFiles((cur) => [...cur, ...filtered]);
    e.target.value = '';
  };

  return (
    <ModalShell title="Шинэ үйлчилгээ" onClose={onClose}>
      <div className="p-6 grid md:grid-cols-2 gap-x-5 gap-y-4 overflow-y-auto">
        <Field label="Машин *" className="md:col-span-2">
          <select value={form.deviceId} onChange={(e) => set('deviceId', e.target.value)} className={input}>
            <option value="">— Сонгох —</option>
            {devices.map((d) => (<option key={d.id} value={d.id}>{d.name}{d.plateNumber ? ` · ${d.plateNumber}` : ''}</option>))}
          </select>
        </Field>
        <Field label="Үйлчилгээний нэр *">
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Жишээ: Хоёр дахь үе шатны үзлэг" className={input} />
        </Field>
        <Field label="Төрөл">
          <select value={form.kind} onChange={(e) => set('kind', e.target.value)} className={input}>
            {KIND_OPTIONS.map((k) => (<option key={k.value} value={k.value}>{k.label}</option>))}
          </select>
        </Field>
        <Field label="Төлөв">
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className={input}>
            {STATUS_OPTIONS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>
        </Field>
        <Field label="Зардал (₮)">
          <input value={form.cost} onChange={(e) => set('cost', e.target.value)} placeholder="250000" className={input} />
        </Field>
        <Field label="Тайлбар" className="md:col-span-2">
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} className={input + ' resize-none'} />
        </Field>
        <Field label="Төлөвлөсөн огноо">
          <input type="date" value={form.scheduledAt} onChange={(e) => set('scheduledAt', e.target.value)} className={input} />
        </Field>
        <Field label="Урьдчилан сануулах (өдөр)">
          <input value={form.reminderDays} onChange={(e) => set('reminderDays', e.target.value)} placeholder="3" className={input} />
        </Field>
        <Field label="Биелсэн огноо">
          <input type="date" value={form.completedAt} onChange={(e) => set('completedAt', e.target.value)} className={input} />
        </Field>
        <Field label="Хийсэн засварчин / газар">
          <input value={form.performedBy} onChange={(e) => set('performedBy', e.target.value)} placeholder="Жишээ: УС Авто Сервис" className={input} />
        </Field>
        <Field label="Биелсэн тэмдэглэл" className="md:col-span-2">
          <textarea value={form.completionNotes} onChange={(e) => set('completionNotes', e.target.value)} rows={2} className={input + ' resize-none'} />
        </Field>
        <div className="md:col-span-2 flex items-center gap-2">
          <input id="unplanned" type="checkbox" checked={form.unplanned} onChange={(e) => set('unplanned', e.target.checked)} className="accent-brand-600" />
          <label htmlFor="unplanned" className="text-sm">Төлөвлөөгүй яаралтай ажил</label>
        </div>

        <Field label="Зураг (JPEG/PNG/WEBP/GIF, тус бүр 5 МБ хүртэл)" className="md:col-span-2">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickFiles} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm px-3 py-2">
              📷 Зураг сонгох
            </button>
            <span className="text-xs text-slate-500">{files.length === 0 ? 'Сонгогдоогүй' : `${files.length} зураг`}</span>
          </div>
          {files.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group">
                  <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setFiles((c) => c.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 h-6 w-6 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-xs opacity-0 group-hover:opacity-100 transition"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </Field>
      </div>

      {error && <div className="mx-6 mb-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
      <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
        <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
        <button onClick={submit} disabled={mutation.isPending} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60">
          {mutation.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── View / Detail Modal ───────────────────────────────────────
function ViewServiceTaskModal({ id, onClose }: { id: string; onClose: () => void }) {
  const task = useQuery({
    queryKey: ['service-task', id],
    queryFn: () => api.get(`/service-tasks/${id}`).then((r) => r.data),
  });
  const t = task.data;
  return (
    <ModalShell title="Үйлчилгээний дэлгэрэнгүй" onClose={onClose}>
      <div className="p-6 overflow-y-auto">
        {task.isLoading && <div className="text-center text-slate-400 py-10">Уншиж байна…</div>}
        {t && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500">{KIND_LABEL[t.kind]}</div>
                <h2 className="text-xl font-bold mt-0.5">{t.title}</h2>
                <div className="text-sm text-slate-600 mt-0.5">{t.device?.name} · {t.device?.plateNumber}</div>
              </div>
              <span className={`text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-1 ${STATUS_COLOR[t.status]}`}>
                {STATUS_LABEL[t.status]}
              </span>
            </div>
            {t.description && <p className="text-sm text-slate-700 whitespace-pre-wrap">{t.description}</p>}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Зардал" value={t.cost ? `${Number(t.cost).toLocaleString('mn-MN')} ₮` : '—'} />
              <Detail label="Төлөвлөсөн огноо" value={t.scheduledAt ? new Date(t.scheduledAt).toLocaleDateString('mn-MN') : '—'} />
              <Detail label="Биелсэн огноо" value={t.completedAt ? new Date(t.completedAt).toLocaleDateString('mn-MN') : '—'} />
              <Detail label="Засварчин" value={t.performedBy ?? '—'} />
            </div>
            {t.completionNotes && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
                <div className="text-[10px] uppercase tracking-widest font-semibold mb-1">Биелсэн тэмдэглэл</div>
                {t.completionNotes}
              </div>
            )}
            {t.attachments?.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500 mb-2 font-semibold">Хавсаргасан зураг</div>
                <div className="grid grid-cols-3 gap-2">
                  {t.attachments.map((a: any) => (
                    <a
                      key={a.id}
                      href={`${API_BASE}/service-tasks/${t.id}/attachments/${a.id}?_=${getToken()?.slice(-6)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center hover:opacity-90"
                    >
                      <AuthedImage taskId={t.id} attachmentId={a.id} />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 px-6 py-3 flex justify-end bg-slate-50">
        <button onClick={onClose} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2">Хаах</button>
      </div>
    </ModalShell>
  );
}

// Fetches the attachment with the bearer token and renders as object URL.
// Keeps photos behind auth without breaking the markup.
function AuthedImage({ taskId, attachmentId }: { taskId: string; attachmentId: string }) {
  const q = useQuery({
    queryKey: ['attachment', taskId, attachmentId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/service-tasks/${taskId}/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const blob = await r.blob();
      return URL.createObjectURL(blob);
    },
    staleTime: 5 * 60_000,
  });
  if (!q.data) return <span className="text-xs text-slate-400">Уншиж байна…</span>;
  return <img src={q.data} alt="" className="w-full h-full object-cover" />;
}

// ── Shared bits ───────────────────────────────────────────────
const input = 'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent: 'brand' | 'emerald' | 'amber' | 'rose' | 'slate' }) {
  const tint: Record<string, string> = {
    brand:   'text-brand-700 bg-brand-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    amber:   'text-amber-700 bg-amber-50',
    rose:    'text-rose-700 bg-rose-50',
    slate:   'text-slate-700 bg-slate-100',
  };
  return (
    <div className={`rounded-xl px-4 py-3 ${tint[accent]}`}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}
