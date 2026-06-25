import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

// Subscription / billing (phase 2). A COMPANY_ADMIN sees their own plan, usage
// and renewal; a SUPER_ADMIN gets a company picker plus plan-assignment and
// manual-payment controls. Enforcement (device cap) lives server-side.

interface PlanView {
  key: string; name: string; blurb: string;
  maxDevices: number; maxUsers: number; retentionDays: number;
  reports: 'basic' | 'all'; scheduledReports: boolean; channels: string[];
  multiProtocol: boolean; pricePerDeviceMonth: number; billingPeriodDays: number;
}
interface Warning { level: 'info' | 'warning' | 'critical'; code: string; message: string }
interface Summary {
  managed: boolean; superAdmin?: boolean;
  planKey: string | null; planName?: string; status: string | null;
  currentPeriodEnd?: string | null; daysUntilDue?: number | null;
  plan?: PlanView;
  usage: { devices: number; users: number; deviceLimit?: number; userLimit?: number; devicePct?: number | null; userPct?: number | null };
  warnings: Warning[];
  plans?: PlanView[];
}

const cap = (n?: number) => (n == null ? '—' : n < 0 ? '∞' : String(n));

export function Billing() {
  const role = useAuth((s) => s.user?.role);
  const isSuper = role === 'SUPER_ADMIN';

  const plans = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: () => api.get<PlanView[]>('/billing/plans').then((r) => r.data),
  });

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <h1 className="text-2xl font-bold">Багц · төлбөр</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Захиалгын багц, ашиглалтын хязгаар, дараагийн төлбөрийн огноо.
        </p>
      </header>

      <div className="p-4 md:p-6 space-y-6 max-w-5xl">
        {isSuper ? <SuperAdminBilling plans={plans.data ?? []} /> : <CompanyBilling />}
        <PlanComparison plans={plans.data ?? []} />
      </div>
    </div>
  );
}

// ── Company admin's own subscription ──────────────────────────
function CompanyBilling() {
  const q = useQuery({
    queryKey: ['billing', 'me'],
    queryFn: () => api.get<Summary>('/billing/me').then((r) => r.data),
  });
  if (q.isLoading) return <Card><div className="text-sm text-slate-500">Татаж байна…</div></Card>;
  if (q.isError || !q.data) return <Card><div className="text-sm text-rose-700">Алдаа гарлаа.</div></Card>;
  return <SummaryView s={q.data} />;
}

