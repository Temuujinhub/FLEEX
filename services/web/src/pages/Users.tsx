import { ReactNode, useMemo, useRef, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth, AuthUser } from '../store/auth';

type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'FLEET_MANAGER' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';
type UserStatus = 'ACTIVE' | 'DISABLED' | 'LOCKED';

type ApiUser = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: Role;
  status: UserStatus;
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

const STATUS_TONE: Record<UserStatus, string> = {
  ACTIVE:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  DISABLED: 'bg-slate-100 text-slate-600 border-slate-200',
  LOCKED:   'bg-rose-50 text-rose-700 border-rose-200',
};
const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Идэвхтэй', DISABLED: 'Хаалттай', LOCKED: 'Цоожтой',
};

const ROLE_LADDER: Role[] = ['VIEWER', 'DRIVER', 'DISPATCHER', 'FLEET_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'];

export function Users() {
  const me = useAuth((s) => s.user);
  const isSuper = me?.role === 'SUPER_ADMIN';
  const [showAdd, setShowAdd] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [editTarget, setEditTarget] = useState<ApiUser | null>(null);
  const [resetTarget, setResetTarget] = useState<ApiUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiUser | null>(null);

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<ApiUser[]>('/users').then((r) => r.data),
  });

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
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.isLoading && (
              <tr><td colSpan={isSuper ? 7 : 6} className="px-4 py-6 text-center text-slate-400">Ачаалж байна…</td></tr>
            )}
            {!users.isLoading && (users.data ?? []).length === 0 && (
              <tr><td colSpan={isSuper ? 7 : 6} className="px-4 py-6 text-center text-slate-400">Хэрэглэгч алга</td></tr>
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
                <td className="px-2 py-2">
                  <RowActions
                    user={u}
                    me={me}
                    onEdit={() => setEditTarget(u)}
                    onReset={() => setResetTarget(u)}
                    onDelete={() => setDeleteTarget(u)}
                  />
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
      {editTarget && (
        <EditUserModal
          user={editTarget}
          me={me}
          onClose={() => setEditTarget(null)}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal user={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}

// ── Row "..." menu ────────────────────────────────────────────────────────────
function RowActions({
  user,
  me,
  onEdit,
  onReset,
  onDelete,
}: {
  user: ApiUser;
  me: AuthUser | null;
  onEdit: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Хэрэглэгч өөрийгөө устгах / эрх дарах боломжгүй (frontend сэргийлэлт).
  const isSelf = me?.id === user.id;

  const toggleStatus = useMutation({
    mutationFn: () =>
      api.patch(`/users/${user.id}`, { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
    },
  });

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
        aria-label="Үйлдэл"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-52 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <MenuItem label="Засах" onClick={() => { setOpen(false); onEdit(); }} />
          <MenuItem label="Нууц үг шинэчлэх" onClick={() => { setOpen(false); onReset(); }} />
          {!isSelf && (
            <MenuItem
              label={user.status === 'ACTIVE' ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх'}
              onClick={() => toggleStatus.mutate()}
              disabled={toggleStatus.isPending}
            />
          )}
          {!isSelf && (
            <MenuItem
              label="Устгах"
              tone="danger"
              onClick={() => { setOpen(false); onDelete(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, disabled, tone }: { label: string; onClick: () => void; disabled?: boolean; tone?: 'danger' }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'block w-full text-left px-3 py-2 text-sm transition',
        tone === 'danger' ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {label}
    </button>
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
        <div><b>Үйлдлийн menu (...):</b> Мөрийн төгсгөл дэх <code>...</code> товч даран: <b>Засах</b> (нэр/утас/эрх), <b>Нууц үг шинэчлэх</b> (админ зориулсан), <b>Идэвхгүй болгох</b> (ажилтан гарсан үед нэвтрэлт хаах), <b>Устгах</b> (бүрэн арилгах).</div>
        <div><b>Өөрийн нууц үг:</b> Зүүн дээд буланд аватар товч даран <b>Миний бүртгэл</b> хэсэгт орж хуучин нууц үгээ оруулан шинээр солино.</div>
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

  const allowedRoles: Role[] = useMemo(() => {
    const myIdx = me ? ROLE_LADDER.indexOf(me.role as Role) : -1;
    return ROLE_LADDER.slice(0, myIdx + 1);
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

  return (
    <Modal title="Шинэ хэрэглэгч" onClose={onClose}>
      <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
        <Field label="Имэйл *" className="md:col-span-2">
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="bat@nomin.mn" className={input} autoComplete="off" />
        </Field>
        <Field label="Бүтэн нэр">
          <input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Болд Бат" className={input} />
        </Field>
        <Field label="Утас">
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+97699112233" className={input} />
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
            <select value={form.companyId} onChange={(e) => set('companyId', e.target.value)} className={input}>
              <option value="">— Сонгох —</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </Field>
        )}
        <Field label="Нууц үг * (8+ тэмдэгт)" className="md:col-span-2">
          <PasswordInput value={form.password} onChange={(v) => set('password', v)} />
        </Field>
      </div>
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 mt-4">
        {ROLE_INFO[form.role].blurb}
      </div>
      <ModalFooter
        error={error}
        onCancel={onClose}
        onSubmit={submit}
        loading={mutation.isPending}
      />
    </Modal>
  );
}

// ── Edit user modal ──────────────────────────────────────────────────────────
function EditUserModal({
  user,
  me,
  onClose,
}: {
  user: ApiUser;
  me: AuthUser | null;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [role, setRole] = useState<Role>(user.role);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const allowedRoles: Role[] = useMemo(() => {
    const myIdx = me ? ROLE_LADDER.indexOf(me.role as Role) : -1;
    return ROLE_LADDER.slice(0, myIdx + 1);
  }, [me]);

  const mutation = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}`, { fullName: fullName.trim() || null, phone: phone.trim() || null, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа гарлаа');
    },
  });

  return (
    <Modal title="Хэрэглэгч засах" onClose={onClose}>
      <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
        <Field label="Имэйл" className="md:col-span-2">
          <input value={user.email} disabled className={clsx(input, 'bg-slate-100 text-slate-500')} />
        </Field>
        <Field label="Бүтэн нэр">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} />
        </Field>
        <Field label="Утас">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
        </Field>
        <Field label="Эрх" className="md:col-span-2">
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={input}>
            {allowedRoles.map((r) => (
              <option key={r} value={r}>{ROLE_INFO[r].label} ({r})</option>
            ))}
          </select>
        </Field>
      </div>
      <ModalFooter
        error={error}
        onCancel={onClose}
        onSubmit={() => mutation.mutate()}
        loading={mutation.isPending}
      />
    </Modal>
  );
}

// ── Reset password modal ─────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose }: { user: ApiUser; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/reset-password`, { newPassword: pw }),
    onSuccess: () => setDone(true),
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    if (pw.length < 8) { setError('8+ тэмдэгт байх ёстой'); return; }
    mutation.mutate();
  };

  if (done) {
    return (
      <Modal title="Нууц үг шинэчлэгдсэн" onClose={onClose}>
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            <b>{user.email}</b> хэрэглэгчийн нууц үг шинэчлэгдлээ. Доорх нууц үгийг хэрэглэгчид
            аман / имэйлээр дамжуулна уу:
          </p>
          <div className="rounded-md bg-slate-900 text-emerald-300 font-mono text-base px-4 py-3 flex items-center justify-between">
            <span>{pw}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(pw)}
              className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white"
            >
              Хуулах
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Хэрэглэгчийн идэвхтэй бүх сессийг автоматаар таслаж дахин нэвтрэх шаардлагатай болсон.
          </p>
        </div>
        <div className="border-t border-slate-200 mt-4 pt-3 flex justify-end">
          <button onClick={onClose} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2">Хаах</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`${user.email} — нууц үг шинэчлэх`} onClose={onClose}>
      <Field label="Шинэ нууц үг * (8+ тэмдэгт)" className="md:col-span-2">
        <PasswordInput value={pw} onChange={setPw} />
      </Field>
      <p className="text-xs text-slate-500 mt-3">
        Хэрэглэгчийн бүх идэвхтэй session таслагдана. Шинэ нууц үгээ хэрэглэгчид өгсний дараа тэр өөрөө "Миний бүртгэл" хэсэгт орж дахин солих ёстой.
      </p>
      <ModalFooter
        error={error}
        onCancel={onClose}
        onSubmit={submit}
        loading={mutation.isPending}
        submitLabel="Шинэчлэх"
      />
    </Modal>
  );
}

// ── Delete confirm modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({ user, onClose }: { user: ApiUser; onClose: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.delete(`/users/${user.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Устгах үед алдаа');
    },
  });

  const canDelete = confirmText.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <Modal title="Хэрэглэгч устгах" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
          <b>{user.email}</b>-г бүрмөсөн устгах гэж байна. Энэ үйлдлийг буцаах боломжгүй.
        </div>
        <p className="text-sm text-slate-700">
          Хэрэглэгчийн бүх session, нэвтрэх түүх таслагдана. Audit log нь хадгалагдсаар байх ба нэр нь "—" болж харагдана.
        </p>
        <p className="text-sm text-slate-700">Баталгаажуулахын тулд имэйл хаягийг бичээрэй:</p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={user.email}
          className={input}
        />
        <p className="text-xs text-slate-500">
          💡 <b>Зөвлөмж:</b> Ажилтан түр амралттай байгаа бол <b>Идэвхгүй болгох</b> арга илүү тохиромжтой —
          нэр устахгүй, дараа сэргээх боломжтой.
        </p>
      </div>
      {error && <div className="mt-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
      <div className="border-t border-slate-200 mt-4 pt-3 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
        <button
          onClick={() => mutation.mutate()}
          disabled={!canDelete || mutation.isPending}
          className="rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? 'Устгаж байна…' : 'Бүрмөсөн устгах'}
        </button>
      </div>
    </Modal>
  );
}

// ── Shared modal primitives ──────────────────────────────────────────────────
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({
  error, onCancel, onSubmit, loading, submitLabel = 'Хадгалах',
}: { error: string | null; onCancel: () => void; onSubmit: () => void; loading: boolean; submitLabel?: string }) {
  return (
    <>
      {error && (
        <div className="mt-4 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>
      )}
      <div className="border-t border-slate-200 -mx-6 mt-4 px-6 py-3 flex justify-end gap-2 bg-slate-50">
        <button onClick={onCancel} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
        <button onClick={onSubmit} disabled={loading} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60">
          {loading ? 'Хадгалж байна…' : submitLabel}
        </button>
      </div>
    </>
  );
}

function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const gen = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    onChange(pw + '!');
  };
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Хэрэглэгчид өгөх нууц үг"
        className={input}
        autoComplete="new-password"
      />
      <button type="button" onClick={gen} className="shrink-0 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2 text-slate-700">
        Үүсгэх
      </button>
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
