import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../store/auth';
import { clearTokens } from '../lib/api';

const NAV = [
  { to: '/app', label: 'Хяналтын самбар', min: 'VIEWER' as const },
  { to: '/app/map', label: 'Шууд газрын зураг', min: 'VIEWER' as const },
  { to: '/app/devices', label: 'Төхөөрөмжүүд', min: 'VIEWER' as const },
  { to: '/app/history', label: 'Түүх', min: 'VIEWER' as const },
  { to: '/app/events', label: 'Дохиоллууд', min: 'VIEWER' as const },
  { to: '/app/geofences', label: 'Geofence', min: 'FLEET_MANAGER' as const },
  { to: '/app/reports', label: 'Тайлан', min: 'VIEWER' as const },
  { to: '/app/users', label: 'Хэрэглэгчид', min: 'COMPANY_ADMIN' as const },
  { to: '/app/audit', label: 'Аудит лог', min: 'COMPANY_ADMIN' as const },
];

export function AppShell() {
  const { user, hasRole, setUser } = useAuth();
  const navigate = useNavigate();

  const logout = () => {
    clearTokens();
    setUser(null);
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-100">
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-slate-900 text-slate-100">
        <div className="px-6 py-5 border-b border-slate-800">
          <div className="text-2xl font-extrabold tracking-tight text-white">Fleex</div>
          <div className="text-xs text-slate-400 mt-1">Enterprise GPS tracking</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
          {NAV.filter((n) => hasRole(n.min)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/app'}
              className={({ isActive }) =>
                clsx(
                  'block rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-4 py-3">
          <div className="text-sm font-medium text-white truncate">{user?.fullName || user?.email}</div>
          <div className="text-xs text-slate-400">{user?.role}</div>
          <button onClick={logout} className="mt-3 w-full rounded-md bg-slate-800 text-sm py-1.5 hover:bg-slate-700">
            Гарах
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
