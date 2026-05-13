import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_BASE, getToken } from '../lib/api';

// Сайтын тохиргоо. Super-admin-аар орсон үед нүүр хуудасны hero хэсгийн
// гарчиг, дэд текст, зураг үндсэн утгаа өөрчилнө. Public landing page
// нь GET /api/landing-аар уншиж, утга байхгүй бол default-руу унана.

const DEFAULTS = {
  tagline: 'Fleet Flexible — Танай флотын уян хатан удирдлага',
  subText: 'Уул уурхай, хүргэлт, нийтийн тээвэр, түрээсийн үйлчилгээ — Fleex нь Teltonika Pro GPS болон AI аналитик дээр суурилсан, Монголын нөхцөлд бүрэн нийцсэн ухаалаг fleet management платформ.',
};

export function LandingSettings() {
  const [tagline, setTagline] = useState('');
  const [subText, setSubText] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
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
    onError: (e: any) => setMsg({ kind: 'error', text: e?.response?.data?.message ?? 'Хадгалах үед алдаа' }),
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      setPending(true);
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/landing/image', fd);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['landing-settings'] });
      setMsg({ kind: 'ok', text: 'Зураг шинэчлэгдлээ' });
      setPending(false);
    },
    onError: (e: any) => {
      setMsg({ kind: 'error', text: e?.response?.data?.message ?? 'Зураг ачаалах үед алдаа' });
      setPending(false);
    },
  });

  const deleteImage = useMutation({
    mutationFn: () => api.delete('/landing/image').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['landing-settings'] });
      setMsg({ kind: 'ok', text: 'Зураг устгагдлаа — анхны зураг руу буцлаа' });
    },
    onError: (e: any) => setMsg({ kind: 'error', text: e?.response?.data?.message ?? 'Устгах үед алдаа' }),
  });

  const imgUrl = data.data?.hasImage
    ? `${API_BASE}/landing/image?v=${encodeURIComponent(data.data.updatedAt ?? '')}&t=${getToken()?.slice(-4) ?? ''}`
    : null;

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Сайтын тохиргоо</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Public нүүр хуудасны (fleex.mn) hero хэсгийн гарчиг, дэд текст, зураг.
            Хоосон үлдээвэл анхны утга харагдана.
          </p>
        </header>

        {msg && (
          <div className={`rounded-md border px-4 py-3 text-sm ${
            msg.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
            {msg.text}
          </div>
        )}

        {/* Image */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold">Hero зураг</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            JPEG / PNG / WEBP / GIF, 5 МБ хүртэл. 16:9 харьцаа зөвлөмжтэй (жишээ нь 1600×900).
          </p>
          <div className="mt-4 grid md:grid-cols-2 gap-5">
            <div className="aspect-video rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
              {imgUrl ? (
                <img src={imgUrl} alt="Hero" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm text-slate-400">Зураг сонгогдоогүй — Unsplash default ашиглагдана</span>
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadImage.mutate(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={pending}
                className="w-full rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold py-2.5 disabled:opacity-50"
              >
                {pending ? 'Ачаалж байна…' : '📷 Шинэ зураг сонгох'}
              </button>
              {imgUrl && (
                <button
                  type="button"
                  onClick={() => deleteImage.mutate()}
                  disabled={deleteImage.isPending}
                  className="w-full rounded-md border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm py-2.5 disabled:opacity-50"
                >
                  Зургийг устгах (default-руу буцах)
                </button>
              )}
              <div className="text-xs text-slate-500 mt-3 leading-relaxed">
                💡 Зөвлөмж: уул уурхайн самосвал, хотын хүргэлтийн фургон, автобус, түрээсийн машин гэх мэт fleet-ийн төлөөлсөн зураг.
              </div>
            </div>
          </div>
        </section>

        {/* Text */}
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
              {save.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
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
