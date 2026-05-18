import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ReactNode } from 'react';
import { useAuth } from '../store/auth';
import { clearTokens } from '../lib/api';

// Sidebar nav. Grouped by purpose so the eye can scan it like Gaikham /
// Navixy, but tailored for a mining ops vocabulary (флот, аналитик, админ).
const SECTIONS: {
  title: string;
  items: { to: string; label: string; min: AuthRole; icon: ReactNode }[];
}[] = [
  {
    title: 'Үйл ажиллагаа',
    items: [
      { to: '/app',           label: 'Хяналтын самбар', min: 'VIEWER',        icon: <IconDashboard /> },
      { to: '/app/map',       label: 'Шууд газрын зураг', min: 'VIEWER',      icon: <IconMap /> },
      { to: '/app/devices',   label: 'Машин · Төхөөрөмж', min: 'VIEWER',      icon: <IconTruck /> },
      { to: '/app/drivers',   label: 'Жолооч · Ажилчид', min: 'VIEWER',       icon: <IconDriver /> },
      { to: '/app/groups',    label: 'Алба нэгж', min: 'FLEET_MANAGER',       icon: <IconLayers /> },
      { to: '/app/service-tasks', label: 'Засвар үйлчилгээ', min: 'VIEWER',   icon: <IconWrench /> },
      { to: '/app/history',   label: 'Маршрут · Түүх', min: 'VIEWER',         icon: <IconRoute /> },
    ],
  },
  {
    title: 'Аналитик',
    items: [
      { to: '/app/events',             label: 'Дохиоллууд',          min: 'VIEWER',         icon: <IconBell /> },
      { to: '/app/notification-rules', label: 'Дохиоллын дүрэм',     min: 'FLEET_MANAGER',  icon: <IconBell /> },
      { to: '/app/health-rules',       label: 'Эрүүл мэндийн дүрэм', min: 'FLEET_MANAGER',  icon: <IconShield /> },
      { to: '/app/eco-driving',        label: 'Эко жолоодлого',      min: 'VIEWER',         icon: <IconEco /> },
      { to: '/app/places',             label: 'Байршил · Цэгүүд',    min: 'VIEWER',         icon: <IconPin /> },
      { to: '/app/geofences',          label: 'Geofence бүс',        min: 'FLEET_MANAGER',  icon: <IconShield /> },
      { to: '/app/reports',            label: 'Тайлан',              min: 'VIEWER',         icon: <IconChart /> },
    ],
  },
  {
    title: 'Удирдлага',
    items: [
      { to: '/app/users',     label: 'Хэрэглэгчид', min: 'COMPANY_ADMIN',     icon: <IconUsers /> },
      { to: '/app/companies', label: 'Компаниуд',   min: 'SUPER_ADMIN',       icon: <IconBuilding /> },
      { to: '/app/landing-settings', label: 'Сайтын тохиргоо', min: 'SUPER_ADMIN', icon: <IconCog /> },
      { to: '/app/audit',     label: 'Аудит лог', min: 'COMPANY_ADMIN',       icon: <IconAudit /> },
    ],
  },
];

