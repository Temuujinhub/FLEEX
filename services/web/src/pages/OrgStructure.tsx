import { ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { Groups } from './Groups';
import { Shifts } from './Shifts';

// Байгууллагын бүтэц. One place to manage the three ways a mining fleet is
// organised: physical depots (гранж), departments (алба нэгж), and work shifts
// (ээлж). Previously гранж could only be created from a hidden button on the
// Devices page and had no list/edit/delete UI at all; departments and shifts
// each had their own top-level menu item. Consolidated here as tabs.

type TabId = 'garages' | 'groups' | 'shifts';

export function OrgStructure() {
  const [tab, setTab] = useState<TabId>('garages');
  const tabs: { id: TabId; label: string; hint: string }[] = [
    { id: 'garages', label: 'Гранж',     hint: 'Физик зогсоол / депо' },
    { id: 'groups',  label: 'Алба нэгж', hint: 'Хэлтэс / баг' },
    { id: 'shifts',  label: 'Ээлж',      hint: 'Ажлын цагийн хуваарь' },
  ];

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 pt-5 bg-white border-b border-slate-200">
        <h1 className="text-2xl font-bold">Байгууллагын бүтэц</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Гранж, алба нэгж, ээлжээ нэг дороос удирдана. Машин, жолоочдыг эдгээрээр ангилж тайлагнана.
        </p>
        <nav className="mt-4 flex gap-1 -mb-px">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={
                'px-4 py-2.5 text-sm font-medium border-b-2 transition ' +
                (tab === tb.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800')
              }
            >
              {tb.label}
              <span className="hidden sm:inline text-[11px] text-slate-400 font-normal ml-1.5">· {tb.hint}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 overflow-hidden">
        {tab === 'garages' && <GaragesTab />}
        {/* Groups/Shifts are full pages with their own header + scroll; embed
            them as-is so we don't duplicate their CRUD logic. Their own H1
            acts as the tab's section heading. */}
        {tab === 'groups' && <div className="h-full overflow-auto"><Groups /></div>}
        {tab === 'shifts' && <div className="h-full overflow-auto"><Shifts /></div>}
      </div>
    </div>
  );
}

// ── Garages: the previously-missing management UI ─────────────────
interface Garage {
  id: string;
  name: string;
  address: string | null;
  capacity: number | null;
  notes: string | null;
  _count?: { devices: number };
}

function GaragesTab() {
  const auth = useAuth();
  const canEdit = auth.hasRole('FLEET_MANAGER');
  const canDelete = auth.hasRole('COMPANY_ADMIN');
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<Garage | null>(null);

  const garages = useQuery({
    queryKey: ['garages'],
    queryFn: () => api.get<Garage[]>('/garages').then((r) => r.data),
  });

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          Машин байрладаг физик гараж / депо. Машин бүртгэхдээ гранж сонгож, гранжаар шүүж, тайлагнана.
        </div>
        {canEdit && (
          <button
            onClick={() => setAdd(true)}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow-sm whitespace-nowrap"
          >
            + Шинэ гранж
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Нэр</th>
              <th className="text-left px-4 py-2 font-semibold">Хаяг</th>
              <th className="text-right px-4 py-2 font-semibold">Багтаамж</th>
              <th className="text-right px-4 py-2 font-semibold">Машин</th>
              {canEdit && <th className="w-28"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {garages.isLoading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Ачаалж байна…</td></tr>
            )}
            {!garages.isLoading && (garages.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <div className="text-slate-400 text-sm">Гранж бүртгээгүй байна</div>
                  {canEdit && (
                    <button onClick={() => setAdd(true)} className="mt-2 text-brand-700 hover:underline text-sm font-medium">
                      Эхнийхээ нэмье →
                    </button>
                  )}
                </td>
              </tr>
            )}
            {(garages.data ?? []).map((g) => (
              <tr key={g.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-semibold text-slate-900">{g.name}</td>
                <td className="px-4 py-2 text-slate-600">{g.address ?? '—'}</td>
                <td className="px-4 py-2 text-right text-slate-700 tabular-nums">{g.capacity ?? '—'}</td>
                <td className="px-4 py-2 text-right text-slate-700 tabular-nums">{g._count?.devices ?? 0}</td>
                {canEdit && (
                  <td className="px-2 py-2 text-right">
                    <button onClick={() => setEdit(g)} className="text-sm text-brand-600 hover:text-brand-700 font-medium">Засах</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {add && <GarageModal onClose={() => setAdd(false)} />}
      {edit && <GarageModal garage={edit} canDelete={canDelete} onClose={() => setEdit(null)} />}
    </div>
  );
}

function GarageModal({ garage, canDelete, onClose }: { garage?: Garage; canDelete?: boolean; onClose: () => void }) {
  const isEdit = !!garage;
  const [name, setName] = useState(garage?.name ?? '');
  const [address, setAddress] = useState(garage?.address ?? '');
  const [capacity, setCapacity] = useState(garage?.capacity != null ? String(garage.capacity) : '');
  const [notes, setNotes] = useState(garage?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = { name: name.trim() };
      body.address = address.trim() || null;
      body.notes = notes.trim() || null;
      const n = parseInt(capacity, 10);
      if (!Number.isNaN(n)) body.capacity = n;
      return isEdit ? api.patch(`/garages/${garage!.id}`, body) : api.post('/garages', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['garages'] }); onClose(); },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа гарлаа');
    },
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/garages/${garage!.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['garages'] }); onClose(); },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Устгах үед алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    if (name.trim().length < 2) { setError('Нэрийг 2-оос дээш тэмдэгтээр оруулна уу'); return; }
    save.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">{isEdit ? 'Гранж засах' : 'Шинэ гранж'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <OrgField label="Гранжийн нэр *">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Жишээ: Гол гранж" className={orgInput} />
          </OrgField>
          <OrgField label="Хаяг">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Улаанбаатар, СБД..." className={orgInput} />
          </OrgField>
          <OrgField label="Багтаамж (машины тоо)">
            <input value={capacity} onChange={(e) => setCapacity(e.target.value)} className={orgInput} inputMode="numeric" />
          </OrgField>
          <OrgField label="Тэмдэглэл">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={orgInput + ' resize-none'} />
          </OrgField>
          {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
        </div>
        <div className="border-t border-slate-200 px-6 py-3 flex justify-between gap-2 bg-slate-50">
          <div>
            {isEdit && canDelete && (
              <button
                onClick={() => { if (confirm(`"${garage!.name}"-г устгах уу? Доторх машинууд "гранжгүй" болно.`)) del.mutate(); }}
                disabled={del.isPending}
                className="rounded-md border border-rose-300 bg-white hover:bg-rose-50 text-rose-700 text-sm font-medium px-4 py-2"
              >
                {del.isPending ? 'Устгаж байна…' : 'Устгах'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
            <button onClick={submit} disabled={save.isPending} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60">
              {save.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const orgInput =
  'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

function OrgField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}
