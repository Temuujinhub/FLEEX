import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

// Subscription / billing (phase 2). COMPANY_ADMIN sees plan, usage, renewal and
// their invoices (with the number to pay by bank transfer). SUPER_ADMIN issues
// invoices, marks them paid (after reconciling against the bank by number) and
// assigns plans. Device-cap enforcement is server-side.

interface PlanView {
  key: string; name: string; deviceBand: string; blurb: string;
  maxDevices: number; maxUsers: number; retentionDays: number;
  reports: 'basic' | 'all'; scheduledReports: boolean; channels: string[];
  monthlySmsQuota: number; multiProtocol: boolean; monthlyPrice: number; custom: boolean;
}
interface Warning { level: 'info' | 'warning' | 'critical'; code: string; message: string }
interface Summary {
  managed: boolean; superAdmin?: boolean;
  planKey: string | null; planName?: string; status: string | null;
  currentPeriodEnd?: string | null; daysUntilDue?: number | null; suggestedPlan?: string;
  plan?: PlanView;
  usage: { devices: number; users: number; deviceLimit?: number; userLimit?: number; devicePct?: number | null; userPct?: number | null; smsUsed?: number; smsQuota?: number; smsPct?: number | null };
  warnings: Warning[];
}
interface Invoice {
  id: string; invoiceNumber: string; planKey: string; months: number; deviceCount: number;
  amount: number; currency: string; status: 'SENT' | 'PAID' | 'CANCELLED';
  periodStart: string; periodEnd: string; issuedAt: string; dueAt: string | null; paidAt: string | null;
}

const cap = (n?: number) => (n == null ? '—' : n < 0 ? '∞' : String(n));
const fmt = (n: number) => new Intl.NumberFormat('mn-MN').format(Math.round(n || 0));
const DURATIONS = [
  ...Array.from({ length: 11 }, (_, i) => ({ v: i + 1, label: `${i + 1} сар` })),
  { v: 12, label: '1 жил' }, { v: 24, label: '2 жил' }, { v: 36, label: '3 жил' },
];

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
        <p className="text-sm text-slate-500 mt-0.5">Захиалгын багц, ашиглалт, нэхэмжлэх ба дараагийн төлбөрийн огноо.</p>
      </header>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl">
        {isSuper ? <SuperAdminBilling plans={plans.data ?? []} /> : <CompanyBilling plans={plans.data ?? []} />}
        <PlanComparison plans={plans.data ?? []} />
      </div>
    </div>
  );
}

// ── Company admin's own view ──────────────────────────────────
function CompanyBilling({ plans }: { plans: PlanView[] }) {
  const me = useQuery({ queryKey: ['billing', 'me'], queryFn: () => api.get<Summary>('/billing/me').then((r) => r.data) });
  const invoices = useQuery({ queryKey: ['billing', 'invoices'], queryFn: () => api.get<Invoice[]>('/billing/invoices').then((r) => r.data) });
  if (me.isLoading) return <Card><div className="text-sm text-slate-500">Татаж байна…</div></Card>;
  if (me.isError || !me.data) return <Card><div className="text-sm text-rose-700">Алдаа гарлаа.</div></Card>;
  return (
    <div className="space-y-6">
      <SummaryView s={me.data} />
      <SelfInvoiceForm plans={plans} current={me.data} />
      <InvoiceList invoices={invoices.data ?? []} />
    </div>
  );
}

