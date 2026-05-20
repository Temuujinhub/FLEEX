import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Drivers } from './pages/Drivers';
import { EcoDriving } from './pages/EcoDriving';
import { Places } from './pages/Places';
import { ServiceTasks } from './pages/ServiceTasks';
import { LandingSettings } from './pages/LandingSettings';
import { LiveMap } from './pages/LiveMap';
import { History } from './pages/History';
import { Events } from './pages/Events';
import { Geofences } from './pages/Geofences';
import { Reports } from './pages/Reports';
import { ProximityReport } from './pages/ProximityReport';
import { Audit } from './pages/Audit';
import { SystemHealth } from './pages/SystemHealth';
import { Users } from './pages/Users';
import { Companies } from './pages/Companies';
import { Groups } from './pages/Groups';
import { Profile } from './pages/Profile';
import { NotificationRules } from './pages/NotificationRules';
import { DeviceHealthRules } from './pages/DeviceHealthRules';
import { AppShell } from './components/AppShell';
import { Protected } from './components/Protected';

export function App() {
  return (
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
        <Route path="/app/devices" element={<Devices />} />
        <Route path="/app/drivers" element={<Drivers />} />
        <Route path="/app/groups" element={<Groups />} />
        <Route path="/app/eco-driving" element={<EcoDriving />} />
        <Route path="/app/places" element={<Places />} />
        <Route path="/app/service-tasks" element={<ServiceTasks />} />
        <Route path="/app/landing-settings" element={<LandingSettings />} />
        <Route path="/app/history/:deviceId?" element={<History />} />
        <Route path="/app/events" element={<Events />} />
        <Route path="/app/notification-rules" element={<NotificationRules />} />
        <Route path="/app/health-rules" element={<DeviceHealthRules />} />
        <Route path="/app/geofences" element={<Geofences />} />
        <Route path="/app/reports" element={<Reports />} />
        <Route path="/app/proximity" element={<ProximityReport />} />
        <Route path="/app/users" element={<Users />} />
        <Route path="/app/companies" element={<Companies />} />
        <Route path="/app/profile" element={<Profile />} />
        <Route path="/app/audit" element={<Audit />} />
        <Route path="/app/system-health" element={<SystemHealth />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
