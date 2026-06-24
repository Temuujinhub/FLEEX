import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, setTokens } from '../lib/api';
import { useAuth } from '../store/auth';
import { homeRoute } from '../lib/viewMode';

const HERO =
  'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=1800&q=85&auto=format&fit=crop';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setUser = useAuth((s) => s.setUser);
  const { t, i18n } = useTranslation();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post('/auth/login', { email, password });
      setTokens(r.data.accessToken, r.data.refreshToken);
      setUser(r.data.user);
      // Land on the lightweight view for phones / data-saver clients (or a
      // saved preference); desktops get the full console.
      navigate(homeRoute());
    } catch (err: any) {
      setError(err.response?.data?.message ?? t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-950 text-white">
      {/* ── Brand / form panel ───────────────────────────── */}
      <div className="w-full lg:w-[480px] xl:w-[520px] shrink-0 flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-brand-900 px-8 py-10 lg:px-12">
        <header className="flex items-center gap-3">
          <Logo />
          <div className="flex-1">
            <div className="text-2xl font-extrabold tracking-tight">Fleex</div>
            <div className="text-xs text-brand-200/80 -mt-0.5">{t('login.tagline')}</div>
          </div>
          <div className="flex gap-1">
            {(['mn', 'en'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => i18n.changeLanguage(lng)}
                className={`rounded-md text-xs px-2.5 py-1 font-semibold uppercase transition ${
                  i18n.resolvedLanguage === lng
                    ? 'bg-brand-600 text-white'
                    : 'bg-white/10 text-slate-300 hover:bg-white/20'
                }`}
              >
                {lng}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mt-12 lg:mt-0">
          <h1 className="text-3xl font-bold leading-tight">
            {t('login.headline1')}
            <br />
            <span className="text-brand-300">{t('login.headline2')}</span> {t('login.headline3')}
          </h1>
          <p className="mt-3 text-sm text-slate-300/90 leading-relaxed">{t('login.subtitle')}</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-slate-400 mb-1.5">
                {t('login.email')}
              </label>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ner@kompani.mn"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:bg-white/10 transition"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-slate-400 mb-1.5">
                {t('login.password')}
              </label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:bg-white/10 transition"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-200 text-sm px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-semibold py-2.5 disabled:opacity-60 transition shadow-lg shadow-brand-900/40"
            >
              {loading ? t('login.signingIn') : t('login.signIn')}
            </button>
          </form>

          <div className="mt-8 grid grid-cols-3 gap-3 text-center">
            <Capability label={t('login.capRealtime')} value="<1s" />
            <Capability label={t('login.capRetention')} value={t('login.capRetentionValue')} />
            <Capability label={t('login.capUptime')} value="99.9%" />
          </div>
        </div>

        <footer className="mt-10 lg:mt-0 pt-6 border-t border-white/10 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} MediaPRO ХХК · fleex.mn</span>
          <a href="mailto:fleex@mediapro.mn" className="hover:text-brand-300">
            fleex@mediapro.mn · 8888-1018
          </a>
        </footer>
      </div>

      {/* ── Hero image (right side on lg+) ───────────────── */}
      <div
        className="hidden lg:block flex-1 relative bg-cover bg-center"
        style={{ backgroundImage: `url(${HERO})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/70 via-slate-950/20 to-slate-950/40" />
        <div className="absolute bottom-10 right-10 max-w-md text-right">
          <div className="text-xs uppercase tracking-[0.3em] text-brand-200/80">
            {t('login.heroRegions')}
          </div>
          <div className="mt-2 text-xl font-semibold text-white drop-shadow-lg">
            {t('login.heroCaption')}
          </div>
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="text-brand-400" aria-hidden>
      <circle cx="18" cy="18" r="17" fill="currentColor" opacity="0.15" />
      <path
        d="M9 24l5-8 5 4 8-12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="27" cy="8" r="2.5" fill="currentColor" />
    </svg>
  );
}

function Capability({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 px-2 py-2">
      <div className="text-base font-bold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
    </div>
  );
}
