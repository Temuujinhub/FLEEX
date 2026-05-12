import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Drivers } from './pages/Drivers';
import { LiveMap } from './pages/LiveMap';
import { History } from './pages/History';
import { Events } from './pages/Events';
import { Geofences } from './pages/Geofences';
import { Reports } from './pages/Reports';
import { Audit } from './pages/Audit';
import { Users } from './pages/Users';
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
        <Route path="/app/history/:deviceId?" element={<History />} />
        <Route path="/app/events" element={<Events />} />
        <Route path="/app/geofences" element={<Geofences />} />
        <Route path="/app/reports" element={<Reports />} />
        <Route path="/app/users" element={<Users />} />
        <Route path="/app/audit" element={<Audit />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
