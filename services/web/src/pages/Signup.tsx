import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setTokens } from '../lib/api';
import { useAuth } from '../store/auth';
import { homeRoute } from '../lib/viewMode';

// Self-serve tenant signup → POST /auth/register-company creates the company,
// its first COMPANY_ADMIN and a 14-day Starter trial, then returns tokens so we
// log the user straight in.
export function Signup() {
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setUser = useAuth((s) => s.setUser);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accepted) { setError('Үйлчилгээний нөхцөл, нууцлалын бодлогыг зөвшөөрнө үү.'); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await api.post('/auth/register-company', {
        companyName, fullName, email, password, phone: phone || undefined, acceptedTerms: accepted,
      });
      setTokens(r.data.accessToken, r.data.refreshToken);
      setUser(r.data.user);
      navigate(homeRoute());
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Бүртгэл амжилтгүй боллоо.');
    } finally {
      setLoading(false);
    }
  };

  const input = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:bg-white/10 transition';
  const label = 'block text-xs uppercase tracking-widest text-slate-400 mb-1.5';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-brand-900 text-white px-6 py-10">
      <div className="w-full max-w-md">
        <header className="flex items-center gap-3 mb-8">
          <Logo />
          <div>
            <div className="text-2xl font-extrabold tracking-tight">Fleex</div>
            <div className="text-xs text-brand-200/80 -mt-0.5">14 хоног үнэгүй туршина</div>
          </div>
        </header>

        <h1 className="text-2xl font-bold">Байгууллагаа бүртгүүлэх</h1>
        <p className="mt-1.5 text-sm text-slate-300/90">Starter багцаар 14 хоног үнэгүй — картын мэдээлэл шаардахгүй.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className={label}>Байгууллагын нэр</label>
            <input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Жнь: Говь Транс ХХК" className={input} />
          </div>
          <div>
            <label className={label}>Таны нэр</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Овог нэр" className={input} />
          </div>
          <div>
            <label className={label}>Имэйл</label>
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ner@kompani.mn" className={input} />
          </div>
          <div>
            <label className={label}>Нууц үг (8+ тэмдэгт)</label>
            <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={input} />
          </div>
          <div>
            <label className={label}>Утас (заавал биш)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="99XXXXXX" className={input} />
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
            <span>
              <a href="/legal/terms" target="_blank" className="text-brand-300 hover:text-brand-200 underline">Үйлчилгээний нөхцөл</a>
              {' '}болон{' '}
              <a href="/legal/privacy" target="_blank" className="text-brand-300 hover:text-brand-200 underline">Нууцлалын бодлого</a>
              -ыг зөвшөөрч байна.
            </span>
          </label>

          {error && (
            <div className="rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-200 text-sm px-3 py-2">{error}</div>
          )}

          <button type="submit" disabled={loading} className="w-full rounded-lg bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-semibold py-2.5 disabled:opacity-60 transition shadow-lg shadow-brand-900/40">
            {loading ? 'Бүртгэж байна…' : 'Үнэгүй эхлэх'}
          </button>
        </form>

        <p className="mt-5 text-sm text-slate-400">
          Бүртгэлтэй юу? <a href="/login" className="text-brand-300 font-semibold hover:text-brand-200">Нэвтрэх</a>
        </p>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="text-brand-400" aria-hidden>
      <circle cx="18" cy="18" r="17" fill="currentColor" opacity="0.15" />
      <path d="M9 24l5-8 5 4 8-12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="27" cy="8" r="2.5" fill="currentColor" />
    </svg>
  );
}
