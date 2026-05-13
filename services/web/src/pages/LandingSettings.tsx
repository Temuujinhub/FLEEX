import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, API_BASE, getToken } from '../lib/api';

// Сайтын тохиргоо. Super-admin-аар нүүр хуудасны hero текстийг засаж,
// 8 image slot бүрд (hero, about, 5 use case, why-us) зураг upload
// эсвэл устгана. Public landing page нь зөвхөн `/api/landing`-аас
// уншиж, slot бүрд CMS-ийн зураг байвал хэрэглэж, үгүй бол Unsplash
// fallback-руу унана.

const DEFAULTS = {
  tagline: 'Fleet Flexible — Танай флотын уян хатан удирдлага',
  subText:
    'Уул уурхай, хүргэлт, нийтийн тээвэр, түрээсийн үйлчилгээ — Fleex нь Teltonika Pro GPS болон AI аналитик дээр суурилсан, Монголын нөхцөлд бүрэн нийцсэн ухаалаг fleet management платформ.',
};

interface ImageSlot {
  key: string;
  label: string;
  desc: string;
}
const IMAGE_SLOTS: ImageSlot[] = [
  { key: 'hero',               label: 'Hero (нүүр)',             desc: 'Хамгийн дээд талын том зураг. 16:9 (жишээ нь 1600×900).' },
  { key: 'about',              label: 'Танилцуулга',              desc: '"MediaPRO ХХК-ийн бүтээгдэхүүн" хэсгийн зураг.' },
  { key: 'use-case-mining',    label: 'Уул уурхай',               desc: 'Зэсийн баяжмал / нүүрс тээвэрлэгч самосвал.' },
  { key: 'use-case-delivery',  label: 'Хотын хүргэлт',            desc: 'Хүргэлтийн Porter / фургон / жижиг машин.' },
  { key: 'use-case-intercity', label: 'Хот хоорондын тээвэр',     desc: 'Контейнер / цистерн / том ачааны машин.' },
  { key: 'use-case-bus',       label: 'Нийтийн тээвэр · Автобус', desc: 'Хот доторх эсвэл хот хоорондын автобус.' },
  { key: 'use-case-rental',    label: 'Машин түрээс',             desc: 'Каршэринг, sedan, хөнгөн машин.' },
  { key: 'why-us',             label: 'Operations (Яагаад Fleex?)', desc: 'Гранж, control room, fleet operations photo.' },
];

