import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setTokens } from '../lib/api';
import { useAuth } from '../store/auth';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setUser = useAuth((s) => s.setUser);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post('/auth/login', { email, password });
      setTokens(r.data.accessToken, r.data.refreshToken);
      setUser(r.data.user);
      navigate('/app');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Нэвтрэх явцад алдаа гарлаа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-brand-900 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <div className="text-3xl font-extrabold text-brand-700">Fleex</div>
          <div className="text-sm text-slate-500 mt-1">Системд нэвтрэх</div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Имэйл</label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Нууц үг</label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 disabled:opacity-60"
          >
            {loading ? 'Нэвтэрч байна…' : 'Нэвтрэх'}
          </button>
        </form>
      </div>
    </div>
  );
}
