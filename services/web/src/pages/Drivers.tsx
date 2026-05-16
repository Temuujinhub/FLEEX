import { ReactNode, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { ExcelImport } from '../components/ExcelImport';
import { useAuth } from '../store/auth';

// Жолооч / ажилчдын бүртгэл. Driver carries identity, contact, license,
// and an optional department (DeviceGroup). The "Жолооч нэмэх / засах" modal
// has two tabs (Үндсэн / Үнэмлэх) matching the Gaikham flow, with an avatar
// picker rendered as inline SVG portraits — no asset bundling needed.
//
// The same `DriverModal` powers both Create and Edit: passing a `driver` prop
// flips the modal into edit mode (PATCH instead of POST, prefilled fields).

const LICENSE_CATEGORIES = ['A', 'B', 'BE', 'C', 'CE', 'D', 'DE', 'T'];

const AVATARS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8',
  'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16',
];

export function Drivers() {
  const canEdit = useAuth((s) => s.hasRole('FLEET_MANAGER'));
  const [groupId, setGroupId] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [showImport, setShowImport] = useState(false);

  const params = new URLSearchParams();
  if (groupId) params.set('groupId', groupId);
  if (search)  params.set('search', search);

  const drivers = useQuery({
    queryKey: ['drivers', params.toString()],
    queryFn: () => api.get(`/drivers?${params.toString()}`).then((r) => r.data),
  });
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then((r) => r.data),
  });

  const stats = useMemo(() => {
    const list: any[] = drivers.data ?? [];
    const today = new Date();
    const inDays = (d: any) => {
      if (!d) return Infinity;
      const t = new Date(d).getTime();
      return Math.round((t - today.getTime()) / 86_400_000);
    };
    return {
      total: list.length,
      active: list.filter((d) => d.active !== false).length,
      assigned: list.filter((d) => (d.devices ?? []).length > 0).length,
      expiringSoon: list.filter((d) => {
        const days = inDays(d.licenseUntil);
        return days >= 0 && days <= 30;
      }).length,
    };
  }, [drivers.data]);

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Жолооч · Ажилчид</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Жолоочдын бүртгэл, үнэмлэхний хяналт, хэлтэс тус бүрээр ангилан удирдана.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2"
            >
              📂 Excel-ээс импортлох
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow"
            >
              + Шинэ жолооч
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Нийт жолооч" value={stats.total} accent="brand" />
          <Stat label="Идэвхтэй"    value={stats.active} accent="emerald" />
          <Stat label="Машинтай"    value={stats.assigned} accent="slate" />
          <Stat label="Үнэмлэх дуусч буй (30 хоног)" value={stats.expiringSoon} accent="amber" />
        </div>
      </header>

      <div className="px-6 md:px-8 py-3 bg-white border-b border-slate-200">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">
              Хэлтэс
            </label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Бүх хэлтэс</option>
              {(groups.data ?? []).map((g: any) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">
              Хайх
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Нэр, утас, ID, үнэмлэх..."
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Жолооч</th>
                <th className="text-left px-4 py-3 font-semibold">Ажилтны ID</th>
                <th className="text-left px-4 py-3 font-semibold">Үнэмлэх</th>
                <th className="text-left px-4 py-3 font-semibold">Хэлтэс</th>
                <th className="text-left px-4 py-3 font-semibold">Утас</th>
                <th className="text-right px-4 py-3 font-semibold">Машин</th>
                <th className="text-right px-4 py-3 font-semibold w-24">Үйлдэл</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers.isLoading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Уншиж байна…</td></tr>
              )}
              {!drivers.isLoading && (drivers.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="text-slate-400 text-sm">Жолооч олдсонгүй</div>
                    <button onClick={() => setShowAdd(true)} className="mt-3 text-brand-700 hover:underline text-sm font-medium">
                      Эхний жолоочоо нэмье →
                    </button>
                  </td>
                </tr>
              )}
              {(drivers.data ?? []).map((d: any) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar id={d.avatarKey} fallback={initials(d.fullName)} />
                      <div>
                        <div className="font-medium">{d.fullName}</div>
                        <div className="text-xs text-slate-500">{d.shortName ?? '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">{d.employeeId ?? '—'}</td>
                  <td className="px-4 py-3">
                    {d.licenseNo ? (
                      <>
                        <div className="font-medium text-slate-700">{d.licenseNo}</div>
                        <div className="text-xs text-slate-500">
                          {d.licenseCategory ?? '—'}
                          {d.licenseUntil && ` · ${new Date(d.licenseUntil).toLocaleDateString('mn-MN')}`}
                          {expiryBadge(d.licenseUntil)}
                        </div>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{d.group?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{d.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {(d.devices ?? []).length > 0 ? (
                      <span className="text-sm font-semibold">{d.devices.length}</span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing(d)}
                        title="Жолоочийн мэдээлэл засах"
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 hover:border-brand-300 text-slate-700 text-xs font-medium px-2.5 py-1.5 transition"
                      >
                        <PencilIcon /> Засах
                      </button>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <DriverModal
          mode="create"
          groups={groups.data ?? []}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editing && (
        <DriverModal
          mode="edit"
          driver={editing}
          groups={groups.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {showImport && (
        <ExcelImport
          resource="drivers"
          title="Жолоочид Excel-ээс импортлох"
          invalidateKeys={['drivers']}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ── Driver Modal (create + edit) ──────────────────────────────
type DriverForm = {
  lastName: string; firstName: string; shortName: string; fullName: string;
  employeeId: string; groupId: string;
  phone: string; email: string; address: string;
  rfidCard: string; ssn: string; avatarKey: string;
  licenseNo: string; licenseCategory: string;
  licenseIssuedAt: string; licenseUntil: string;
};
const EMPTY_DRIVER: DriverForm = {
  lastName: '', firstName: '', shortName: '', fullName: '',
  employeeId: '', groupId: '',
  phone: '', email: '', address: '',
  rfidCard: '', ssn: '', avatarKey: 'A1',
  licenseNo: '', licenseCategory: '',
  licenseIssuedAt: '', licenseUntil: '',
};

type DriverModalProps =
  | { mode: 'create'; groups: any[]; onClose: () => void; driver?: undefined }
  | { mode: 'edit';   groups: any[]; onClose: () => void; driver: any };

function DriverModal({ mode, driver, groups, onClose }: DriverModalProps) {
  const isEdit = mode === 'edit';
  const [tab, setTab] = useState<'basic' | 'license'>('basic');
  const [form, setForm] = useState<DriverForm>(() => driver ? formFromDriver(driver) : EMPTY_DRIVER);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = useAuth((s) => s.hasRole('COMPANY_ADMIN'));
  const qc = useQueryClient();

  const set = <K extends keyof DriverForm>(k: K, v: DriverForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: (payload: any) => {
      if (isEdit) return api.patch(`/drivers/${driver.id}`, payload).then((r) => r.data);
      return api.post('/drivers', payload).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа гарлаа');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/drivers/${driver.id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Устгах үед алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    const fullName = form.fullName.trim() || `${form.lastName.trim()} ${form.firstName.trim()}`.trim();
    if (fullName.length < 2) {
      setError('Овог / нэр оруулна уу'); setTab('basic'); return;
    }
    const payload: Record<string, any> = { fullName };
    const strKeys: (keyof DriverForm)[] = [
      'firstName', 'lastName', 'shortName', 'employeeId',
      'phone', 'email', 'address', 'rfidCard', 'ssn', 'avatarKey',
      'licenseNo', 'licenseCategory',
    ];
    for (const k of strKeys) {
      const v = (form[k] as string).trim();
      // On edit we keep behaviour symmetric: blank field clears the value.
      if (v || isEdit) payload[k] = v || null;
    }
    payload.groupId = form.groupId || (isEdit ? null : undefined);
    payload.licenseIssuedAt = form.licenseIssuedAt ? new Date(form.licenseIssuedAt).toISOString() : (isEdit ? null : undefined);
    payload.licenseUntil    = form.licenseUntil    ? new Date(form.licenseUntil).toISOString()    : (isEdit ? null : undefined);
    // Drop "undefined"s so the body is clean on create.
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    mutation.mutate(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold">{isEdit ? 'Жолоочийн мэдээлэл засах' : 'Шинэ жолооч'}</h2>
            {isEdit && (
              <p className="text-xs text-slate-500 mt-0.5">{driver.fullName}{driver.employeeId ? ` · ${driver.employeeId}` : ''}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>

        <div className="flex border-b border-slate-200 bg-slate-50">
          {[
            { id: 'basic',   label: 'Үндсэн' },
            { id: 'license', label: 'Жолооны үнэмлэх' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as any)}
              className={clsx(
                'px-5 py-3 text-sm font-semibold border-b-2 transition',
                tab === t.id
                  ? 'border-brand-600 text-brand-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'basic' && (
            <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
              <Field label="Овог *">
                <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Болд" className={input} />
              </Field>
              <Field label="Нэр *">
                <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="Бат" className={input} />
              </Field>
              <Field label="Товч нэр">
                <input value={form.shortName} onChange={(e) => set('shortName', e.target.value)} placeholder="Б.Бат" className={input} />
              </Field>
              <Field label="Бүтэн нэр (автоматаар)">
                <input
                  value={form.fullName || `${form.lastName} ${form.firstName}`.trim()}
                  onChange={(e) => set('fullName', e.target.value)}
                  placeholder="Болд Бат" className={input}
                />
              </Field>

              <Field label="Ажилтны ID">
                <input value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)} placeholder="E-0001" className={input} />
              </Field>
              <Field label="Хэлтэс">
                <select value={form.groupId} onChange={(e) => set('groupId', e.target.value)} className={input}>
                  <option value="">— Сонгох —</option>
                  {groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                </select>
              </Field>

              <Field label="Утас">
                <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+97699112233" className={input} />
              </Field>
              <Field label="И-мэйл">
                <input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="bat@example.com" className={input} />
              </Field>

              <Field label="RFID картын дугаар">
                <input value={form.rfidCard} onChange={(e) => set('rfidCard', e.target.value)} className={input} />
              </Field>
              <Field label="Регистрийн дугаар (SSN)">
                <input value={form.ssn} onChange={(e) => set('ssn', e.target.value)} className={input} />
              </Field>

              <Field label="Хаяг" className="md:col-span-2">
                <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Улаанбаатар, СБД..." className={input} />
              </Field>

              <Field label="Аватар" className="md:col-span-2">
                <div className="grid grid-cols-8 gap-2">
                  {AVATARS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => set('avatarKey', id)}
                      className={clsx(
                        'rounded-lg p-1 transition',
                        form.avatarKey === id ? 'bg-brand-50 ring-2 ring-brand-600' : 'hover:bg-slate-50',
                      )}
                    >
                      <Avatar id={id} fallback="?" />
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {tab === 'license' && (
            <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
              <Field label="Үнэмлэхний дугаар">
                <input value={form.licenseNo} onChange={(e) => set('licenseNo', e.target.value)} placeholder="УБ12345678" className={input} />
              </Field>
              <Field label="Ангилал">
                <div className="flex flex-wrap gap-1.5">
                  {LICENSE_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set('licenseCategory', c)}
                      className={clsx(
                        'rounded-md px-3 py-1.5 text-sm border transition',
                        form.licenseCategory === c
                          ? 'bg-brand-600 border-brand-600 text-white'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300',
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Олгосон огноо">
                <input type="date" value={form.licenseIssuedAt} onChange={(e) => set('licenseIssuedAt', e.target.value)} className={input} />
              </Field>
              <Field label="Хүчинтэй хугацаа">
                <input type="date" value={form.licenseUntil} onChange={(e) => set('licenseUntil', e.target.value)} className={input} />
                {form.licenseUntil && expiryHint(form.licenseUntil)}
              </Field>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>
        )}
        <div className="border-t border-slate-200 px-6 py-3 flex items-center gap-2 bg-slate-50">
          {isEdit && canDelete && (
            confirmDelete ? (
              <div className="flex items-center gap-2 text-xs text-rose-700">
                <span>Устгахдаа итгэлтэй байна уу?</span>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-60"
                >
                  {deleteMutation.isPending ? 'Устгаж байна…' : 'Тийм, устга'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs px-3 py-1.5">
                  Болих
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-md border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-sm font-medium px-3 py-2"
              >
                Устгах
              </button>
            )
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">
            Цуцлах
          </button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60"
          >
            {mutation.isPending ? 'Хадгалж байна…' : isEdit ? 'Хадгалах өөрчлөлт' : 'Хадгалах'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Prefill helper. The API returns dates as ISO strings — convert them back
// to the `YYYY-MM-DD` format the <input type="date"> expects.
function formFromDriver(d: any): DriverForm {
  const ymd = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
  return {
    lastName:        d.lastName        ?? '',
    firstName:       d.firstName       ?? '',
    shortName:       d.shortName       ?? '',
    fullName:        d.fullName        ?? '',
    employeeId:      d.employeeId      ?? '',
    groupId:         d.groupId         ?? d.group?.id ?? '',
    phone:           d.phone           ?? '',
    email:           d.email           ?? '',
    address:         d.address         ?? '',
    rfidCard:        d.rfidCard        ?? '',
    ssn:             d.ssn             ?? '',
    avatarKey:       d.avatarKey       ?? 'A1',
    licenseNo:       d.licenseNo       ?? '',
    licenseCategory: d.licenseCategory ?? '',
    licenseIssuedAt: ymd(d.licenseIssuedAt),
    licenseUntil:    ymd(d.licenseUntil),
  };
}

// ── Bits ──────────────────────────────────────────────────────
const input = 'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: 'brand' | 'emerald' | 'slate' | 'amber' }) {
  const tint: Record<string, string> = {
    brand:   'text-brand-700 bg-brand-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    slate:   'text-slate-700 bg-slate-100',
    amber:   'text-amber-700 bg-amber-50',
  };
  return (
    <div className={`rounded-xl px-4 py-3 ${tint[accent]}`}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

function initials(name: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function expiryBadge(until?: string) {
  if (!until) return null;
  const days = Math.round((new Date(until).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <span className="ml-2 text-[10px] uppercase tracking-widest bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded">Хугацаа дууссан</span>;
  if (days <= 30) return <span className="ml-2 text-[10px] uppercase tracking-widest bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">{days} хоног</span>;
  return null;
}

function expiryHint(until: string) {
  const days = Math.round((new Date(until).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <div className="text-[11px] text-rose-700 mt-1">Хугацаа аль хэдийн дууссан байна</div>;
  if (days <= 30) return <div className="text-[11px] text-amber-700 mt-1">{days} хоногийн дотор дуусна</div>;
  return null;
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5l2 2-8 8H3.5v-2z" />
      <path d="M9.5 4.5l2 2" />
    </svg>
  );
}

// ── Avatar (inline SVG portraits — 16 deterministic variants) ─
function Avatar({ id, fallback }: { id?: string | null; fallback: string }) {
  if (!id) {
    return (
      <div className="h-9 w-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-semibold">
        {fallback}
      </div>
    );
  }
  // Deterministic palette + hairstyle / skin from the avatar id
  const n = (id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % 8;
  const PAL = [
    { bg: '#fde68a', skin: '#f5d0a0', hair: '#1f2937' },
    { bg: '#bfdbfe', skin: '#f1c896', hair: '#7c2d12' },
    { bg: '#bbf7d0', skin: '#e9c39d', hair: '#451a03' },
    { bg: '#fbcfe8', skin: '#eec19c', hair: '#374151' },
    { bg: '#ddd6fe', skin: '#f3d1a8', hair: '#92400e' },
    { bg: '#fef08a', skin: '#e9b48f', hair: '#0f172a' },
    { bg: '#fecaca', skin: '#efc6a3', hair: '#52525b' },
    { bg: '#a5f3fc', skin: '#e7c5a4', hair: '#312e81' },
  ];
  const p = PAL[n];
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 rounded-full" aria-hidden>
      <rect width="36" height="36" rx="18" fill={p.bg} />
      <circle cx="18" cy="15" r="6" fill={p.skin} />
      <path d="M12 11 Q18 6 24 11 L24 14 Q20 13 18 13 Q16 13 12 14 Z" fill={p.hair} />
      <path d="M5 32 Q10 22 18 22 Q26 22 31 32 Z" fill={p.hair} />
      <path d="M7 32 Q12 24 18 24 Q24 24 29 32 Z" fill={p.skin} opacity="0.55" />
    </svg>
  );
}