export function LandingSettings() {
  const [tagline, setTagline] = useState('');
  const [subText, setSubText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const qc = useQueryClient();

  const data = useQuery({
    queryKey: ['landing-settings'],
    queryFn: () => api.get('/landing').then((r) => r.data),
  });

  useEffect(() => {
    if (data.data) {
      setTagline(data.data.heroTagline ?? '');
      setSubText(data.data.heroSubText ?? '');
    }
  }, [data.data]);

  const save = useMutation({
    mutationFn: (payload: any) => api.patch('/landing', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['landing-settings'] });
      setMsg({ kind: 'ok', text: 'Текст хадгалагдлаа' });
    },
    onError: (e: any) =>
      setMsg({ kind: 'error', text: e?.response?.data?.message ?? 'Хадгалах үед алдаа' }),
  });

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Сайтын тохиргоо</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Public нүүр хуудасны (fleex.mn) hero хэсгийн гарчиг, дэд текст ба бүх
            section-ийн зураг. Хоосон үлдээвэл анхны утга / Unsplash default харагдана.
          </p>
        </header>

        {msg && (
          <div className={clsx(
            'rounded-md border px-4 py-3 text-sm',
            msg.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800',
          )}>
            {msg.text}
          </div>
        )}

        {/* ─── Image gallery ───────────────────────────── */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold">Зургуудын галерей</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            JPEG / PNG / WEBP / GIF, 5 МБ хүртэл. Slot тус бүрд тохирох жинхэнэ
            fleet зураг (БелАЗ, Porter, автобус, түрээсийн машин г.м) upload хийгээрэй.
          </p>
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {IMAGE_SLOTS.map((slot) => (
              <ImageSlotCard
                key={slot.key}
                slot={slot}
                meta={data.data?.images?.[slot.key]}
                onChanged={() => {
                  qc.invalidateQueries({ queryKey: ['landing-settings'] });
                  setMsg({ kind: 'ok', text: `${slot.label} зураг шинэчлэгдлээ` });
                }}
                onError={(t) => setMsg({ kind: 'error', text: t })}
              />
            ))}
          </div>
        </section>

        {/* ─── Hero text ───────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-semibold">Hero текст</h2>

          <Field
            label="Гарчиг (Hero tagline)"
            hint={`Анхны утга: ${DEFAULTS.tagline}`}
          >
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder={DEFAULTS.tagline}
              maxLength={200}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="text-[11px] text-slate-500 mt-1">{tagline.length}/200</div>
          </Field>

          <Field
            label="Дэд текст (Sub-text)"
            hint={`Анхны утга: ${DEFAULTS.subText}`}
          >
            <textarea
              value={subText}
              onChange={(e) => setSubText(e.target.value)}
              placeholder={DEFAULTS.subText}
              maxLength={800}
              rows={5}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="text-[11px] text-slate-500 mt-1">{subText.length}/800</div>
          </Field>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => save.mutate({ heroTagline: tagline, heroSubText: subText })}
              disabled={save.isPending}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-50"
            >
              {save.isPending ? 'Хадгалж байна…' : 'Текстийг хадгалах'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTagline('');
                setSubText('');
              }}
              className="rounded-md border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm px-5 py-2"
            >
              Хоосолж default-руу буцах
            </button>
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-sm text-brand-700 hover:underline self-center"
            >
              Нүүр хуудсыг шинэ tab дотор үзэх →
            </a>
          </div>
        </section>

        <p className="text-xs text-slate-500">
          💡 Текст / зургийн өөрчлөлт нь нийтийн хэрэглэгчдэд 5 минутын дотор тархана
          (browser cache + react-query). Шууд харахын тулд incognito tab + Ctrl+Shift+R.
        </p>
      </div>
    </div>
  );
}

// ── Single image slot card ──────────────────────────────────
function ImageSlotCard({
  slot,
  meta,
  onChanged,
  onError,
}: {
  slot: ImageSlot;
  meta?: { hasImage: boolean; updatedAt: string };
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const qc = useQueryClient();

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setPending(true);
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/landing/images/${slot.key}`, fd);
      return r.data;
    },
    onSuccess: () => {
      setPending(false);
      onChanged();
    },
    onError: (e: any) => {
      setPending(false);
      onError(e?.response?.data?.message ?? 'Зураг ачаалах үед алдаа');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/landing/images/${slot.key}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['landing-settings'] });
      onError(''); // clear any pending error message
      onChanged();
    },
    onError: (e: any) => onError(e?.response?.data?.message ?? 'Устгах үед алдаа'),
  });

  const url = meta?.hasImage
    ? `${API_BASE}/landing/images/${slot.key}?v=${encodeURIComponent(meta.updatedAt ?? '')}&t=${getToken()?.slice(-4) ?? ''}`
    : null;

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="aspect-video bg-slate-100 flex items-center justify-center relative">
        {url ? (
          <img src={url} alt={slot.label} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-slate-400 px-3 text-center">
            Default Unsplash ашиглагдана
          </span>
        )}
        {meta?.hasImage && (
          <span className="absolute top-2 right-2 text-[10px] uppercase tracking-widest bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
            Custom
          </span>
        )}
      </div>
      <div className="p-3 space-y-1">
        <div className="font-semibold text-sm">{slot.label}</div>
        <div className="text-[11px] text-slate-500 line-clamp-2">{slot.desc}</div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = '';
          }}
        />
        <div className="pt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="flex-1 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold py-1.5 disabled:opacity-50"
          >
            {pending ? 'Ачаалж…' : meta?.hasImage ? '🔄 Солих' : '📷 Upload'}
          </button>
          {meta?.hasImage && (
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded-md border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs px-2.5 py-1.5 disabled:opacity-50"
              title="Default-руу буцах"
            >
              🗑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">
        {label}
      </label>
      {children}
      {hint && <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{hint}</div>}
    </div>
  );
}
