import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function Dashboard() {
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
  });
  const events = useQuery({
    queryKey: ['events', 'recent'],
    queryFn: () => api.get('/events?limit=10&ack=false').then((r) => r.data.items),
  });

  const list = devices.data ?? [];
  const online = list.filter((d: any) => d.online).length;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Хяналтын самбар</h1>
        <p className="text-slate-500 text-sm mt-1">Системийн ерөнхий байдал</p>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat title="Нийт төхөөрөмж" value={list.length} />
        <Stat title="Онлайн" value={online} accent="text-emerald-600" />
        <Stat title="Офлайн" value={list.length - online} accent="text-slate-500" />
        <Stat
          title="Шинэ дохиолол"
          value={events.data?.length ?? 0}
          accent={(events.data?.length ?? 0) > 0 ? 'text-rose-600' : 'text-slate-500'}
        />
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <header className="px-5 py-3 border-b border-slate-200 font-semibold">Сүүлийн дохиоллууд</header>
        <ul className="divide-y divide-slate-100">
          {(events.data ?? []).map((e: any) => (
            <li key={e.id} className="px-5 py-3 flex items-center justify-between text-sm">
              <span>
                <span className="font-medium">{e.type}</span>{' '}
                <span className="text-slate-400">— {new Date(e.occurredAt).toLocaleString()}</span>
              </span>
              <span className="text-xs uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                {e.severity}
              </span>
            </li>
          ))}
          {(events.data ?? []).length === 0 && (
            <li className="px-5 py-6 text-sm text-slate-400 text-center">Шинэ дохиолол алга</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Stat({ title, value, accent }: { title: string; value: number | string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
      <div className="text-sm text-slate-500">{title}</div>
      <div className={`mt-2 text-3xl font-extrabold ${accent ?? 'text-slate-900'}`}>{value}</div>
    </div>
  );
}
