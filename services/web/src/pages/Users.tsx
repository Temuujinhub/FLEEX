import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function Users() {
  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Хэрэглэгчид</h1>
      <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2">Имэйл</th>
              <th className="text-left px-4 py-2">Нэр</th>
              <th className="text-left px-4 py-2">Эрх</th>
              <th className="text-left px-4 py-2">Статус</th>
              <th className="text-left px-4 py-2">Сүүлд нэвтэрсэн</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data ?? []).map((u: any) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium">{u.email}</td>
                <td className="px-4 py-2">{u.fullName ?? '—'}</td>
                <td className="px-4 py-2">{u.role}</td>
                <td className="px-4 py-2">{u.status}</td>
                <td className="px-4 py-2 text-slate-600">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
