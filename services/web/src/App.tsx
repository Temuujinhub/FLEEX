import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Protected } from './components/Protected';

// Route-based code splitting: each page is its own chunk so the initial bundle
// no longer ships all 27 screens up front. (Vendor `manualChunks` was avoided —
// it caused a react-leaflet TDZ; per-route lazy() doesn't.)
const Landing = lazy(() => import('./pages/Landing').then((m) => ({ default: m.Landing })));
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Devices = lazy(() => import('./pages/Devices').then((m) => ({ default: m.Devices })));
const Drivers = lazy(() => import('./pages/Drivers').then((m) => ({ default: m.Drivers })));
const EcoDriving = lazy(() => import('./pages/EcoDriving').then((m) => ({ default: m.EcoDriving })));
const Places = lazy(() => import('./pages/Places').then((m) => ({ default: m.Places })));
const ServiceTasks = lazy(() => import('./pages/ServiceTasks').then((m) => ({ default: m.ServiceTasks })));
const LandingSettings = lazy(() => import('./pages/LandingSettings').then((m) => ({ default: m.LandingSettings })));
const LiveMap = lazy(() => import('./pages/LiveMap').then((m) => ({ default: m.LiveMap })));
const Dispatch = lazy(() => import('./pages/Dispatch').then((m) => ({ default: m.Dispatch })));
const Shifts = lazy(() => import('./pages/Shifts').then((m) => ({ default: m.Shifts })));
const OrgStructure = lazy(() => import('./pages/OrgStructure').then((m) => ({ default: m.OrgStructure })));
const History = lazy(() => import('./pages/History').then((m) => ({ default: m.History })));
const Camera = lazy(() => import('./pages/Camera').then((m) => ({ default: m.Camera })));
const Events = lazy(() => import('./pages/Events').then((m) => ({ default: m.Events })));
const Geofences = lazy(() => import('./pages/Geofences').then((m) => ({ default: m.Geofences })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const ProximityReport = lazy(() => import('./pages/ProximityReport').then((m) => ({ default: m.ProximityReport })));
const SupportTickets = lazy(() => import('./pages/SupportTickets').then((m) => ({ default: m.SupportTickets })));
const Audit = lazy(() => import('./pages/Audit').then((m) => ({ default: m.Audit })));
const SystemHealth = lazy(() => import('./pages/SystemHealth').then((m) => ({ default: m.SystemHealth })));
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));
const Companies = lazy(() => import('./pages/Companies').then((m) => ({ default: m.Companies })));
const Groups = lazy(() => import('./pages/Groups').then((m) => ({ default: m.Groups })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const NotificationRules = lazy(() => import('./pages/NotificationRules').then((m) => ({ default: m.NotificationRules })));
const DeviceHealthRules = lazy(() => import('./pages/DeviceHealthRules').then((m) => ({ default: m.DeviceHealthRules })));

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">…</div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Protected>
              <AppShell />
            </Protected>
          }
        >
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/map" element={<LiveMap />} />
          <Route path="/app/dispatch" element={<Dispatch />} />
          <Route path="/app/devices" element={<Devices />} />
          <Route path="/app/drivers" element={<Drivers />} />
          <Route path="/app/org" element={<OrgStructure />} />
          {/* Kept for deep links / bookmarks; the nav points at /app/org. */}
          <Route path="/app/groups" element={<Groups />} />
          <Route path="/app/shifts" element={<Shifts />} />
          <Route path="/app/eco-driving" element={<EcoDriving />} />
          <Route path="/app/places" element={<Places />} />
          <Route path="/app/service-tasks" element={<ServiceTasks />} />
          <Route path="/app/landing-settings" element={<LandingSettings />} />
          <Route path="/app/history/:deviceId?" element={<History />} />
          <Route path="/app/camera" element={<Camera />} />
          <Route path="/app/events" element={<Events />} />
          <Route path="/app/notification-rules" element={<NotificationRules />} />
          <Route path="/app/health-rules" element={<DeviceHealthRules />} />
          <Route path="/app/geofences" element={<Geofences />} />
          <Route path="/app/reports" element={<Reports />} />
          <Route path="/app/proximity" element={<ProximityReport />} />
          <Route path="/app/support" element={<SupportTickets />} />
          <Route path="/app/users" element={<Users />} />
          <Route path="/app/companies" element={<Companies />} />
          <Route path="/app/profile" element={<Profile />} />
          <Route path="/app/audit" element={<Audit />} />
          <Route path="/app/system-health" element={<SystemHealth />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
