import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function Events() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/events?limit=100').then((r) => r.data.items),
  });
  const ack = async (id: string) => {
    await api.patch(`/events/${id}/ack`, {});
    qc.invalidateQueries({ queryKey: ['events'] });
  };
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Дохиоллууд</h1>
      <div className="mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2">Цаг</th>
              <th className="text-left px-4 py-2">Төрөл</th>
              <th className="text-left px-4 py-2">Хүндрэл</th>
              <th className="text-left px-4 py-2">Төхөөрөмж</th>
              <th className="text-left px-4 py-2">Үйлдэл</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data ?? []).map((e: any) => (
              <tr key={e.id} className={e.acknowledged ? 'opacity-60' : ''}>
                <td className="px-4 py-2">{new Date(e.occurredAt).toLocaleString()}</td>
                <td className="px-4 py-2 font-medium">{e.type}</td>
                <td className="px-4 py-2">{e.severity}</td>
                <td className="px-4 py-2 text-slate-600">{e.deviceId.slice(0, 8)}…</td>
                <td className="px-4 py-2">
                  {!e.acknowledged && (
                    <button onClick={() => ack(e.id)} className="text-brand-700 hover:underline">Баталгаажуулах</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
