import { ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

type Group = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  createdAt: string;
  _count?: { devices: number; drivers: number };
};

export function Groups() {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Group | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);

  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get<Group[]>('/groups').then((r) => r.data),
  });

  const parentName = (id: string | null) => {
    if (!id) return '—';
    return groups.data?.find((g) => g.id === id)?.name ?? id.slice(0, 6);
  };

  return (
    <div className="p-6 md:p-8 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Алба нэгж</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Машин, жолоочдыг хуваарилах хэлтэс / алба нэгжийн бүртгэл.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow-sm"
        >
          + Алба нэгж нэмэх
        </button>
      </header>

      <div className="bg-gradient-to-br from-brand-50 to-white border border-brand-200 rounded-xl p-4 text-sm text-slate-700">
        <b>Алба нэгж гэж юу вэ?</b> Компанийн доторх хэлтэс / баг. Машин болон жолоочдыг
        алба нэгжээр ангилан тайлан гаргах, эрх хязгаарлах боломжтой. Жишээ: "Зам барилгын алба",
        "Ачаа тээвэр", "Уулын экскаваторын алба".
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Нэр</th>
              <th className="text-left px-4 py-2 font-semibold">Тайлбар</th>
              <th className="text-left px-4 py-2 font-semibold">Эх алба</th>
              <th className="text-right px-4 py-2 font-semibold">Машин</th>
              <th className="text-right px-4 py-2 font-semibold">Жолооч</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Ачаалж байна…</td></tr>
            )}
            {!groups.isLoading && (groups.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <div className="text-slate-400 text-sm">Алба нэгж бүртгээгүй байна</div>
                  <button onClick={() => setShowAdd(true)} className="mt-2 text-brand-700 hover:underline text-sm font-medium">
                    Эхнийхээ нэмье →
                  </button>
                </td>
              </tr>
            )}
            {(groups.data ?? []).map((g) => (
              <tr key={g.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-semibold text-slate-900">{g.name}</td>
                <td className="px-4 py-2 text-slate-600">{g.description ?? '—'}</td>
                <td className="px-4 py-2 text-slate-600">{parentName(g.parentId)}</td>
                <td className="px-4 py-2 text-right text-slate-700 tabular-nums">{g._count?.devices ?? 0}</td>
                <td className="px-4 py-2 text-right text-slate-700 tabular-nums">{g._count?.drivers ?? 0}</td>
                <td className="px-2 py-2 text-right space-x-2">
                  <button onClick={() => setEditTarget(g)} className="text-sm text-brand-600 hover:text-brand-700 font-medium">Засах</button>
                  <button onClick={() => setDeleteTarget(g)} className="text-sm text-rose-600 hover:text-rose-700 font-medium">Устгах</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <GroupModal groups={groups.data ?? []} onClose={() => setShowAdd(false)} />}
      {editTarget && <GroupModal group={editTarget} groups={groups.data ?? []} onClose={() => setEditTarget(null)} />}
      {deleteTarget && <DeleteGroupModal group={deleteTarget} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}

function GroupModal({ group, groups, onClose }: { group?: Group; groups: Group[]; onClose: () => void }) {
  const isEdit = !!group;
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [parentId, setParentId] = useState(group?.parentId ?? '');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = { name: name.trim() };
      if (description.trim()) body.description = description.trim();
      if (parentId) body.parentId = parentId;
      return isEdit
        ? api.patch(`/groups/${group!.id}`, body)
        : api.post('/groups', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    if (name.trim().length < 2) { setError('Нэр (2+ тэмдэгт) оруулна уу'); return; }
    mutation.mutate();
  };

  const parentOptions = groups.filter((g) => !isEdit || g.id !== group!.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">{isEdit ? 'Алба нэгж засах' : 'Шинэ алба нэгж'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <Field label="Нэр *" hint="Жнь: 'Зам барилгын алба', 'Уулын экскаватор'">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Зам барилгын алба" className={input} />
          </Field>
          <Field label="Тайлбар">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Тайлбар (заавал биш)" className={input} />
          </Field>
          <Field label="Эх алба нэгж" hint="Хэрэв энэ нь дэд алба бол эх албыг сонгоно (модлог бүтэц).">
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={input}>
              <option value="">— Үндсэн (хамгийн дээд) —</option>
              {parentOptions.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </Field>
          {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
        </div>
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

function DeleteGroupModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.delete(`/groups/${group.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['groups'] }); onClose(); },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Устгах үед алдаа');
    },
  });
  const hasMembers = (group._count?.devices ?? 0) + (group._count?.drivers ?? 0) > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">Алба нэгж устгах</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        <div className="p-6 space-y-3">
          <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
            <b>{group.name}</b>-г устгах гэж байна.
          </div>
          {hasMembers && (
            <p className="text-sm text-amber-700">
              ⚠ Энэ алба нэгжид {group._count?.devices ?? 0} машин, {group._count?.drivers ?? 0} жолооч бүртгэлтэй.
              Устгасны дараа тэдгээр нь "алба нэгжгүй" болно (өгөгдөл нь хадгалагдана).
            </p>
          )}
          {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
        </div>
        <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60">
            {mutation.isPending ? 'Устгаж байна…' : 'Устгах'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

const input =
  'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';
