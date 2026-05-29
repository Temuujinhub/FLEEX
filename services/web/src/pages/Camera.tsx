import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, API_BASE, getToken } from '../lib/api';
import { useAuth } from '../store/auth';

// Камер · DualCam. Тенант-хамгаалалттай камерын галерей: сонгосон машины
// зургуудыг харуулж, on-demand зураг/видео хүсэлт илгээнэ. Зургийн байт нь
// зөвхөн authenticated API-аар (/api/media/:id/file) дамждаг — тусдаа rig
// байхгүй.

interface DeviceRow {
  id: string;
  name: string;
  plateNumber?: string | null;
  imei: string;
  online?: boolean;
}

interface MediaItem {
  id: string;
  kind: 'photo' | 'video';
  fileName: string;
  size: number;
  trigger: string | null;
  capturedAt: string;
}

export function Camera() {
  const auth = useAuth();
  const canRequest = auth.hasRole('FLEET_MANAGER');
  const qc = useQueryClient();
  const [deviceId, setDeviceId] = useState<string>('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [note, setNote] = useState<string>('');

  const devices = useQuery<DeviceRow[]>({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then((r) => r.data),
  });

  // Default to the first device once the list loads.
  useEffect(() => {
    if (!deviceId && devices.data && devices.data.length > 0) {
      setDeviceId(devices.data[0].id);
    }
  }, [devices.data, deviceId]);

  const images = useQuery<{ items: MediaItem[]; nextCursor: string | null }>({
    queryKey: ['device-images', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}/images`).then((r) => r.data),
    enabled: !!deviceId,
    refetchInterval: 8000, // poll so a freshly-pulled capture shows up
  });

  const request = useMutation({
    mutationFn: (kind: 'photo' | 'video') =>
      api.post(`/devices/${deviceId}/camera/request`, { kind }).then((r) => r.data),
    onSuccess: (_d, kind) => {
      setNote(
        kind === 'video'
          ? 'Видео хүсэлт илгээгдлээ — камер дараагийн холболтоороо илгээнэ (триггер хийсэн клип шаардлагатай).'
          : 'Зургийн хүсэлт илгээгдлээ — камер дараагийн холболтоороо зураг илгээнэ.',
      );
      setTimeout(() => setNote(''), 6000);
      setTimeout(() => qc.invalidateQueries({ queryKey: ['device-images', deviceId] }), 4000);
    },
    onError: () => {
      setNote('Хүсэлт илгээхэд алдаа гарлаа.');
      setTimeout(() => setNote(''), 5000);
    },
  });

  const selected = useMemo(
    () => devices.data?.find((d) => d.id === deviceId),
    [devices.data, deviceId],
  );
  const items = images.data?.items ?? [];

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <div className="px-5 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-lg font-bold text-slate-900">Камер · DualCam</h1>
          <p className="text-xs text-slate-500">Машины камерын зураг/видео — шаардсанаар татах.</p>
        </div>
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {(devices.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.plateNumber ? ` · ${d.plateNumber}` : ''}
            </option>
          ))}
        </select>
        {canRequest && (
          <>
            <button
              type="button"
              disabled={!deviceId || request.isPending}
              onClick={() => request.mutate('photo')}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              📷 Зураг авах
            </button>
            <button
              type="button"
              disabled={!deviceId || request.isPending}
              onClick={() => request.mutate('video')}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              📹 Видео татах
            </button>
          </>
        )}
      </div>

      {note && (
        <div className="px-5 py-2 bg-brand-50 border-b border-brand-100 text-sm text-brand-800">{note}</div>
      )}

      <div className="flex-1 overflow-auto p-5">
        {selected && (
          <div className="mb-3 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{selected.name}</span> · IMEI {selected.imei}
            {selected.online ? ' · online' : ' · offline'}
          </div>
        )}

        {images.isLoading ? (
          <div className="text-sm text-slate-400">Уншиж байна…</div>
        ) : images.isError ? (
          <div className="text-sm text-rose-600">Зургийн жагсаалтыг ачааллахад алдаа гарлаа.</div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
            Энэ машинд хадгалагдсан зураг алга. {canRequest ? '«Зураг авах» дарж шинэ зураг хүснэ үү.' : ''}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((m) => (
              <div key={m.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                {m.kind === 'video' ? (
                  <button
                    type="button"
                    onClick={() => downloadMedia(m.id, m.fileName)}
                    className="flex h-32 w-full flex-col items-center justify-center gap-1 bg-slate-800 text-slate-100"
                  >
                    <span className="text-2xl">📹</span>
                    <span className="text-xs">Видео татах</span>
                  </button>
                ) : (
                  <AuthedImg
                    imageId={m.id}
                    className="h-32 w-full cursor-pointer object-cover"
                    onClick={() => setLightbox(m.id)}
                  />
                )}
                <div className="px-2 py-1.5 text-[11px] text-slate-500">
                  {new Date(m.capturedAt).toLocaleString('mn-MN')}
                  {m.trigger ? ` · ${m.trigger}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <AuthedImg imageId={lightbox} className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}

// Fetches a media blob with the bearer token, renders it as an object URL, and
// revokes the URL on unmount so repeated gallery views don't leak memory.
function AuthedImg({
  imageId,
  className,
  onClick,
}: {
  imageId: string;
  className?: string;
  onClick?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objUrl: string | null = null;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/media/${imageId}/file`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!r.ok || cancelled) return;
        const blob = await r.blob();
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);
        setUrl(objUrl);
      } catch {
        /* leave placeholder */
      }
    })();
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [imageId]);

  if (!url) {
    return (
      <div className={clsx('flex items-center justify-center bg-slate-200 text-xs text-slate-400', className)}>
        Уншиж байна…
      </div>
    );
  }
  return <img src={url} alt="" className={className} onClick={onClick} />;
}

async function downloadMedia(imageId: string, fileName: string) {
  const r = await fetch(`${API_BASE}/media/${imageId}/file`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const blob = await r.blob();
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(u);
}
