import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function Audit() {
  const { data } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get('/audit?limit=100').then((r) => r.data),
  });
  const verify = useQuery({
    queryKey: ['audit', 'verify'],
    queryFn: () => api.get('/audit/verify').then((r) => r.data),
    enabled: false,
  });
  return (
    <div className="p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Аудит лог</h1>
          <p className="text-sm text-slate-500 mt-1">Хэрэглэгчийн бүх үйлдлийн tamper-evident бүртгэл.</p>
        </div>
        <button onClick={() => verify.refetch()} className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm">Гинжийг шалгах</button>
      </div>
      {verify.data && (
        <div className={`mt-3 rounded-md px-3 py-2 text-sm ${verify.data.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {verify.data.ok ? 'Гинж бүрэн бүтэн.' : `Гэмтэлтэй id: ${verify.data.brokenAtId}`}
        </div>
      )}
      <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2">Цаг</th>
              <th className="text-left px-4 py-2">Үйлдэгч</th>
              <th className="text-left px-4 py-2">Үйлдэл</th>
              <th className="text-left px-4 py-2">Нөөц</th>
              <th className="text-left px-4 py-2">Үр дүн</th>
              <th className="text-left px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.items ?? []).map((a: any) => (
              <tr key={a.id}>
                <td className="px-4 py-2 whitespace-nowrap">{new Date(a.occurredAt).toLocaleString()}</td>
                <td className="px-4 py-2">{a.actorEmail ?? '—'}</td>
                <td className="px-4 py-2 font-medium">{a.action}</td>
                <td className="px-4 py-2 text-slate-600">{a.resourceType ?? '—'}{a.resourceId ? `:${a.resourceId.slice(0, 8)}…` : ''}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                    a.outcome === 'success' ? 'bg-emerald-100 text-emerald-800' :
                    a.outcome === 'denied' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                  }`}>{a.outcome}</span>
                </td>
                <td className="px-4 py-2 text-slate-500">{a.ipAddress ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
