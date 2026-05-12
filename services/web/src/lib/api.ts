import axios from 'axios';

export const API_BASE = (import.meta.env.VITE_API_URL as string) || '/api';
export const WS_URL = (import.meta.env.VITE_WS_URL as string) || '/ws';

const TOKEN_KEY = 'fleex.token';
const REFRESH_KEY = 'fleex.refresh';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export const api = axios.create({ baseURL: API_BASE, timeout: 30_000 });

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original?._retry && getRefreshToken()) {
      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = (async () => {
            const r = await axios.post(`${API_BASE}/auth/refresh`, {
              refreshToken: getRefreshToken(),
            });
            setTokens(r.data.accessToken, r.data.refreshToken);
            return r.data.accessToken as string;
          })();
        }
        const newToken = await refreshing;
        refreshing = null;
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (e) {
        refreshing = null;
        clearTokens();
        window.location.assign('/login');
      }
    }
    return Promise.reject(err);
  },
);