type AuthRole = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'FLEET_MANAGER' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';

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
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 border-r border-slate-800/60">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-slate-800/60 flex items-center gap-3">
          <BrandMark />
          <div className="min-w-0">
            <div className="text-xl font-extrabold tracking-tight text-white truncate">Fleex</div>
            <div className="text-[10px] uppercase tracking-widest text-brand-300/80 -mt-0.5 truncate">
              Mining Fleet Ops
            </div>
          </div>
        </div>

        {/* Sections */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {SECTIONS.map((sec) => {
            const visible = sec.items.filter((i) => hasRole(i.min));
            if (visible.length === 0) return null;
            return (
              <div key={sec.title}>
                <div className="px-3 mb-1.5 text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                  {sec.title}
                </div>
                <div className="space-y-0.5">
                  {visible.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.to === '/app'}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition group',
                          isActive
                            ? 'bg-brand-600/90 text-white shadow-md shadow-brand-900/40'
                            : 'text-slate-300 hover:bg-slate-800/70 hover:text-white',
                        )
                      }
                    >
                      <span className="h-4 w-4 shrink-0 opacity-90 group-hover:opacity-100">{n.icon}</span>
                      <span className="truncate">{n.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User card */}
        <div className="border-t border-slate-800/60 p-3">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800/80 px-3 py-2.5">
            <NavLink
              to="/app/profile"
              className="flex items-center gap-3 group"
              title="Миний бүртгэл"
            >
              <div className="h-9 w-9 rounded-full bg-brand-600/80 group-hover:bg-brand-500 flex items-center justify-center text-sm font-bold uppercase shadow transition">
                {initials(user?.fullName || user?.email || '?')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate group-hover:text-brand-200 transition">
                  {user?.fullName || user?.email}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-brand-300/80">
                  {roleLabel(user?.role)}
                </div>
              </div>
            </NavLink>
            <button
              onClick={logout}
              className="mt-2 w-full rounded-md bg-slate-800 hover:bg-slate-700 text-sm py-1.5 transition flex items-center justify-center gap-2"
            >
              <IconLogout /> Гарах
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function initials(s: string) {
  const parts = s.replace(/@.*/, '').split(/[ ._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}

function roleLabel(r?: string) {
  const m: Record<string, string> = {
    SUPER_ADMIN: 'Гол админ',
    COMPANY_ADMIN: 'Компанийн админ',
    FLEET_MANAGER: 'Флот менежер',
    DISPATCHER: 'Диспетчер',
    DRIVER: 'Жолооч',
    VIEWER: 'Үзэгч',
  };
  return r ? (m[r] ?? r) : '';
}

// ── Brand mark ─────────────────────────────────────────────
function BrandMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden className="text-brand-400 shrink-0">
      <circle cx="16" cy="16" r="15" fill="currentColor" opacity="0.18" />
      <path
        d="M8 22l4-7 4 3 8-12"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="24" cy="6" r="2.2" fill="currentColor" />
    </svg>
  );
}

// ── Inline SVG icons (no external lib) ─────────────────────
function IconBase(props: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-full w-full"
    >
      {props.children}
    </svg>
  );
}
function IconDashboard() {
  return (
    <IconBase>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </IconBase>
  );
}
function IconMap() {
  return (
    <IconBase>
      <path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14M15 6v14" />
    </IconBase>
  );
}
function IconTruck() {
  // Heavy haul truck-ish silhouette.
  return (
    <IconBase>
      <path d="M2 17h11V7H2z" />
      <path d="M13 11h5l3 3v3h-8" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="17" cy="19" r="2" />
    </IconBase>
  );
}
function IconRoute() {
  return (
    <IconBase>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v4a3 3 0 003 3h6a3 3 0 013 3" />
    </IconBase>
  );
}
function IconBell() {
  return (
    <IconBase>
      <path d="M18 16V10a6 6 0 10-12 0v6l-2 2h16z" />
      <path d="M10 20a2 2 0 004 0" />
    </IconBase>
  );
}
function IconShield() {
  return (
    <IconBase>
      <path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  );
}
function IconChart() {
  return (
    <IconBase>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </IconBase>
  );
}
function IconWrench() {
  return (
    <IconBase>
      <path d="M14 7a4 4 0 11-2 7l-7 7-2-2 7-7a4 4 0 014-5z" />
    </IconBase>
  );
}
function IconEco() {
  return (
    <IconBase>
      <path d="M4 14a8 8 0 1116 0" />
      <path d="M12 14l4-3" />
      <circle cx="12" cy="14" r="1.2" fill="currentColor" />
    </IconBase>
  );
}
function IconPin() {
  return (
    <IconBase>
      <path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </IconBase>
  );
}
function IconDriver() {
  return (
    <IconBase>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20a7 7 0 0114 0" />
      <path d="M9 5l3-2 3 2" />
    </IconBase>
  );
}
function IconUsers() {
  return (
    <IconBase>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0" />
      <circle cx="17" cy="9" r="2.8" />
      <path d="M15 20a5 5 0 016.5-4.7" />
    </IconBase>
  );
}
function IconCog() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 00-.2-1.6l2-1.5-2-3.4-2.3.9a7 7 0 00-2.8-1.6L13 2h-2l-.7 2.8a7 7 0 00-2.8 1.6L5.2 5.5l-2 3.4 2 1.5a7 7 0 000 3.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002.8 1.6L11 22h2l.7-2.8a7 7 0 002.8-1.6l2.3.9 2-3.4-2-1.5c.13-.52.2-1.06.2-1.6z" />
    </IconBase>
  );
}
function IconBuilding() {
  return (
    <IconBase>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" />
    </IconBase>
  );
}
function IconLayers() {
  return (
    <IconBase>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5M3 18l9 5 9-5" />
    </IconBase>
  );
}
function IconAudit() {
  return (
    <IconBase>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </IconBase>
  );
}
function IconLogout() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
