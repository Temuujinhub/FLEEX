import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

// Support ticket inbox. Two audiences share the same screen, by design:
//   - Company admins file complaints / bug reports / repair requests and
//     see only their tenant's history.
//   - SUPER_ADMIN (admin@fleex.mn) sees every company's tickets, can
//     change status, and reply.
// Keeping it one page (instead of separate "submit" and "inbox" pages)
// avoids the awkward "where did my reply go" handoff when a tenant
// follows up on an open thread.

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
type TicketCategory = 'COMPLAINT' | 'BUG' | 'REPAIR_REQUEST' | 'OTHER';
type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  category: TicketCategory;
  priority: TicketPriority;
  contactPhone: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  company: { id: string; name: string };
  submitter: { id: string; email: string; fullName: string | null };
  _count: { replies: number };
}

interface TicketDetail extends Ticket {
  replies: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; email: string; fullName: string | null; role: string };
  }>;
}

const CATEGORY: Record<TicketCategory, { label: string; tone: string }> = {
  COMPLAINT:      { label: 'Гомдол',           tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  BUG:            { label: 'Алдаа',            tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  REPAIR_REQUEST: { label: 'Засварийн хүсэлт', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  OTHER:          { label: 'Бусад',            tone: 'bg-slate-50 text-slate-700 border-slate-200' },
};

const PRIORITY: Record<TicketPriority, { label: string; tone: string }> = {
  LOW:    { label: 'Бага',     tone: 'bg-slate-100 text-slate-700' },
  NORMAL: { label: 'Энгийн',   tone: 'bg-sky-100 text-sky-800' },
  HIGH:   { label: 'Өндөр',    tone: 'bg-amber-100 text-amber-800' },
  URGENT: { label: 'Яаралтай', tone: 'bg-rose-100 text-rose-800' },
};

const STATUS: Record<TicketStatus, { label: string; tone: string }> = {
  OPEN:        { label: 'Шинэ',         tone: 'bg-emerald-100 text-emerald-800' },
  IN_PROGRESS: { label: 'Хийгдэж байна', tone: 'bg-amber-100 text-amber-800' },
  RESOLVED:    { label: 'Шийдвэрлэсэн', tone: 'bg-sky-100 text-sky-800' },
  CLOSED:      { label: 'Хаалттай',     tone: 'bg-slate-200 text-slate-700' },
};

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: 'ALL', label: 'Бүгд' },
  { id: 'OPEN', label: 'Шинэ' },
  { id: 'IN_PROGRESS', label: 'Хийгдэж байна' },
  { id: 'RESOLVED', label: 'Шийдвэрлэсэн' },
  { id: 'CLOSED', label: 'Хаалттай' },
];

const inputCls =
  'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

export function SupportTickets() {
  const me = useAuth((s) => s.user);
  const isSuper = me?.role === 'SUPER_ADMIN';
  const canCreate = me?.role === 'SUPER_ADMIN' || me?.role === 'COMPANY_ADMIN';

  const [filter, setFilter] = useState<string>('ALL');
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const tickets = useQuery({
    queryKey: ['support-tickets', filter],
    queryFn: () =>
      api.get<Ticket[]>(`/support-tickets${filter !== 'ALL' ? `?status=${filter}` : ''}`).then((r) => r.data),
  });

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Дэмжлэг · Тасалбар</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isSuper
              ? 'Бүх компаниас ирсэн гомдол, алдаа, засварийн хүсэлтийг хянана.'
              : 'Алдаа, гомдол, засварийн хүсэлтийг шууд админ багт илгээнэ.'}
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => { setComposing(true); setSelected(null); }}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow-sm"
          >
            + Шинэ тасалбар
          </button>
        )}
      </header>

      <div className="flex-1 grid lg:grid-cols-[420px_1fr] gap-0 overflow-hidden">
        {/* Left: list + filter */}
        <aside className="bg-white border-r border-slate-200 flex flex-col">
          <div className="border-b border-slate-100 px-3 py-2 flex gap-1 overflow-x-auto">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={clsx(
                  'rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition',
                  filter === f.id
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {tickets.isLoading && (
              <div className="p-8 text-center text-slate-400 text-sm">Ачаалж байна…</div>
            )}
            {!tickets.isLoading && (tickets.data ?? []).length === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm">
                {filter === 'ALL' ? 'Тасалбар алга' : 'Энэ статус дотор тасалбар алга'}
              </div>
            )}
            {(tickets.data ?? []).map((t) => (
              <button
                key={t.id}
                onClick={() => { setSelected(t.id); setComposing(false); }}
                className={clsx(
                  'w-full text-left px-4 py-3 hover:bg-slate-50 transition',
                  selected === t.id && 'bg-brand-50/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm line-clamp-1">{t.title}</div>
                  <span className={clsx('text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded', STATUS[t.status].tone)}>
                    {STATUS[t.status].label}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1 line-clamp-1">{t.description}</div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className={clsx('text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border', CATEGORY[t.category].tone)}>
                    {CATEGORY[t.category].label}
                  </span>
                  <span className={clsx('text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded', PRIORITY[t.priority].tone)}>
                    {PRIORITY[t.priority].label}
                  </span>
                  {isSuper && (
                    <span className="text-[10px] text-slate-500">· {t.company.name}</span>
                  )}
                  {t._count.replies > 0 && (
                    <span className="text-[10px] text-slate-400 ml-auto">💬 {t._count.replies}</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">{new Date(t.createdAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </aside>

        {/* Right: detail or compose */}
        <main className="overflow-y-auto bg-slate-50">
          {composing ? (
            <ComposeTicket onClose={() => setComposing(false)} onSubmitted={(id) => { setComposing(false); setSelected(id); }} />
          ) : selected ? (
            <TicketDetailPanel id={selected} isSuper={isSuper} />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm p-10">
              Зүүн талаас тасалбар сонгох эсвэл шинээр үүсгэнэ үү.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ComposeTicket({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: (id: string) => void }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>('OTHER');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [contactPhone, setContactPhone] = useState(me?.phone ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: (payload: any) => api.post<Ticket>('/support-tickets', payload).then((r) => r.data),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['support-tickets'] });
      qc.invalidateQueries({ queryKey: ['support-tickets-stats'] });
      onSubmitted(created.id);
    },
    onError: (e: any) => setError(e?.response?.data?.message?.toString?.() ?? 'Алдаа гарлаа'),
  });

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Шинэ тасалбар үүсгэх</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Гарчиг *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Жнь: Тайлан хийхэд алдаа гарч байна" className={inputCls} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Ангилал</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className={inputCls}>
              {Object.entries(CATEGORY).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Зэрэглэл</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className={inputCls}>
              {Object.entries(PRIORITY).map(([v, p]) => <option key={v} value={v}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Дэлгэрэнгүй *</label>
          <textarea
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Юу болсон, юу хүлээгдэж байсныг бичнэ үү. Хэрэв алдаа бол ямар алхмаар давтагдсаныг тэмдэглэнэ үү."
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">Холбоо барих утас</label>
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+976 9909 1911" className={inputCls} />
        </div>
        {error && <div className="rounded-md bg-rose-50 text-rose-800 px-3 py-2 text-xs">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
          <button
            onClick={() => {
              if (title.trim().length < 3) return setError('Гарчиг хэт богино байна');
              if (description.trim().length < 1) return setError('Дэлгэрэнгүй хэсгийг бөглөнө үү');
              submit.mutate({ title: title.trim(), description: description.trim(), category, priority, contactPhone: contactPhone.trim() || undefined });
            }}
            disabled={submit.isPending}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-50"
          >
            {submit.isPending ? 'Илгээж байна…' : 'Илгээх'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketDetailPanel({ id, isSuper }: { id: string; isSuper: boolean }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const detail = useQuery({
    queryKey: ['support-ticket', id],
    queryFn: () => api.get<TicketDetail>(`/support-tickets/${id}`).then((r) => r.data),
  });
  const [reply, setReply] = useState('');

  const sendReply = useMutation({
    mutationFn: () => api.post(`/support-tickets/${id}/replies`, { body: reply.trim() }),
    onSuccess: () => {
      setReply('');
      qc.invalidateQueries({ queryKey: ['support-ticket', id] });
      qc.invalidateQueries({ queryKey: ['support-tickets'] });
    },
  });
  const updateStatus = useMutation({
    mutationFn: (status: TicketStatus) => api.patch(`/support-tickets/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support-ticket', id] });
      qc.invalidateQueries({ queryKey: ['support-tickets'] });
      qc.invalidateQueries({ queryKey: ['support-tickets-stats'] });
    },
  });
  const removeTicket = useMutation({
    mutationFn: () => api.delete(`/support-tickets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['support-tickets'] }),
  });

  const t = detail.data;
  const canDelete = useMemo(() => {
    if (!t || !me) return false;
    return me.role === 'SUPER_ADMIN' || t.submitter.id === me.id;
  }, [t, me]);

  if (detail.isLoading) {
    return <div className="p-10 text-slate-400 text-sm text-center">Ачаалж байна…</div>;
  }
  if (!t) {
    return <div className="p-10 text-slate-400 text-sm text-center">Тасалбар олдсонгүй</div>;
  }

  return (
    <div className="p-6 md:p-8 space-y-4 max-w-3xl">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold flex-1">{t.title}</h2>
          <span className={clsx('text-xs uppercase tracking-wider px-2 py-0.5 rounded', STATUS[t.status].tone)}>
            {STATUS[t.status].label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={clsx('uppercase tracking-wider px-2 py-0.5 rounded border', CATEGORY[t.category].tone)}>
            {CATEGORY[t.category].label}
          </span>
          <span className={clsx('uppercase tracking-wider px-2 py-0.5 rounded', PRIORITY[t.priority].tone)}>
            {PRIORITY[t.priority].label}
          </span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600">{t.submitter.fullName ?? t.submitter.email}</span>
          {isSuper && (
            <>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600">{t.company.name}</span>
            </>
          )}
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">{new Date(t.createdAt).toLocaleString()}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed pt-2">{t.description}</p>
        {t.contactPhone && (
          <div className="text-xs text-slate-500">Утас: <span className="font-mono">{t.contactPhone}</span></div>
        )}
        {isSuper && (
          <div className="border-t border-slate-100 pt-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">Статус өөрчлөх:</span>
            {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as TicketStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => updateStatus.mutate(s)}
                disabled={t.status === s || updateStatus.isPending}
                className={clsx(
                  'text-xs px-2.5 py-1 rounded border transition',
                  t.status === s
                    ? 'border-brand-500 bg-brand-50 text-brand-800'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300',
                  updateStatus.isPending && 'opacity-50',
                )}
              >
                {STATUS[s].label}
              </button>
            ))}
            {canDelete && (
              <button
                onClick={() => { if (confirm('Тасалбарыг устгах уу?')) removeTicket.mutate(); }}
                className="ml-auto text-xs text-rose-700 hover:underline"
              >
                Устгах
              </button>
            )}
          </div>
        )}
      </div>

      {/* Reply thread */}
      <div className="space-y-3">
        {t.replies.map((r) => {
          const isAdmin = r.author.role === 'SUPER_ADMIN';
          return (
            <div
              key={r.id}
              className={clsx(
                'rounded-2xl border p-4',
                isAdmin
                  ? 'bg-brand-50/40 border-brand-200'
                  : 'bg-white border-slate-200',
              )}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className={clsx('font-semibold', isAdmin ? 'text-brand-800' : 'text-slate-800')}>
                  {r.author.fullName ?? r.author.email}
                </span>
                {isAdmin && <span className="text-[10px] uppercase tracking-wider bg-brand-100 text-brand-800 px-1.5 py-0.5 rounded">Админ</span>}
                <span className="text-slate-400">· {new Date(r.createdAt).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700 mt-1.5">{r.body}</p>
            </div>
          );
        })}
      </div>

      {/* Reply composer (anyone with read access can reply) */}
      {t.status !== 'CLOSED' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
          <textarea
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={isSuper ? 'Хариу бичих…' : 'Нэмэлт мэдээлэл / тодруулга…'}
            className={inputCls}
          />
          <div className="flex justify-end">
            <button
              onClick={() => sendReply.mutate()}
              disabled={!reply.trim() || sendReply.isPending}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"
            >
              {sendReply.isPending ? 'Илгээж байна…' : 'Илгээх'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
