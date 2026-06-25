import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ReactNode, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import { clearTokens } from '../lib/api';
import { Smartphone } from './icons';

// Sidebar nav. Grouped by purpose so the eye can scan it like Gaikham /
// Navixy, but tailored for a mining ops vocabulary. Labels/titles are i18n
// keys resolved at render time (see src/i18n).
const SECTIONS: {
  titleKey: string;
  items: { to: string; labelKey: string; min: AuthRole; icon: ReactNode }[];
}[] = [
  {
    // Day-to-day monitoring — what an operator opens every shift.
    titleKey: 'section.monitor',
    items: [
      { to: '/app',           labelKey: 'nav.dashboard',     min: 'VIEWER',        icon: <IconDashboard /> },
      { to: '/app/map',       labelKey: 'nav.liveMap',       min: 'VIEWER',        icon: <IconMap /> },
      { to: '/app/dispatch',  labelKey: 'nav.dispatch',      min: 'DISPATCHER',    icon: <IconLayers /> },
      { to: '/app/events',    labelKey: 'nav.events',        min: 'VIEWER',        icon: <IconBell /> },
      { to: '/app/camera',    labelKey: 'nav.camera',        min: 'VIEWER',        icon: <IconCamera /> },
      { to: '/m',             labelKey: 'nav.mobile',        min: 'VIEWER',        icon: <Smartphone /> },
    ],
  },
  {
    // The fleet itself: vehicles, people, upkeep, movement.
    titleKey: 'section.fleet',
    items: [
      { to: '/app/devices',       labelKey: 'nav.devices',      min: 'VIEWER', icon: <IconTruck /> },
      { to: '/app/drivers',       labelKey: 'nav.drivers',      min: 'VIEWER', icon: <IconDriver /> },
      { to: '/app/service-tasks', labelKey: 'nav.serviceTasks', min: 'VIEWER', icon: <IconWrench /> },
      { to: '/app/history',       labelKey: 'nav.history',      min: 'VIEWER', icon: <IconRoute /> },
      { to: '/app/eco-driving',   labelKey: 'nav.ecoDriving',   min: 'VIEWER', icon: <IconEco /> },
    ],
  },
  {
    // Reporting + the spatial layer (places & geofences live together).
    titleKey: 'section.analytics',
    items: [
      { to: '/app/reports',   labelKey: 'nav.reports',   min: 'VIEWER',        icon: <IconChart /> },
      { to: '/app/proximity', labelKey: 'nav.proximity', min: 'VIEWER',        icon: <IconRadius /> },
      { to: '/app/geofences', labelKey: 'nav.geofences', min: 'FLEET_MANAGER', icon: <IconShield /> },
      { to: '/app/places',    labelKey: 'nav.places',    min: 'VIEWER',        icon: <IconPin /> },
    ],
  },
  {
    // Configuration — rules, org structure, admin. Not opened daily, so it
    // sits last and stays hidden entirely for view-only / driver roles.
    titleKey: 'section.settings',
    items: [
      { to: '/app/notification-rules', labelKey: 'nav.notificationRules', min: 'DISPATCHER',   icon: <IconBell /> },
      { to: '/app/health-rules',       labelKey: 'nav.healthRules',       min: 'FLEET_MANAGER', icon: <IconShield /> },
      { to: '/app/org',                labelKey: 'nav.org',               min: 'FLEET_MANAGER', icon: <IconLayers /> },
      { to: '/app/users',              labelKey: 'nav.users',             min: 'COMPANY_ADMIN', icon: <IconUsers /> },
      { to: '/app/billing',            labelKey: 'nav.billing',           min: 'COMPANY_ADMIN', icon: <IconBuilding /> },
      { to: '/app/support',            labelKey: 'nav.support',           min: 'COMPANY_ADMIN', icon: <IconLifeRing /> },
      { to: '/app/audit',              labelKey: 'nav.audit',             min: 'COMPANY_ADMIN', icon: <IconAudit /> },
      { to: '/app/companies',          labelKey: 'nav.companies',         min: 'SUPER_ADMIN',   icon: <IconBuilding /> },
      { to: '/app/landing-settings',   labelKey: 'nav.landingSettings',   min: 'SUPER_ADMIN',   icon: <IconCog /> },
      { to: '/app/system-health',      labelKey: 'nav.systemHealth',      min: 'SUPER_ADMIN',   icon: <IconPulse /> },
    ],
  },
];

type AuthRole = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'FLEET_MANAGER' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';

export function AppShell() {
  const { user, hasRole, setUser } = useAuth();
  const { t, i18n } = useTranslation();
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
              {t('common.brandTagline')}
            </div>
          </div>
        </div>

        {/* Sections */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {SECTIONS.map((sec) => {
            const visible = sec.items.filter((i) => hasRole(i.min));
            if (visible.length === 0) return null;
            return (
              <div key={sec.titleKey}>
                <div className="px-3 mb-1.5 text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                  {t(sec.titleKey)}
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
                      <span className="truncate">{t(n.labelKey)}</span>
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
              title={t('common.myProfile')}
            >
              <div className="h-9 w-9 rounded-full bg-brand-600/80 group-hover:bg-brand-500 flex items-center justify-center text-sm font-bold uppercase shadow transition">
                {initials(user?.fullName || user?.email || '?')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate group-hover:text-brand-200 transition">
                  {user?.fullName || user?.email}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-brand-300/80">
                  {user?.role ? t(`role.${user.role}`) : ''}
                </div>
              </div>
            </NavLink>
            <div className="mt-2 flex gap-1" role="group" aria-label={t('common.language')}>
              {(['mn', 'en'] as const).map((lng) => (
                <button
                  key={lng}
                  type="button"
                  onClick={() => i18n.changeLanguage(lng)}
                  className={clsx(
                    'flex-1 rounded-md text-xs py-1.5 font-semibold uppercase transition',
                    i18n.resolvedLanguage === lng
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
                  )}
                >
                  {lng}
                </button>
              ))}
            </div>
            <button
              onClick={logout}
              className="mt-2 w-full rounded-md bg-slate-800 hover:bg-slate-700 text-sm py-1.5 transition flex items-center justify-center gap-2"
            >
              <IconLogout /> {t('common.logout')}
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {/* Inner boundary so navigating between lazy /app pages only swaps the
            content area — the sidebar stays mounted (no flicker). */}
        <Suspense
          fallback={
            <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">…</div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

function initials(s: string) {
  const parts = s.replace(/@.*/, '').split(/[ ._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
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
function IconCamera() {
  return (
    <IconBase>
      <path d="M3 7h3l2-2h8l2 2h3v12H3z" />
      <circle cx="12" cy="13" r="3.5" />
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
function IconPulse() {
  return (
    <IconBase>
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </IconBase>
  );
}
function IconRadius() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 12 L18 6" />
    </IconBase>
  );
}
function IconLifeRing() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M5 5l3.5 3.5M19 5l-3.5 3.5M5 19l3.5-3.5M19 19l-3.5-3.5" />
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
