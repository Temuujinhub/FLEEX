import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string | null;
  role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'FLEET_MANAGER' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';
  companyId: string | null;
}

interface AuthState {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  hasRole: (min: AuthUser['role']) => boolean;
}

const ladder: Record<AuthUser['role'], number> = {
  SUPER_ADMIN: 100,
  COMPANY_ADMIN: 80,
  FLEET_MANAGER: 60,
  DISPATCHER: 40,
  DRIVER: 20,
  VIEWER: 10,
};

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      setUser: (u) => set({ user: u }),
      hasRole: (min) => {
        const u = get().user;
        if (!u) return false;
        return ladder[u.role] >= ladder[min];
      },
    }),
    { name: 'fleex.auth' },
  ),
);
