import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function Devices() {
  const { data, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
  });
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Төхөөрөмжүүд</h1>
      <div className="mt-6 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2">Нэр</th>
              <th className="text-left px-4 py-2">IMEI</th>
              <th className="text-left px-4 py-2">Дугаар</th>
              <th className="text-left px-4 py-2">Статус</th>
              <th className="text-left px-4 py-2">Сүүлд</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={5}>Уншиж байна…</td></tr>
            )}
            {(data ?? []).map((d: any) => (
              <tr key={d.id}>
                <td className="px-4 py-3 font-medium">{d.name}</td>
                <td className="px-4 py-3 text-slate-600">{d.imei}</td>
                <td className="px-4 py-3 text-slate-600">{d.plateNumber ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block h-2 w-2 rounded-full mr-2 ${d.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  {d.online ? 'Онлайн' : 'Офлайн'}
                </td>
                <td className="px-4 py-3 text-slate-600">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
