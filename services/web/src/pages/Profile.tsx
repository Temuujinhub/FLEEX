import { ReactNode, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

type MeResponse = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: string;
  status: string;
  companyId: string | null;
  company: { id: string; name: string; slug: string } | null;
  lastLoginAt: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Системийн админ',
  COMPANY_ADMIN: 'Компанийн админ',
  FLEET_MANAGER: 'Флот менежер',
  DISPATCHER: 'Диспетчер',
  DRIVER: 'Жолооч',
  VIEWER: 'Зөвхөн харах',
};

export function Profile() {
  const setAuthUser = useAuth((s) => s.setUser);
  const authUser = useAuth((s) => s.user);
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api.get<MeResponse>('/users/me').then((r) => r.data),
  });

  // Sync the latest /me into the persisted auth store so the sidebar reflects edits.
  useEffect(() => {
    if (me.data && authUser) {
      setAuthUser({
        ...authUser,
        fullName: me.data.fullName,
        phone: me.data.phone,
        company: me.data.company,
      });
    }
  }, [me.data]);

  return (
    <div className="p-6 md:p-8 max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Миний бүртгэл</h1>
        <p className="text-sm text-slate-500 mt-0.5">Хувийн мэдээлэл болон нууц үгийн тохиргоо.</p>
      </header>

      {me.isLoading && <div className="text-slate-400">Ачаалж байна…</div>}

      {me.data && (
        <>
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-base font-semibold mb-3">Үндсэн мэдээлэл</h2>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <ReadOnly label="Имэйл" value={me.data.email} />
              <ReadOnly label="Эрх" value={ROLE_LABEL[me.data.role] ?? me.data.role} />
              <ReadOnly label="Компани" value={me.data.company?.name ?? '— (Системийн)'} />
              <ReadOnly label="Сүүлд нэвтэрсэн" value={me.data.lastLoginAt ? new Date(me.data.lastLoginAt).toLocaleString() : '—'} />
            </div>
          </section>

          <ProfileEditForm me={me.data} onSaved={() => qc.invalidateQueries({ queryKey: ['users', 'me'] })} />
          <ChangePasswordForm />
        </>
      )}
    </div>
  );
}

function ProfileEditForm({ me, onSaved }: { me: MeResponse; onSaved: () => void }) {
  const [fullName, setFullName] = useState(me.fullName ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.patch('/users/me', { fullName: fullName.trim() || null, phone: phone.trim() || null }),
    onSuccess: () => { setError(null); setSavedAt(Date.now()); onSaved(); },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Алдаа гарлаа'),
  });

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-base font-semibold mb-3">Профайл</h2>
      <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
        <Field label="Бүтэн нэр">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} />
        </Field>
        <Field label="Утас">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+97699112233" className={input} />
        </Field>
      </div>
      {error && <div className="mt-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60"
        >
          {mutation.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
        {savedAt && Date.now() - savedAt < 5000 && (
          <span className="text-sm text-emerald-700">✓ Хадгалагдсан</span>
        )}
      </div>
    </section>
  );
}

function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post('/users/me/change-password', { currentPassword: current, newPassword: pw1 }),
    onSuccess: () => {
      setDone(true);
      setCurrent(''); setPw1(''); setPw2('');
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Нууц үг солих үед алдаа');
    },
  });

  const submit = () => {
    setError(null); setDone(false);
    if (!current) { setError('Одоогийн нууц үгээ оруулна уу'); return; }
    if (pw1.length < 8) { setError('Шинэ нууц үг 8+ тэмдэгт байх ёстой'); return; }
    if (pw1 !== pw2) { setError('Шинэ нууц үг таарахгүй байна'); return; }
    if (pw1 === current) { setError('Шинэ нууц үг хуучин нууц үгтэй ижил байна'); return; }
    mutation.mutate();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-base font-semibold mb-3">Нууц үг солих</h2>
      <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
        <Field label="Одоогийн нууц үг *" className="md:col-span-2">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} autoComplete="current-password" />
        </Field>
        <Field label="Шинэ нууц үг * (8+)">
          <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} className={input} autoComplete="new-password" />
        </Field>
        <Field label="Шинэ нууц үг (давтах) *">
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={input} autoComplete="new-password" />
        </Field>
      </div>
      {error && <div className="mt-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
      {done && <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-3 py-2">✓ Нууц үг шинэчлэгдсэн</div>}
      <div className="mt-4">
        <button
          onClick={submit}
          disabled={mutation.isPending}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60"
        >
          {mutation.isPending ? 'Шинэчилж байна…' : 'Нууц үг шинэчлэх'}
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-3">
        Нууц үгээ мартсан бол админдаа хандана уу — тэр <b>"Нууц үг шинэчлэх"</b> функцээр шинэ түр нууц үг өгнө.
      </p>
    </section>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">{label}</div>
      <div className="text-slate-900">{value}</div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}

const input =
  'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';
