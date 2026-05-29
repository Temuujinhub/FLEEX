import { ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

// Ээлж / Shifts. Тенант тус бүрийн ажлын цагийн тодорхойлолт. Driver
// нэг ээлжид харьяалагдах боломжтой; reports + dispatcher chips нь
// shift.color-ийг ашигладаг. parentShiftId-ээр иерархи (parent
// "Өглөөний ээлж" + brigade child-ууд) дэмждэг — UI v1 нь жагсаалт
// + indent-ээр харуулна.

interface Shift {
  id: string;
  name: string;
  description: string | null;
  startTime: string;
  endTime: string;
  color: string | null;
  parentShiftId: string | null;
  active: boolean;
  _count: { drivers: number; childShifts: number };
}

const input =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

export function Shifts() {
  const auth = useAuth();
  // AuthState exposes hasRole(), not a bare `role` — `auth.role` was always
  // undefined, which left canEdit permanently false and the whole page
  // read-only for every role (including SUPER_ADMIN).
  const canEdit = auth.hasRole('FLEET_MANAGER');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);

  const shifts = useQuery<Shift[]>({
    queryKey: ['shifts'],
    queryFn: () => api.get('/shifts').then((r) => r.data),
  });

  const items = shifts.data ?? [];
  // Roots = no parent or parent not in the visible set. Show them first
  // with their children indented underneath.
  const roots = items.filter((s) => !s.parentShiftId);
  const childrenOf = (parentId: string) => items.filter((s) => s.parentShiftId === parentId);

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Ээлж</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Жолооч тус бүрийг ажлын цагийн хуваариагаар хуваан, тайлан болон Dispatcher-д өнгөөр ялгана.
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow"
            >
              + Шинэ ээлж
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {shifts.isLoading ? (
          <div className="text-sm text-slate-400">Уншиж байна…</div>
        ) : items.length === 0 ? (
          <EmptyState onAdd={canEdit ? () => setShowAdd(true) : undefined} />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Нэр</th>
                  <th className="px-4 py-3 text-left">Цагийн хүрээ</th>
                  <th className="px-4 py-3 text-left">Тайлбар</th>
                  <th className="px-4 py-3 text-right">Жолооч</th>
                  <th className="px-4 py-3 text-right">Төлөв</th>
                  <th className="px-4 py-3 text-right">Үйлдэл</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roots.flatMap((root) => [
                  <ShiftRow key={root.id} shift={root} depth={0} canEdit={canEdit} onEdit={() => setEditing(root)} />,
                  ...childrenOf(root.id).map((c) => (
                    <ShiftRow key={c.id} shift={c} depth={1} canEdit={canEdit} onEdit={() => setEditing(c)} />
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <ShiftModal
          shift={null}
          allShifts={items}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editing && (
        <ShiftModal
          shift={editing}
          allShifts={items}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ShiftRow({
  shift, depth, canEdit, onEdit,
}: { shift: Shift; depth: number; canEdit: boolean; onEdit: () => void }) {
  const wrapsMidnight = shift.startTime > shift.endTime;
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
          <span
            className="inline-block h-3 w-3 rounded-full border border-slate-300"
            style={{ background: shift.color || '#cbd5e1' }}
          />
          <span className="font-medium text-slate-900">{shift.name}</span>
          {!shift.active && <span className="text-[10px] uppercase text-slate-400">Идэвхгүй</span>}
        </div>
      </td>
      <td className="px-4 py-3 tabular-nums text-slate-700">
        {shift.startTime} → {shift.endTime}
        {wrapsMidnight && <span className="ml-2 text-[10px] text-amber-700">(шөнө дамждаг)</span>}
      </td>
      <td className="px-4 py-3 text-slate-500">{shift.description ?? '—'}</td>
      <td className="px-4 py-3 text-right tabular-nums">{shift._count.drivers}</td>
      <td className="px-4 py-3 text-right">
        <span className={clsx(
          'inline-block px-2 py-0.5 rounded text-[10px] font-semibold',
          shift.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500',
        )}>
          {shift.active ? 'Идэвхтэй' : 'Идэвхгүй'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        {canEdit ? (
          <button
            onClick={onEdit}
            className="rounded-md border border-slate-200 bg-white hover:bg-slate-50 hover:border-brand-300 text-slate-700 text-xs font-medium px-2.5 py-1.5 transition"
          >
            Засах
          </button>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

function ShiftModal({
  shift, allShifts, onClose,
}: { shift: Shift | null; allShifts: Shift[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(shift?.name ?? '');
  const [description, setDescription] = useState(shift?.description ?? '');
  const [startTime, setStartTime] = useState(shift?.startTime ?? '06:00');
  const [endTime, setEndTime] = useState(shift?.endTime ?? '14:00');
  const [color, setColor] = useState(shift?.color ?? '#3b82f6');
  const [parentShiftId, setParentShiftId] = useState<string>(shift?.parentShiftId ?? '');
  const [active, setActive] = useState(shift?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (payload: any) =>
      shift
        ? api.patch(`/shifts/${shift.id}`, payload)
        : api.post('/shifts', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      onClose();
    },
    onError: (e: any) => setError(e?.response?.data?.message?.toString?.() ?? 'Хадгалах үед алдаа'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/shifts/${shift!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      onClose();
    },
    onError: (e: any) => setError(e?.response?.data?.message?.toString?.() ?? 'Устгахад алдаа'),
  });

  const parentChoices = allShifts.filter((s) => s.id !== shift?.id && !s.parentShiftId);

  return (
    <Modal title={shift ? 'Ээлж засах' : 'Шинэ ээлж'} onClose={onClose}>
      <div className="space-y-3 p-5">
        <Field label="Нэр *">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Жнь: Өглөөний ээлж" className={input} />
        </Field>
        <Field label="Тайлбар">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={clsx(input, 'h-16 resize-none')} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Эхлэх *">
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={input} />
          </Field>
          <Field label="Дуусах *">
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={input} />
          </Field>
          <Field label="Өнгө">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-full rounded border border-slate-200" />
          </Field>
        </div>
        {startTime > endTime && (
          <div className="text-[11px] text-amber-700">
            ⓘ Эхлэх цаг нь дуусах цагаас их байна — энэ ээлж шөнө дунд дамждаг гэж тооцно ({startTime} → {endTime}).
          </div>
        )}

        <Field label="Эх ээлж (заавал биш)">
          <select value={parentShiftId} onChange={(e) => setParentShiftId(e.target.value)} className={input}>
            <option value="">— Үндсэн (root) ээлж —</option>
            {parentChoices.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-slate-500">
            Жнь: "Өглөөний ээлж" дотор "Бригад 1", "Бригад 2" гэсэн child ээлж байж болно.
          </div>
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Идэвхтэй
        </label>

        {error && <div className="text-xs text-rose-700">{error}</div>}

        <div className="flex justify-between gap-2 pt-2">
          {shift ? (
            <button
              onClick={() => {
                if (confirm('Энэ ээлжийг устгах уу? Жолооч нар дахин ээлжгүй болно.')) remove.mutate();
              }}
              className="rounded-md border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-sm font-medium px-3 py-2"
            >
              Устгах
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">
              Цуцлах
            </button>
            <button
              onClick={() => {
                if (name.trim().length < 2) return setError('Нэрийг 2+ тэмдэгт оруулна уу');
                save.mutate({
                  name: name.trim(),
                  description: description.trim() || undefined,
                  startTime,
                  endTime,
                  color: color || undefined,
                  parentShiftId: parentShiftId || undefined,
                  active,
                });
              }}
              disabled={save.isPending}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-50"
            >
              {save.isPending ? 'Хадгалж…' : 'Хадгалах'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center">
      <div className="text-base font-semibold text-slate-700">Бүртгэгдсэн ээлж алга.</div>
      <p className="mt-1 text-sm text-slate-500">
        Шинэ ээлж үүсгээд жолооч нараа хуваариагаар нь ялгаарай. Жнь: "Өглөө 06:00-14:00" + "Шөнө 22:00-06:00".
      </p>
      {onAdd && (
        <button
          onClick={onAdd}
          className="mt-4 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2"
        >
          + Эхний ээлж нэмэх
        </button>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">{label}</label>
      {children}
    </div>
  );
}