function SummaryView({ s }: { s: Summary }) {
  return (
    <div className="space-y-4">
      {s.warnings?.map((w, i) => <WarningBanner key={i} w={w} />)}
      <Card>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Одоогийн багц</div>
            <div className="mt-1 text-2xl font-extrabold">
              {s.managed ? (s.planName ?? s.planKey) : 'Багц оноогоогүй'}
            </div>
            {s.status && <StatusChip status={s.status} />}
          </div>
          {s.managed && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Дараагийн төлбөр</div>
              <div className="mt-1 text-lg font-bold">
                {s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString('mn-MN') : '—'}
              </div>
              {s.daysUntilDue != null && (
                <div className={clsx('text-xs', s.daysUntilDue <= 0 ? 'text-rose-600' : s.daysUntilDue <= 7 ? 'text-amber-600' : 'text-slate-500')}>
                  {s.daysUntilDue <= 0 ? 'Хугацаа хэтэрсэн' : `${s.daysUntilDue} хоног үлдсэн`}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 grid sm:grid-cols-2 gap-4">
          <UsageBar label="Машин" used={s.usage.devices} limit={s.usage.deviceLimit} pct={s.usage.devicePct ?? null} />
          <UsageBar label="Хэрэглэгч" used={s.usage.users} limit={s.usage.userLimit} pct={s.usage.userPct ?? null} />
        </div>
        {!s.managed && (
          <p className="mt-4 text-xs text-slate-500">
            Энэ компанид багц оноогоогүй тул хязгаарлалт идэвхгүй. Багц идэвхжүүлэхийг хүсвэл системийн админтай холбогдоно уу.
          </p>
        )}
      </Card>
    </div>
  );
}

function UsageBar({ label, used, limit, pct }: { label: string; used: number; limit?: number; pct: number | null }) {
  const unlimited = limit == null || limit < 0;
  const ratio = pct == null ? 0 : Math.min(100, pct);
  const tone = pct == null ? 'bg-slate-400' : pct >= 100 ? 'bg-rose-500' : pct >= 90 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-slate-600">{used}{unlimited ? '' : ` / ${cap(limit)}`}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-200 overflow-hidden">
        <div className={clsx('h-full rounded-full', tone)} style={{ width: unlimited ? '8%' : `${ratio}%` }} />
      </div>
      {unlimited && <div className="mt-0.5 text-[11px] text-slate-400">Хязгааргүй</div>}
    </div>
  );
}

function WarningBanner({ w }: { w: Warning }) {
  const tone =
    w.level === 'critical' ? 'bg-rose-50 border-rose-200 text-rose-800'
      : w.level === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-sky-50 border-sky-200 text-sky-900';
  return <div className={clsx('rounded-lg border px-4 py-2.5 text-sm', tone)}>{w.message}</div>;
}

function StatusChip({ status }: { status: string }) {
  const m: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    TRIAL: 'bg-sky-100 text-sky-800',
    PAST_DUE: 'bg-rose-100 text-rose-800',
    SUSPENDED: 'bg-rose-100 text-rose-800',
    CANCELLED: 'bg-slate-100 text-slate-500',
  };
  return <span className={clsx('inline-block mt-1.5 text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-1', m[status] ?? 'bg-slate-100 text-slate-600')}>{status}</span>;
}

// ── Plan comparison (catalogue) ───────────────────────────────
function PlanComparison({ plans }: { plans: PlanView[] }) {
  if (plans.length === 0) return null;
  return (
    <Card>
      <div className="text-sm font-semibold mb-3">Багцуудын харьцуулалт</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
            <tr>
              <th className="text-left px-3 py-2">Багц</th>
              <th className="text-right px-3 py-2">Машин</th>
              <th className="text-right px-3 py-2">Хэрэглэгч</th>
              <th className="text-right px-3 py-2">Хадгалалт</th>
              <th className="text-left px-3 py-2">Тайлан</th>
              <th className="text-left px-3 py-2">Суваг</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plans.map((p) => (
              <tr key={p.key} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.blurb}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{cap(p.maxDevices)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cap(p.maxUsers)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.retentionDays} хон.</td>
                <td className="px-3 py-2">{p.reports === 'all' ? 'Бүх тайлан' : 'Үндсэн'}{p.scheduledReports ? ' + имэйл' : ''}</td>
                <td className="px-3 py-2 text-xs">{p.channels.length} суваг</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── SUPER_ADMIN management ────────────────────────────────────
function SuperAdminBilling({ plans }: { plans: PlanView[] }) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get('/companies').then((r) => r.data as Array<{ id: string; name: string }>),
  });
  const sub = useQuery({
    queryKey: ['billing', 'company', companyId],
    queryFn: () => api.get<Summary>(`/billing/companies/${companyId}`).then((r) => r.data),
    enabled: !!companyId,
  });

  const [planKey, setPlanKey] = useState('basic');
  const [amount, setAmount] = useState('');
  const [periods, setPeriods] = useState('1');
  const [msg, setMsg] = useState<string | null>(null);

  const setPlan = useMutation({
    mutationFn: () => api.post(`/billing/companies/${companyId}/plan`, { planKey }).then((r) => r.data),
    onSuccess: () => { setMsg('Багц шинэчлэгдлээ.'); qc.invalidateQueries({ queryKey: ['billing', 'company', companyId] }); },
    onError: (e: any) => setMsg(e?.response?.data?.message ?? 'Алдаа гарлаа'),
  });
  const pay = useMutation({
    mutationFn: () => api.post(`/billing/companies/${companyId}/payment`, {
      planKey, amount: Number(amount) || 0, periods: Number(periods) || 1, method: 'manual',
    }).then((r) => r.data),
    onSuccess: () => { setMsg('Төлбөр бүртгэгдэж, хугацаа сунгагдлаа.'); qc.invalidateQueries({ queryKey: ['billing', 'company', companyId] }); },
    onError: (e: any) => setMsg(e?.response?.data?.message ?? 'Алдаа гарлаа'),
  });

  return (
    <Card>
      <div className="text-sm font-semibold mb-3">Компанийн багц удирдах (SUPER_ADMIN)</div>
      <select
        value={companyId}
        onChange={(e) => { setCompanyId(e.target.value); setMsg(null); }}
        className="w-full max-w-sm rounded-md border border-slate-200 px-3 py-2 text-sm"
      >
        <option value="">— Компани сонгох —</option>
        {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      {companyId && sub.data && (
        <div className="mt-4 space-y-4">
          <SummaryView s={sub.data} />
          <div className="grid sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Багц</label>
              <select value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                {plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
              <button onClick={() => setPlan.mutate()} disabled={setPlan.isPending}
                className="mt-2 w-full rounded-md bg-slate-800 hover:bg-slate-700 text-white text-sm py-2 disabled:opacity-50">
                Багц оноох
              </button>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Төлбөр бүртгэх</label>
              <div className="flex gap-2">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" placeholder="Дүн ₮"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                <input value={periods} onChange={(e) => setPeriods(e.target.value)} type="number" min="1" max="36" title="Хэдэн үе (сар)"
                  className="w-20 rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <button onClick={() => pay.mutate()} disabled={pay.isPending}
                className="mt-2 w-full rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm py-2 disabled:opacity-50">
                Төлбөр бүртгэх + сунгах
              </button>
            </div>
          </div>
          {msg && <div className="text-xs text-slate-600">{msg}</div>}
        </div>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">{children}</div>;
}
