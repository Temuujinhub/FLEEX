// "Боломж" tab — shows, per device model, what telemetry & features the
// tracker yields with NO extra peripheral attached (onboard GNSS + G-Sensor
// + power sensing), what each onboard interface unlocks once an accessory is
// wired, and recommended fleet use-cases. When the device is saved we also
// cross-reference the latest raw packet so the operator sees which built-in
// signals are actually arriving right now.
//
// Static model knowledge lives in devices/deviceModels.ts.

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { matchModel, type BuiltInSignal } from './deviceModels';
import { formatRelative } from './shared';

export function CapabilitiesTab({
  model,
  deviceId,
}: {
  model: string | null | undefined;
  deviceId?: string;
}) {
  const { spec, matched } = matchModel(model);

  // Live cross-reference: the most recent raw packet's IO map. Only fetched
  // for saved devices; absence simply means no live badges (no error).
  const messages = useQuery({
    queryKey: ['messages', deviceId, 'latest-for-caps'],
    queryFn: () => api.get(`/devices/${deviceId}/messages?limit=1`).then((r) => r.data),
    refetchInterval: 30_000,
    enabled: !!deviceId,
  });
  const latest = deviceId ? messages.data?.items?.[0] : undefined;
  const payload: Record<string, any> | undefined = latest?.payload;

  const isActive = (sig: BuiltInSignal): boolean => {
    if (!payload) return false;
    if (sig.io === 'gnss') return latest?.lat != null || payload['io_240'] != null;
    if (sig.io === 'sdlog') return false; // not a live IO key
    const v = payload[sig.io];
    return v != null && v !== 0;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-slate-900">{spec.name}</h3>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 bg-slate-100 rounded px-2 py-0.5">
            {spec.family}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {spec.formFactor} · {spec.connectivity}
        </p>
        {!matched && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 px-3 py-2">
            ⚠ Загварыг таньсангүй — ерөнхий FMx боломжийг харуулж байна. "Тохиргоо" таб дахь
            <b> Модель </b> талбарт яг загварыг бичвэл (жнь: FMC125, FMC650) нарийвчилсан боломж харагдана.
          </div>
        )}
      </div>

      {/* Capability badges */}
      <div className="flex flex-wrap gap-2">
        <Badge on={spec.driverBehavior} label="Жолоочийн зан төлөв (G-Sensor)" />
        <Badge on={spec.engineCut} label="Хөдөлгүүр блоклох (реле)" />
        <Badge on={spec.offlineLog} label="microSD офлайн лог" />
      </div>

      {/* Built-in signals — no accessory required */}
      <section>
        <SectionTitle
          title="Дотоод сенсор (нэмэлт төхөөрөмжгүй)"
          hint={
            deviceId
              ? latest
                ? `Сүүлийн пакеттай тулгав · ${formatRelative(latest.receivedAt)}`
                : 'Сүүлийн пакет байхгүй — зөвхөн боломжийн жагсаалт'
              : 'Энэ загвараас шууд авах боломжтой дата'
          }
        />
        <div className="grid md:grid-cols-2 gap-2">
          {spec.builtIn.map((sig) => {
            const active = isActive(sig);
            return (
              <div
                key={sig.io}
                className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{sig.label}</div>
                  {deviceId && (
                    <span
                      className={
                        active
                          ? 'text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 shrink-0'
                          : 'text-[10px] font-semibold text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5 shrink-0'
                      }
                    >
                      {active ? '● идэвхтэй' : '○ идэвхгүй'}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{sig.use}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Interfaces — what each onboard port unlocks */}
      <section>
        <SectionTitle
          title="Интерфейс ба өргөтгөл"
          hint="Нэмэлт төхөөрөмж/мэдрэгч холбоход нээгдэх боломжууд"
        />
        <div className="grid md:grid-cols-2 gap-2">
          {spec.interfaces.map((itf) => (
            <div
              key={itf.name}
              className="border border-slate-200 rounded-md px-3 py-2 flex items-start gap-2"
            >
              <span className="text-[10px] font-mono font-semibold text-brand-700 bg-brand-50 border border-brand-100 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
                {itf.name}
              </span>
              <div className="min-w-0">
                <div className="text-xs text-slate-700">{itf.enables}</div>
                {itf.builtIn && (
                  <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                    ✓ Нэмэлт адаптергүйгээр
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recommended use-cases */}
      <section>
        <SectionTitle title="Хэрэглээний зөвлөмж" />
        <ul className="space-y-1.5">
          {spec.useCases.map((uc) => (
            <li key={uc} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="text-brand-600 mt-0.5">▸</span>
              <span>{uc}</span>
            </li>
          ))}
        </ul>
        {spec.notDesignedFor && (
          <div className="mt-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 px-3 py-2">
            ⚠ Тохирохгүй: {spec.notDesignedFor}
          </div>
        )}
      </section>

      <p className="text-[10px] text-slate-400 leading-relaxed">
        Боломжууд функциональ түвшинд тодорхойлогдсон. Нарийн цахилгаан үзүүлэлт (батарей, LTE
        ангилал, I/O тоо) болон firmware-аас хамаарах IO ID-г Teltonika-гийн албан ёсны wiki /
        datasheet-аас баталгаажуулна уу.
      </p>
    </div>
  );
}

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={
        on
          ? 'inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1'
          : 'inline-flex items-center gap-1 text-xs font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1'
      }
    >
      {on ? '✓' : '✕'} {label}
    </span>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{title}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}
