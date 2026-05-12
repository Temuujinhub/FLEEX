import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { api, getToken } from '../lib/api';

export function Protected({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!user && getToken()) {
      api.get('/users/me').then((r) => setUser(r.data)).catch(() => undefined);
    }
  }, [user, setUser]);

  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