// Self-serve invoice: the company admin picks a plan + duration and gets an
// invoice number to pay by bank transfer. Price is the catalogue rate × months
// (server-enforced — no override here); Enterprise is "contact sales", not
// self-serve.
function SelfInvoiceForm({ plans, current }: { plans: PlanView[]; current: Summary }) {
  const qc = useQueryClient();
  const selectable = plans.filter((p) => !p.custom);
  const initial = current.planKey && selectable.some((p) => p.key === current.planKey)
    ? current.planKey
    : (current.suggestedPlan && selectable.some((p) => p.key === current.suggestedPlan) ? current.suggestedPlan : selectable[0]?.key ?? 'starter');
  const [planKey, setPlanKey] = useState(initial);
  const [months, setMonths] = useState('1');
  const [msg, setMsg] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post('/billing/invoices', { planKey, months: Number(months) }).then((r) => r.data),
    onSuccess: (inv: any) => { setMsg(`✓ Нэхэмжлэх үүслээ: ${inv.invoiceNumber}. Гүйлгээний утга дээр энэ дугаарыг бичиж шилжүүлнэ үү.`); qc.invalidateQueries({ queryKey: ['billing'] }); },
    onError: (e: any) => setMsg(e?.response?.data?.message ?? 'Алдаа гарлаа.'),
  });

  const selected = selectable.find((p) => p.key === planKey);
  const estimate = selected ? selected.monthlyPrice * Number(months || 0) : 0;

  return (
    <Card>
      <div className="text-sm font-semibold mb-1">Багц сунгах / шинэчлэх</div>
      <p className="text-xs text-slate-500 mb-3">Багц, хугацаагаа сонгоод нэхэмжлэх үүсгэнэ. Дугаараар нь банкаар төлсний дараа админ баталгаажуулж, багц сунгагдана.</p>
      <div className="grid sm:grid-cols-[1fr_8rem_auto] gap-2 items-end">
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Багц</label>
          <select value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
            {selectable.map((p) => <option key={p.key} value={p.key}>{p.name} — {fmt(p.monthlyPrice)}₮/сар</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Хугацаа</label>
          <select value={months} onChange={(e) => setMonths(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
            {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
          </select>
        </div>
        <button onClick={() => create.mutate()} disabled={create.isPending}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm py-2 px-4 disabled:opacity-50 whitespace-nowrap">
          Нэхэмжлэх үүсгэх
        </button>
      </div>
      <div className="mt-2 text-sm text-slate-600">Нийт дүн: <strong className="tabular-nums">{fmt(estimate)}₮</strong> <span className="text-xs text-slate-400">({months} сар × {fmt(selected?.monthlyPrice ?? 0)}₮)</span></div>
      <p className="mt-2 text-[11px] text-slate-400">Enterprise багцыг борлуулалтын багтай тохиролцоно — <a href="/#contact" className="underline">холбоо барих</a>.</p>
      {msg && <div className={clsx('mt-3 rounded-lg border px-3 py-2 text-sm', msg.startsWith('✓') ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800')}>{msg}</div>}
    </Card>
  );
}

function SummaryView({ s }: { s: Summary }) {
  return (
    <div className="space-y-4">
      {s.warnings?.map((w, i) => <WarningBanner key={i} w={w} />)}
      <Card>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Одоогийн багц</div>
            <div className="mt-1 text-2xl font-extrabold">{s.managed ? (s.planName ?? s.planKey) : 'Багц оноогоогүй'}</div>
            {s.status && <StatusChip status={s.status} />}
          </div>
          {s.managed && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Дараагийн төлбөр</div>
              <div className="mt-1 text-lg font-bold">{s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString('mn-MN') : '—'}</div>
              {s.daysUntilDue != null && (
                <div className={clsx('text-xs', s.daysUntilDue <= 0 ? 'text-rose-600' : s.daysUntilDue <= 10 ? 'text-amber-600' : 'text-slate-500')}>
                  {s.daysUntilDue <= 0 ? 'Хугацаа хэтэрсэн' : `${s.daysUntilDue} хоног үлдсэн`}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mt-5 grid sm:grid-cols-2 gap-4">
          <UsageBar label="Машин" used={s.usage.devices} limit={s.usage.deviceLimit} pct={s.usage.devicePct ?? null} />
          <UsageBar label="Хэрэглэгч" used={s.usage.users} limit={s.usage.userLimit} pct={s.usage.userPct ?? null} />
          {s.usage.smsQuota != null && s.usage.smsQuota !== 0 && (
            <UsageBar label="SMS (энэ сар)" used={s.usage.smsUsed ?? 0} limit={s.usage.smsQuota} pct={s.usage.smsPct ?? null} />
          )}
        </div>
        {!s.managed && (
          <p className="mt-4 text-xs text-slate-500">
            Багц оноогоогүй тул хязгаарлалт идэвхгүй. Санал болгож буй багц: <strong>{s.suggestedPlan ?? '—'}</strong>. Идэвхжүүлэхийг хүсвэл системийн админд хандана уу.
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
  const tone = w.level === 'critical' ? 'bg-rose-50 border-rose-200 text-rose-800'
    : w.level === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
      : 'bg-sky-50 border-sky-200 text-sky-900';
  return <div className={clsx('rounded-lg border px-4 py-2.5 text-sm', tone)}>{w.message}</div>;
}

function StatusChip({ status }: { status: string }) {
  const m: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-800', TRIAL: 'bg-sky-100 text-sky-800',
    PAST_DUE: 'bg-rose-100 text-rose-800', SUSPENDED: 'bg-rose-100 text-rose-800',
    CANCELLED: 'bg-slate-100 text-slate-500',
    SENT: 'bg-amber-100 text-amber-800', PAID: 'bg-emerald-100 text-emerald-800',
  };
  return <span className={clsx('inline-block text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-1', m[status] ?? 'bg-slate-100 text-slate-600')}>{status}</span>;
}

// ── Invoices ──────────────────────────────────────────────────
function InvoiceList({ invoices, admin, companyId }: { invoices: Invoice[]; admin?: boolean; companyId?: string }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['billing'] });
  };
  const pay = useMutation({
    mutationFn: (id: string) => api.post(`/billing/invoices/${id}/pay`, {}).then((r) => r.data),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/billing/invoices/${id}/cancel`, {}).then((r) => r.data),
    onSuccess: invalidate,
  });
  void companyId;

  return (
    <Card>
      <div className="text-sm font-semibold mb-1">Нэхэмжлэх</div>
      {!admin && (
        <p className="text-xs text-slate-500 mb-3">
          Банкны шилжүүлгийн <strong>гүйлгээний утга</strong> дээр нэхэмжлэхийн дугаарыг бичиж төлнө үү.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
            <tr>
              <th className="text-left px-3 py-2">Дугаар</th>
              <th className="text-left px-3 py-2">Багц</th>
              <th className="text-right px-3 py-2">Хугацаа</th>
              <th className="text-right px-3 py-2">Дүн (₮)</th>
              <th className="text-left px-3 py-2">Хүртэл</th>
              <th className="text-left px-3 py-2">Төлөв</th>
              {admin && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                <td className="px-3 py-2">{inv.planKey}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inv.months} сар</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(inv.amount)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{new Date(inv.periodEnd).toLocaleDateString('mn-MN')}</td>
                <td className="px-3 py-2"><StatusChip status={inv.status} /></td>
                {admin && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {inv.status === 'SENT' && (
                      <>
                        <button onClick={() => pay.mutate(inv.id)} disabled={pay.isPending}
                          className="text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 disabled:opacity-50">Төлсөн</button>
                        <button onClick={() => cancel.mutate(inv.id)} disabled={cancel.isPending}
                          className="ml-1 text-xs rounded border border-slate-300 hover:bg-slate-100 px-2 py-1 disabled:opacity-50">Цуцлах</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td colSpan={admin ? 7 : 6} className="px-3 py-8 text-center text-sm text-slate-400">Нэхэмжлэх алга</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

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
              <th className="text-left px-3 py-2">Машин</th>
              <th className="text-right px-3 py-2">Үнэ/сар</th>
              <th className="text-right px-3 py-2">Хадгалалт</th>
              <th className="text-right px-3 py-2">SMS/сар</th>
              <th className="text-left px-3 py-2">Тайлан</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plans.map((p) => (
              <tr key={p.key} className="hover:bg-slate-50">
                <td className="px-3 py-2"><div className="font-semibold">{p.name}</div><div className="text-xs text-slate-500">{p.blurb}</div></td>
                <td className="px-3 py-2">{p.deviceBand}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.custom ? 'Тусгай' : `${fmt(p.monthlyPrice)}₮`}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.retentionDays} хон.</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.monthlySmsQuota < 0 ? '∞' : p.monthlySmsQuota === 0 ? '—' : fmt(p.monthlySmsQuota)}</td>
                <td className="px-3 py-2">{p.reports === 'all' ? 'Бүх тайлан' : 'Үндсэн'}{p.scheduledReports ? ' + имэйл' : ''}</td>
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
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get('/companies').then((r) => r.data as Array<{ id: string; name: string }>) });
  const sub = useQuery({ queryKey: ['billing', 'company', companyId], queryFn: () => api.get<Summary>(`/billing/companies/${companyId}`).then((r) => r.data), enabled: !!companyId });
  const invoices = useQuery({ queryKey: ['billing', 'company-invoices', companyId], queryFn: () => api.get<Invoice[]>(`/billing/companies/${companyId}/invoices`).then((r) => r.data), enabled: !!companyId });

  const [planKey, setPlanKey] = useState('starter');
  const [months, setMonths] = useState('1');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const setPlan = useMutation({
    mutationFn: () => api.post(`/billing/companies/${companyId}/plan`, { planKey }).then((r) => r.data),
    onSuccess: () => { setMsg('Багц оноогдлоо.'); qc.invalidateQueries({ queryKey: ['billing', 'company', companyId] }); },
    onError: (e: any) => setMsg(e?.response?.data?.message ?? 'Алдаа'),
  });
  const createInvoice = useMutation({
    mutationFn: () => api.post(`/billing/companies/${companyId}/invoices`, {
      planKey, months: Number(months), ...(amount ? { amount: Number(amount) } : {}),
    }).then((r) => r.data),
    onSuccess: (inv: any) => { setMsg(`Нэхэмжлэх үүслээ: ${inv.invoiceNumber}`); qc.invalidateQueries({ queryKey: ['billing', 'company-invoices', companyId] }); },
    onError: (e: any) => setMsg(e?.response?.data?.message ?? 'Алдаа'),
  });

  const selectedPlan = plans.find((p) => p.key === planKey);
  const estimate = selectedPlan && !selectedPlan.custom ? selectedPlan.monthlyPrice * Number(months || 0) : null;

  return (
    <Card>
      <div className="text-sm font-semibold mb-3">Компанийн багц удирдах (SUPER_ADMIN)</div>
      <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setMsg(null); }} className="w-full max-w-sm rounded-md border border-slate-200 px-3 py-2 text-sm">
        <option value="">— Компани сонгох —</option>
        {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      {companyId && sub.data && (
        <div className="mt-4 space-y-4">
          <SummaryView s={sub.data} />

          <div className="grid sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Багц + хугацаа</label>
              <div className="flex gap-2">
                <select value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  {plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
                <select value={months} onChange={(e) => setMonths(e.target.value)} className="w-28 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                </select>
              </div>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0"
                placeholder={estimate != null ? `Дүн (автомат: ${fmt(estimate)}₮)` : 'Дүн ₮ (тусгай үнэ)'}
                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              <button onClick={() => createInvoice.mutate()} disabled={createInvoice.isPending}
                className="mt-2 w-full rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm py-2 disabled:opacity-50">
                Нэхэмжлэх үүсгэх
              </button>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Багц шууд оноох (төлбөргүй)</label>
              <p className="text-[11px] text-slate-500 mb-2">Зөвхөн багцын төрөл/хязгаарыг тааруулна. Хугацаа сунгахын тулд нэхэмжлэх → "Төлсөн" ашиглана.</p>
              <button onClick={() => setPlan.mutate()} disabled={setPlan.isPending}
                className="w-full rounded-md bg-slate-800 hover:bg-slate-700 text-white text-sm py-2 disabled:opacity-50">
                "{selectedPlan?.name ?? planKey}" багц оноох
              </button>
            </div>
          </div>
          {msg && <div className="text-xs text-slate-600">{msg}</div>}

          <InvoiceList invoices={invoices.data ?? []} admin companyId={companyId} />
        </div>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">{children}</div>;
}
