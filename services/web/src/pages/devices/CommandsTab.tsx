// "Commands" tab — sends operator commands to the device via Codec 12
// and shows the recent command history. The list polls every 5 s so the
// status moves PENDING → SENT → DELIVERED without manual refresh.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Field, input, EmptyState, formatRelative } from './shared';

const COMMAND_PRESETS = [
  { type: 'engine_block',  label: '🚫 Хөдөлгүүр блоклох',  hint: 'Reley-р хөдөлгүүр блоклоно. Хариуцлагатай хэрэглээрэй.' },
  { type: 'engine_unblock',label: '✅ Хөдөлгүүр сэргээх',  hint: 'Reley-н блок арилгана.' },
  { type: 'request_info',  label: 'ℹ Мэдээлэл хүсэх',     hint: 'GPS-ээс getinfo команд илгээнэ.' },
  { type: 'request_status',label: '📡 Статус шалгах',     hint: 'GPS-н сүлжээ, GSM, GPS статусыг буцаана.' },
  { type: 'reset',         label: '🔄 GPS reboot',        hint: 'Төхөөрөмжийг дахин асаана.' },
];

const STATUS_STYLE: Record<string, string> = {
  PENDING:   'bg-amber-100 text-amber-800',
  SENT:      'bg-sky-100 text-sky-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  FAILED:    'bg-rose-100 text-rose-800',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:   'Хүлээгдэж буй',
  SENT:      'Илгээгдсэн',
  DELIVERED: 'Хүлээн авсан',
  FAILED:    'Алдаа',
};

export function CommandsTab({ deviceId, deviceOnline }: { deviceId: string; deviceOnline?: boolean }) {
  const qc = useQueryClient();
  const auth = useAuth();
  const history = useQuery({
    queryKey: ['commands', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}/commands?limit=50`).then((r) => r.data),
    refetchInterval: 5_000,
  });
  const [custom, setCustom] = useState('');
  const [confirmType, setConfirmType] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (payload: { type: string; payload?: any }) =>
      api.post(`/devices/${deviceId}/commands`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commands', deviceId] });
      setConfirmType(null);
      setCustom('');
    },
  });

  const cancel = useMutation({
    mutationFn: (commandId: string) =>
      api.delete(`/devices/${deviceId}/commands/${commandId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commands', deviceId] }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-slate-900">Команд илгээх</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          GPS төхөөрөмж онлайн байх үед команд хадгалагдаж байгаад дараагийн холболтод дамжуулагдана.
          {deviceOnline === false && (
            <span className="ml-1 text-amber-700">Энэ машин одоогоор офлайн байна — команд дараа дамжина.</span>
          )}
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
        {COMMAND_PRESETS.map((c) => (
          <button
            key={c.type}
            onClick={() => setConfirmType(c.type)}
            className="rounded-lg border border-slate-200 hover:border-brand-400 bg-white p-3 text-left transition"
          >
            <div className="font-semibold text-sm">{c.label}</div>
            <div className="text-[11px] text-slate-500 mt-1 leading-tight">{c.hint}</div>
          </button>
        ))}
      </div>

      {/* Raw Codec-12 commands are powerful (reconfigure/brick a device), so
          the box is SUPER_ADMIN-only; the server enforces this too. */}
      {auth.hasRole('SUPER_ADMIN') && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-widest">Захиалгат команд (Codec 12)</div>
          <div className="flex gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder='Жнь: setdigout 1?? 1 0 0   эсвэл   getinfo'
              className={clsx(input, 'font-mono')}
            />
            <button
              onClick={() => custom.trim() && send.mutate({ type: 'custom', payload: { text: custom.trim() } })}
              disabled={!custom.trim() || send.isPending}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 disabled:opacity-50"
            >
              Илгээх
            </button>
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Сүүлийн командууд</div>
        {history.isLoading && <div className="text-slate-400 text-sm">Уншиж байна…</div>}
        {!history.isLoading && (history.data ?? []).length === 0 && (
          <EmptyState title="Команд илгээгээгүй байна" />
        )}
        {(history.data ?? []).length > 0 && (
          <div className="rounded-lg border border-slate-200 overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Төрөл</th>
                  <th className="text-left px-3 py-2 font-semibold">Статус</th>
                  <th className="text-left px-3 py-2 font-semibold">Илгээсэн</th>
                  <th className="text-left px-3 py-2 font-semibold">Үр дүн</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(history.data ?? []).map((c: any) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{c.type}</td>
                    <td className="px-3 py-2">
                      <span className={clsx('inline-flex text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-0.5', STATUS_STYLE[c.status])}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{formatRelative(c.sentAt ?? c.createdAt)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{c.result ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {c.status === 'PENDING' && (
                        <button
                          type="button"
                          title="Цуцлах"
                          onClick={() => cancel.mutate(c.id)}
                          disabled={cancel.isPending}
                          className="text-rose-700 hover:text-rose-900 hover:bg-rose-50 rounded p-1 disabled:opacity-40"
                          aria-label="Цуцлах"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation dialog for preset commands */}
      {confirmType && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-3">
            <div className="font-bold text-slate-900">
              {COMMAND_PRESETS.find((c) => c.type === confirmType)?.label ?? 'Команд илгээх'}
            </div>
            <p className="text-sm text-slate-700">
              Энэ команд GPS төхөөрөмж рүү дамжих болно. Үргэлжлүүлэх үү?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmType(null)} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-3 py-2">Цуцлах</button>
              <button
                onClick={() => send.mutate({ type: confirmType })}
                disabled={send.isPending}
                className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"
              >
                {send.isPending ? 'Илгээж байна…' : 'Илгээх'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
