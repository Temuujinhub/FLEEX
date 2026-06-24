import { useEffect, useRef, useState } from 'react';
import { WS_URL, getToken, api } from './api';

export interface LiveMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

// Shared live-WebSocket hook with automatic reconnect (exponential backoff).
// The previous per-page `new WebSocket()` had no onclose/onerror handling, so
// any network blip, proxy idle-timeout, or server redeploy silently froze live
// updates until a full page reload. This reconnects and resubscribes on its
// own. The callback is kept in a ref so re-renders don't tear down the socket.
export function useLiveSocket(onMessage: (msg: LiveMessage) => void) {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      if (stopped) return;
      const token = getToken();
      if (!token) {
        // Auth still bootstrapping — try again shortly.
        timer = setTimeout(connect, 2000);
        return;
      }
      // Prefer a single-use ticket so the JWT never lands in the WS URL / proxy
      // access logs (audit H-7). Fall back to the legacy ?token param if the
      // ticket endpoint is unavailable (e.g. mid-rollout) so live updates keep
      // working.
      let query = `?token=${encodeURIComponent(token)}`;
      try {
        const { data } = await api.post('/auth/ws-ticket');
        if (data?.ticket) query = `?ticket=${encodeURIComponent(data.ticket)}`;
      } catch {
        /* keep legacy token fallback */
      }
      if (stopped) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = WS_URL.startsWith('ws')
        ? `${WS_URL}${query}`
        : `${proto}://${window.location.host}${WS_URL}${query}`;

      ws = new WebSocket(url);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        try {
          cbRef.current(JSON.parse(ev.data));
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (stopped) return;
        const delay = Math.min(1000 * 2 ** retry, 30_000); // 1s,2s,4s… cap 30s
        retry += 1;
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        try {
          ws?.close(); // funnel through onclose → reconnect
        } catch {
          /* ignore */
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (ws) {
        ws.onclose = null; // don't reconnect on intentional unmount
        ws.close();
      }
    };
  }, []);

  return { connected };
}
