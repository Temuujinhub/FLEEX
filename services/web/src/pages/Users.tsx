import { ReactNode, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'FLEET_MANAGER' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';

type ApiUser = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: Role;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  companyId: string | null;
  lastLoginAt: string | null;
};

type ApiCompany = { id: string; name: string; slug: string };

const ROLE_INFO: Record<Role, { label: string; tone: string; blurb: string }> = {
  SUPER_ADMIN:    { label: 'Системийн админ',    tone: 'bg-rose-50 text-rose-700 border-rose-200',     blurb: 'Бүх компани, бүх өгөгдөл. Зөвхөн Fleex багт.' },
  COMPANY_ADMIN:  { label: 'Компанийн админ',    tone: 'bg-amber-50 text-amber-700 border-amber-200',   blurb: 'Өөрийн компанийн доторх бүх эрх, хэрэглэгч нэмэх/устгах.' },
  FLEET_MANAGER:  { label: 'Флот менежер',       tone: 'bg-violet-50 text-violet-700 border-violet-200', blurb: 'Машин, жолооч, geofence, тайлан тохируулах эрх.' },
  DISPATCHER:     { label: 'Диспетчер',          tone: 'bg-sky-50 text-sky-700 border-sky-200',         blurb: 'Шууд хяналт, дохиолол хүлээн авч хариу үйлдэл хийх.' },
  DRIVER:         { label: 'Жолооч',             tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', blurb: 'Өөрийн машин, маршрутыг харах гар утасны эрх.' },
  VIEWER:         { label: 'Зөвхөн харах',       tone: 'bg-slate-100 text-slate-700 border-slate-200',  blurb: 'Уншигч эрх — өөрчлөх боломжгүй.' },
};

const STATUS_TONE: Record<ApiUser['status'], string> = {
  ACTIVE:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  DISABLED: 'bg-slate-100 text-slate-600 border-slate-200',
  LOCKED:   'bg-rose-50 text-rose-700 border-rose-200',
};
const STATUS_LABEL: Record<ApiUser['status'], string> = {
  ACTIVE: 'Идэвхтэй', DISABLED: 'Хаалттай', LOCKED: 'Цоожтой',
};

export function Users() {
  const me = useAuth((s) => s.user);
  const isSuper = me?.role === 'SUPER_ADMIN';
  const [showAdd, setShowAdd] = useState(false);
  const [showHelp, setShowHelp] = useState(true);

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<ApiUser[]>('/users').then((r) => r.data),
  });

  // SUPER_ADMIN-д л компанийн жагсаалт хэрэгтэй (route нь SUPER_ADMIN-only).
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<ApiCompany[]>('/companies').then((r) => r.data),
    enabled: isSuper,
  });

  const companyName = (id: string | null) => {
    if (!id) return '—';
    const c = companies.data?.find((x) => x.id === id);
    return c?.name ?? id.slice(0, 8);
  };

  return (
    <div className="p-6 md:p-8 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Хэрэглэгчид</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isSuper
              ? 'Бүх компанийн хэрэглэгчид. Шинэ эрх нээхдээ компани сонгоно уу.'
              : 'Танай компанийн хэрэглэгчид.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2 text-slate-700"
          >
            {showHelp ? 'Зааврыг хаах' : 'Заавар үзэх'}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow-sm"
          >
            + Хэрэглэгч нэмэх
          </button>
        </div>
      </header>

      {showHelp && <HelpPanel isSuper={isSuper} />}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Имэйл</th>
              <th className="text-left px-4 py-2 font-semibold">Нэр</th>
              {isSuper && <th className="text-left px-4 py-2 font-semibold">Компани</th>}
              <th className="text-left px-4 py-2 font-semibold">Эрх</th>
              <th className="text-left px-4 py-2 font-semibold">Статус</th>
              <th className="text-left px-4 py-2 font-semibold">Сүүлд нэвтэрсэн</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.isLoading && (
              <tr><td colSpan={isSuper ? 6 : 5} className="px-4 py-6 text-center text-slate-400">Ачаалж байна…</td></tr>
            )}
            {!users.isLoading && (users.data ?? []).length === 0 && (
              <tr><td colSpan={isSuper ? 6 : 5} className="px-4 py-6 text-center text-slate-400">Хэрэглэгч алга</td></tr>
            )}
            {(users.data ?? []).map((u) => (
              <tr key={u.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-medium text-slate-900">{u.email}</td>
                <td className="px-4 py-2">{u.fullName ?? '—'}</td>
                {isSuper && <td className="px-4 py-2 text-slate-700">{companyName(u.companyId)}</td>}
                <td className="px-4 py-2">
                  <span className={clsx('inline-block rounded-full border px-2 py-0.5 text-xs font-semibold', ROLE_INFO[u.role].tone)}>
                    {ROLE_INFO[u.role].label}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={clsx('inline-block rounded-full border px-2 py-0.5 text-xs font-semibold', STATUS_TONE[u.status])}>
                    {STATUS_LABEL[u.status]}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddUserModal
          isSuper={isSuper}
          companies={companies.data ?? []}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// ── Зааварчилгааны самбар ─────────────────────────────────────────────────────
function HelpPanel({ isSuper }: { isSuper: boolean }) {
  const visibleRoles: Role[] = isSuper
    ? ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FLEET_MANAGER', 'DISPATCHER', 'DRIVER', 'VIEWER']
    : ['COMPANY_ADMIN', 'FLEET_MANAGER', 'DISPATCHER', 'DRIVER', 'VIEWER'];

  return (
    <div className="bg-gradient-to-br from-brand-50 to-white border border-brand-200 rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-base font-bold text-brand-900">Эрхээ хэрхэн зөв нээх вэ?</h2>
        <p className="text-sm text-slate-700 mt-1">
          Fleex олон компани (tenant) дээр ажиллана. <b>Нэг хэрэглэгч заавал нэг компанид харьяалагдана</b> ба
          бусад компанийн өгөгдөл огт харагдахгүй. {isSuper
            ? 'Та SUPER_ADMIN тул шинэ хэрэглэгч нэмэхдээ ямар компанид нэмэхээ заавал сонгоно.'
            : 'Таны үүсгэх бүх хэрэглэгч автоматаар таны компанид нэмэгдэнэ.'}
        </p>
      </div>

      <div>
        <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-2">Эрхүүд</div>
        <div className="grid md:grid-cols-2 gap-2">
          {visibleRoles.map((r) => (
            <div key={r} className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
              <span className={clsx('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold', ROLE_INFO[r].tone)}>
                {ROLE_INFO[r].label}
              </span>
              <span className="text-xs text-slate-600 leading-relaxed">{ROLE_INFO[r].blurb}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs text-slate-600 bg-white/60 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
        <div><b>Алхам 1:</b> Имэйл, нэр оруулна (имэйл нь нэвтрэх нэр болно).</div>
        <div><b>Алхам 2:</b> Эрхээ сонгоно. Та өөрөөсөө дээгүүр эрх олгох боломжгүй.</div>
        {isSuper && <div><b>Алхам 3 (SUPER_ADMIN):</b> Аль компанид нэмэхээ сонгоно.</div>}
        <div><b>Алхам {isSuper ? 4 : 3}:</b> Эхний нууц үгийг тавьж өгөөд (8+ тэмдэгт) хэрэглэгчид аман / имэйлээр дамжуулна. Дараа нь өөрчилнө.</div>
      </div>
    </div>
  );
}

// ── Шинэ хэрэглэгч нэмэх modal ────────────────────────────────────────────────
type UserForm = {
  email: string;
  fullName: string;
  phone: string;
  password: string;
  role: Role;
  companyId: string;
};

const EMPTY_FORM: UserForm = {
  email: '', fullName: '', phone: '', password: '', role: 'VIEWER', companyId: '',
};

function AddUserModal({
  isSuper,
  companies,
  onClose,
}: {
  isSuper: boolean;
  companies: ApiCompany[];
  onClose: () => void;
}) {
  const me = useAuth((s) => s.user);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Хэрэглэгч өөрөөсөө дээш эрх олгох боломжгүй.
  const allowedRoles: Role[] = useMemo(() => {
    const ladder: Role[] = ['VIEWER', 'DRIVER', 'DISPATCHER', 'FLEET_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'];
    const myIdx = me ? ladder.indexOf(me.role) : -1;
    return ladder.slice(0, myIdx + 1);
  }, [me]);

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/users', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Имэйл буруу байна'); return; }
    if (form.password.length < 8) { setError('Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой'); return; }
    if (isSuper && !form.companyId) { setError('Компани сонгоно уу'); return; }

    const payload: Record<string, any> = {
      email,
      password: form.password,
      role: form.role,
    };
    if (form.fullName.trim()) payload.fullName = form.fullName.trim();
    if (form.phone.trim())    payload.phone    = form.phone.trim();
    if (isSuper && form.companyId) payload.companyId = form.companyId;
    mutation.mutate(payload);
  };

  const genPassword = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    set('password', pw + '!');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">Шинэ хэрэглэгч</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
            <Field label="Имэйл *" className="md:col-span-2">
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="bat@nomin.mn"
                className={input}
                autoComplete="off"
              />
            </Field>

            <Field label="Бүтэн нэр">
              <input
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                placeholder="Болд Бат"
                className={input}
              />
            </Field>

            <Field label="Утас">
              <input
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+97699112233"
                className={input}
              />
            </Field>

            <Field label="Эрх *">
              <select value={form.role} onChange={(e) => set('role', e.target.value as Role)} className={input}>
                {allowedRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_INFO[r].label} ({r})</option>
                ))}
              </select>
            </Field>

            {isSuper && (
              <Field label="Компани *">
                <select
                  value={form.companyId}
                  onChange={(e) => set('companyId', e.target.value)}
                  className={input}
                >
                  <option value="">— Сонгох —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Нууц үг * (8+ тэмдэгт)" className="md:col-span-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  placeholder="Хэрэглэгчид өгөх анхны нууц үг"
                  className={input}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={genPassword}
                  className="shrink-0 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2 text-slate-700"
                >
                  Үүсгэх
                </button>
              </div>
            </Field>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 leading-relaxed">
            {ROLE_INFO[form.role].blurb}
            {!isSuper && (
              <div className="mt-1">
                Энэ хэрэглэгч <b>{me?.companyId ? 'таны компанид' : 'танай байгууллагад'}</b> автоматаар нэмэгдэнэ.
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2"
          >
            Цуцлах
          </button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60"
          >
            {mutation.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
          </button>
        </div>
      </div>
    </div>
  );
}

const input =
  'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}
