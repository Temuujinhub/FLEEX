import { ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

type ApiCompany = {
  id: string;
  name: string;
  slug: string;
  contactEmail: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export function Companies() {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiCompany | null>(null);

  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<ApiCompany[]>('/companies').then((r) => r.data),
  });

  return (
    <div className="p-6 md:p-8 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Компаниуд</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Fleex дээр ажиллах байгууллагууд. Шинэ компани нэмэхэд нэр + товч нэр (slug) + холбоо барих имэйл шаардлагатай.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow-sm"
        >
          + Компани нэмэх
        </button>
      </header>

      <div className="bg-gradient-to-br from-brand-50 to-white border border-brand-200 rounded-xl p-4 text-sm text-slate-700">
        <b>Компани (tenant) гэж юу вэ?</b> Нэг компани = нэг бие даасан байгууллага. Бүх машин,
        жолооч, хэрэглэгч, дохиолол тус бүрд тусгаарлагдсан. Компани бүрд дор хаяж нэг
        <b> COMPANY_ADMIN</b> хэрэглэгч заавал нээгээрэй — тэр өөрийн ажилтнуудыг өөрөө удирдана.
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Нэр</th>
              <th className="text-left px-4 py-2 font-semibold">Товч нэр (slug)</th>
              <th className="text-left px-4 py-2 font-semibold">Холбоо барих</th>
              <th className="text-left px-4 py-2 font-semibold">Цагийн бүс</th>
              <th className="text-left px-4 py-2 font-semibold">Статус</th>
              <th className="text-left px-4 py-2 font-semibold">Үүсгэсэн</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {companies.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Ачаалж байна…</td></tr>
            )}
            {!companies.isLoading && (companies.data ?? []).length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Компани алга</td></tr>
            )}
            {(companies.data ?? []).map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-semibold text-slate-900">{c.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{c.slug}</td>
                <td className="px-4 py-2 text-slate-700">{c.contactEmail ?? '—'}</td>
                <td className="px-4 py-2 text-slate-700">{c.timezone}</td>
                <td className="px-4 py-2">
                  {c.isActive
                    ? <span className="inline-block rounded-full border px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">Идэвхтэй</span>
                    : <span className="inline-block rounded-full border px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600 border-slate-200">Хаалттай</span>}
                </td>
                <td className="px-4 py-2 text-slate-600">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-2 py-2 text-right">
                  <button onClick={() => setEditTarget(c)} className="text-sm text-brand-600 hover:text-brand-700 font-medium">Засах</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <CompanyModal onClose={() => setShowAdd(false)} />}
      {editTarget && <CompanyModal company={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

function CompanyModal({ company, onClose }: { company?: ApiCompany; onClose: () => void }) {
  const isEdit = !!company;
  const [name, setName] = useState(company?.name ?? '');
  const [slug, setSlug] = useState(company?.slug ?? '');
  const [contactEmail, setContactEmail] = useState(company?.contactEmail ?? '');
  const [timezone, setTimezone] = useState(company?.timezone ?? 'Asia/Ulaanbaatar');
  const [isActive, setIsActive] = useState(company?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  // Auto-slug from name during create (until user manually edits slug).
  const onNameChange = (v: string) => {
    setName(v);
    if (!isEdit && (slug === '' || slug === slugify(name))) setSlug(slugify(v));
  };

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = { name: name.trim(), timezone };
      if (contactEmail.trim()) body.contactEmail = contactEmail.trim();
      if (isEdit) {
        body.isActive = isActive;
        return api.patch(`/companies/${company!.id}`, body);
      }
      body.slug = slug.trim();
      return api.post('/companies', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    if (name.trim().length < 2) { setError('Нэр оруулна уу'); return; }
    if (!isEdit && !/^[a-z0-9-]{2,40}$/.test(slug)) {
      setError('Slug нь жижиг үсэг, тоо, зураас (-) л агуулна (жнь: nomin-motor)');
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">{isEdit ? 'Компани засах' : 'Шинэ компани'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <Field label="Нэр *">
            <input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="NOMIN MOTOR" className={input} />
          </Field>

          <Field label="Товч нэр / slug *">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="nomin-motor"
              className={input + (isEdit ? ' bg-slate-100 text-slate-500' : '')}
              disabled={isEdit}
            />
            <p className="text-[11px] text-slate-500 mt-1">URL болон API-д ашиглагдана. Үүсгэсний дараа өөрчилж болохгүй.</p>
          </Field>

          <Field label="Холбоо барих имэйл">
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="info@nomin.mn" className={input} />
          </Field>

          <Field label="Цагийн бүс">
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={input}>
              <option value="Asia/Ulaanbaatar">Asia/Ulaanbaatar (UB)</option>
              <option value="Asia/Hovd">Asia/Hovd</option>
              <option value="Asia/Choibalsan">Asia/Choibalsan</option>
              <option value="UTC">UTC</option>
            </select>
          </Field>

          {isEdit && (
            <Field label="Статус">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span>Идэвхтэй (uncheck хийвэл нэвтрэлт хаагдана)</span>
              </label>
            </Field>
          )}

          {!isEdit && (
            <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2">
              💡 Компани үүссэний дараа <b>"Хэрэглэгчид"</b> хуудсанд орж энэ компанид <b>COMPANY_ADMIN</b> үүсгээрэй.
              Үгүй бол энэ компанид нэвтрэх хэрэглэгч байхгүй.
            </div>
          )}
        </div>

        {error && <div className="mx-6 mb-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}

        <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
          <button onClick={submit} disabled={mutation.isPending} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60">
            {mutation.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
          </button>
        </div>
      </div>
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}

const input =
  'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-70';
