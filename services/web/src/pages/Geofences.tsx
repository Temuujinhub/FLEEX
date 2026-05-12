import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function Geofences() {
  const { data } = useQuery({
    queryKey: ['geofences'],
    queryFn: () => api.get('/geofences').then((r) => r.data),
  });
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Geofence</h1>
      <p className="text-sm text-slate-500 mt-1">Газарзүйн хашаа болон тэдгээрийн дохиолол.</p>
      <ul className="mt-6 space-y-2">
        {(data ?? []).map((g: any) => (
          <li key={g.id} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="font-medium">{g.name}</div>
            <div className="text-xs text-slate-500">{g.shape} {g.active ? '· active' : '· disabled'}</div>
          </li>
        ))}
        {(data ?? []).length === 0 && (
          <li className="text-sm text-slate-400">Geofence үүсгээгүй байна.</li>
        )}
      </ul>
    </div>
  );
}
