import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

// Single-pane health & diagnostics view for SUPER_ADMIN. Avoids the
// previous "speed up a vehicle to test the alert pipeline" workflow by
// exposing test-send buttons for email and SMS, and surfaces the
// metrics an operator wants when wondering "is something wrong":
// service liveness, fleet/traffic counts, host resources, security
// signals, and the Oyu Tolgoi technical-requirement matrix.

interface Overview {
  services: Record<string, { ok: boolean; detail?: string }>;
  fleet: {
    companies: number;
    users: number;
    devicesTotal: number;
    devicesActive: number;
    devicesOnline: number;
    devicesMoving: number;
  };
  traffic: {
    positionsToday: number;
    positionsLastHour: number;
    eventsToday: number;
    criticalToday: number;
    avgPacketBytes: number;
    positionsPerSecondAvg: number;
    bandwidthBpsEstimate: number;
  };
  resources: {
    cpuCount: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    memoryTotal: number;
    memoryUsed: number;
    memoryFree: number;
    memoryPct: number;
    disk: { total: number; free: number; used: number } | null;
    dbSizeBytes: number | null;
    redisMemBytes: number | null;
  };
  security: {
    failedLogins24h: number;
    deniedActions24h: number;
    lastAuditAt: string | null;
    httpsEnforced: boolean;
  };
  uptimeSeconds: number;
  time: string;
}

export function SystemHealth() {
  const me = useAuth((s) => s.user);
  const isSuper = me?.role === 'SUPER_ADMIN';

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['system-admin', 'overview'],
    queryFn: () => api.get<Overview>('/system-admin/overview').then((r) => r.data),
    refetchInterval: 30_000,
    enabled: isSuper,
  });

  if (!isSuper) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-rose-50 text-rose-800 px-4 py-3 text-sm">
          Та энэ хуудсыг үзэх эрхгүй байна. Зөвхөн SUPER_ADMIN.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-100 min-h-full">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Системийн эрүүл мэнд</h1>
          <p className="text-sm text-slate-500 mt-1">
            Сэрвэр, дохио, флот, ачаалал, аюулгүй байдал — нэг харагдацанд. {isFetching && '· Шинэчилж байна…'}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-800"
        >
          Дахин шалгах
        </button>
      </div>

      {isLoading || !data ? (
        <div className="rounded-xl bg-white border border-slate-200 p-8 text-center text-slate-500">Татаж байна…</div>
      ) : (
        <>
          <ServicesCard services={data.services} uptimeSeconds={data.uptimeSeconds} />
          <IntegrationsCard />
          <TestSendCard defaultEmail={me?.email} />
          <FleetTrafficCards fleet={data.fleet} traffic={data.traffic} />
          <ResourcesCard r={data.resources} />
          <SecurityCard s={data.security} />
        </>
      )}
    </div>
  );
}

interface Integration {
  key:
    | 'brevo_api_key'
    | 'sms_api_key'
    | 'telegram_bot_token'
    | 'fcm_server_key'
    | 'whatsapp_token'
    | 'whatsapp_phone_id'
    | 'viber_bot_token';
  envVar: string;
  configured: boolean;
  source: 'db' | 'env' | 'none';
  masked: string;
  updatedAt: string | null;
}

const INTEGRATION_LABEL: Record<Integration['key'], { title: string; hint: string; placeholder: string }> = {
  brevo_api_key: {
    title: 'Brevo (имэйл) API key',
    hint: 'app.brevo.com → Settings → SMTP & API → API keys. Port 587 хаалттай server-т HTTPS API ашиглана.',
    placeholder: 'xkeysib-...',
  },
  sms_api_key: {
    title: 'CallPro Text API key',
    hint: 'api-text.callpro.mn-аас өгсөн x-api-key. SMS_FROM (lime number, жнь 72xxxxxx)-той хамт ажиллана.',
    placeholder: 'callpro-...',
  },
  telegram_bot_token: {
    title: 'Telegram bot token',
    hint: '@BotFather → /newbot. Дүрэм бүрт chat ID-уудаа оруулна. Хамгийн хялбар, үнэгүй суваг.',
    placeholder: '123456:ABC-DEF...',
  },
  fcm_server_key: {
    title: 'Push (FCM) server key',
    hint: 'Firebase Console → Project settings → Cloud Messaging server key. Мобайл апп push token-уудтай ажиллана.',
    placeholder: 'AAAA...',
  },
  whatsapp_token: {
    title: 'WhatsApp Cloud API token',
    hint: 'Meta for Developers → WhatsApp → API setup. Доорх phone-number ID-тэй хамт ажиллана.',
    placeholder: 'EAAB...',
  },
  whatsapp_phone_id: {
    title: 'WhatsApp phone-number ID',
    hint: 'Meta WhatsApp API setup дахь "Phone number ID" (токен биш, дугаарын тоон ID).',
    placeholder: '1234567890',
  },
  viber_bot_token: {
    title: 'Viber bot token',
    hint: 'partners.viber.com → public account → Auth token. Хэрэглэгч public account-д бүртгүүлсэн байх шаардлагатай.',
    placeholder: '4f3...-...-...',
  },
};

function IntegrationsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['system-admin', 'integrations'],
    queryFn: () => api.get<Integration[]>('/system-admin/integrations').then((r) => r.data),
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="font-semibold mb-1">Гадаад үйлчилгээний түлхүүр</h2>
      <p className="text-xs text-slate-500 mb-4">
        Brevo / SMS gateway-ийн API key-г энд тавиад хадгалбал production server-руу SSH хийхгүйгээр шууд идэвхэжнэ.
        Энд оруулсан утга .env дэх утгаас давамгайлна. Хоосон үлдээж хадгалбал DB утга арилж, .env эргэж идэвхэнэ.
      </p>
      {isLoading || !data ? (
        <div className="text-sm text-slate-500">Татаж байна…</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {data.map((i) => (
            <IntegrationField key={i.key} integration={i} onSaved={() => {
              qc.invalidateQueries({ queryKey: ['system-admin', 'integrations'] });
              qc.invalidateQueries({ queryKey: ['system-admin', 'overview'] });
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// Live shape check so the user is told 'this is a JWT / SMTP key' the
// moment they paste, instead of after a save+test round-trip to Brevo.
// Returns null for empty / clearly-fine input.
function detectKeyProblem(key: Integration['key'], value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (key === 'brevo_api_key') {
    if (v.startsWith('eyJ')) return 'Энэ JWT (MCP key) бололтой. Brevo дээр "Generate a new API key" → Type "API key" сонгож xkeysib- гэж эхэлсэн утгыг авна уу.';
    if (v.endsWith('==')) return 'Энэ MCP/SMTP key бололтой ("==" -р төгссөн). Brevo v3 API key xkeysib- гэж эхэлж, "==" -гүй байх ёстой.';
    if (!/^xkeysib-/i.test(v)) return 'Brevo v3 API key xkeysib- гэж эхлэх ёстой. Та SMTP key эсвэл өөр төрлийн token хуулсан байж болзошгүй.';
    if (v.length < 60) return 'Хэт богино — Brevo v3 API key ~110 тэмдэгт байдаг.';
  }
  return null;
}

function IntegrationField({ integration, onSaved }: { integration: Integration; onSaved: () => void }) {
  const label = INTEGRATION_LABEL[integration.key];
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const warn = detectKeyProblem(integration.key, value);

  // Reset draft whenever the row updates so a successful save clears
  // the input without leaving stale text behind.
  useEffect(() => {
    setValue('');
  }, [integration.masked, integration.source]);

  const save = useMutation({
    mutationFn: () => api.put(`/system-admin/integrations/${integration.key}`, { value }).then((r) => r.data),
    onSuccess: () => {
      setMsg({ type: 'ok', text: 'Хадгалагдсан. Дараагийн илгээлтэд шинэ түлхүүр идэвхэнэ.' });
      onSaved();
    },
    onError: (err: any) =>
      setMsg({ type: 'err', text: err.response?.data?.message ?? err.message ?? 'Алдаа' }),
  });

  const sourceBadge =
    integration.source === 'db' ? (
      <span className="inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">DB</span>
    ) : integration.source === 'env' ? (
      <span className="inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">.env</span>
    ) : (
      <span className="inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">тохируулаагүй</span>
    );

  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-sm font-medium">{label.title}</div>
        {sourceBadge}
      </div>
      <div className="text-xs text-slate-500 mb-2">{label.hint}</div>
      <div className="text-xs text-slate-600 mb-2">
        Одоо: <span className="font-mono">{integration.configured ? integration.masked : '—'}</span>
        {integration.updatedAt && (
          <span className="ml-2 text-slate-400">({new Date(integration.updatedAt).toLocaleString()})</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={label.placeholder}
          className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm font-mono"
        />
        <button
          onClick={() => {
            setMsg(null);
            save.mutate();
          }}
          disabled={save.isPending}
          className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm whitespace-nowrap"
        >
          {save.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
      </div>
      {warn && (
        <div className="mt-2 px-3 py-2 rounded-md text-xs bg-amber-50 text-amber-800">
          {warn}
        </div>
      )}
      {msg && (
        <div className={`mt-2 px-3 py-2 rounded-md text-xs ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function ServicesCard({ services, uptimeSeconds }: { services: Overview['services']; uptimeSeconds: number }) {
  // Keys mirror the API health payload (incl. the deploy-gated app services).
  const labels: Record<string, string> = {
    postgres: 'PostgreSQL',
    redis: 'Redis',
    api: 'API',
    ingestor: 'GPS Ingestor',
    eventsEngine: 'Events Engine',
    mediaService: 'Media (DualCam)',
    web: 'Web (SPA)',
    smtp: 'SMTP (имэйл)',
    sms: 'SMS gateway',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Сэрвэсийн төлөв</h2>
        <span className="text-xs text-slate-500">Uptime: {formatDuration(uptimeSeconds)}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(services).map(([key, value]) => (
          <div
            key={key}
            className={`rounded-xl border px-4 py-3 ${
              value.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{labels[key] ?? key}</span>
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${value.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
              />
            </div>
            <div className="mt-1 text-xs text-slate-600 truncate" title={value.detail}>
              {value.detail ?? (value.ok ? 'OK' : 'Доголдолтой')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TestSendCard({ defaultEmail }: { defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [phone, setPhone] = useState('');
  const [emailMsg, setEmailMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [smsMsg, setSmsMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
    url?: string;
    method?: string;
    requestBody?: unknown;
    responseStatus?: number;
    responseBody?: string;
  } | null>(null);

  const testEmail = useMutation({
    mutationFn: () => api.post('/system-admin/test-email', { to: email }).then((r) => r.data),
    onSuccess: () => setEmailMsg({ type: 'ok', text: `Илгээгдсэн: ${email}. Inbox + spam folder-аа шалгана уу.` }),
    onError: (err: any) =>
      setEmailMsg({ type: 'err', text: err.response?.data?.message ?? err.message ?? 'Алдаа' }),
  });

  const testSms = useMutation({
    mutationFn: () => api.post('/system-admin/test-sms', { to: phone }).then((r) => r.data),
    onSuccess: (d: any) =>
      setSmsMsg({
        type: 'ok',
        text: `Илгээгдсэн: ${phone}${d?.messageId ? ` (Message ID: ${d.messageId})` : ''}. Утсаа шалгана уу.`,
        url: d?.url ?? undefined,
        method: d?.method ?? undefined,
        requestBody: d?.requestBody ?? undefined,
        responseStatus: d?.responseStatus ?? undefined,
        responseBody: d?.responseBody ?? undefined,
      }),
    onError: (err: any) => {
      const data = err.response?.data;
      setSmsMsg({
        type: 'err',
        text: data?.message ?? err.message ?? 'Алдаа',
        // BadRequestException doesn't carry the structured URL/body fields
        // when it's serialised as { message }, so we surface whatever the
        // API echoes back; the URL is also embedded in the error message
        // text itself (see sms.service.ts).
        url: data?.url,
        responseStatus: data?.responseStatus,
        responseBody: data?.responseBody,
      });
    },
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="font-semibold mb-1">Дохио илгээх тест</h2>
      <p className="text-xs text-slate-500 mb-4">
        Жинхэнэ дохиолол үүсгэлгүйгээр (машин хурдалгахгүйгээр) имэйл/SMS суваг ажиллаж байгаа эсэхийг шалгана.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-2">Имэйл тест</div>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
            />
            <button
              onClick={() => {
                setEmailMsg(null);
                testEmail.mutate();
              }}
              disabled={!email || testEmail.isPending}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm whitespace-nowrap"
            >
              {testEmail.isPending ? 'Илгээж байна…' : 'Илгээх'}
            </button>
          </div>
          {emailMsg && (
            <div
              className={`mt-2 px-3 py-2 rounded-md text-xs ${
                emailMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
              }`}
            >
              {emailMsg.text}
            </div>
          )}
        </div>
        <div className="border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-2">SMS тест</div>
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="99XXXXXX"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
            />
            <button
              onClick={() => {
                setSmsMsg(null);
                testSms.mutate();
              }}
              disabled={!phone || testSms.isPending}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm whitespace-nowrap"
            >
              {testSms.isPending ? 'Илгээж байна…' : 'Илгээх'}
            </button>
          </div>
          {smsMsg && (
            <div
              className={`mt-2 px-3 py-2 rounded-md text-xs space-y-1 ${
                smsMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
              }`}
            >
              <div className="whitespace-pre-wrap">{smsMsg.text}</div>
              {(smsMsg.url || smsMsg.requestBody || smsMsg.responseBody) && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] opacity-80">Илгээсэн хүсэлтийн дэлгэрэнгүй</summary>
                  <div className="mt-1 space-y-1 font-mono text-[11px] break-all">
                    {smsMsg.url && (
                      <div>
                        <span className="opacity-60">{smsMsg.method ?? 'POST'} </span>
                        {smsMsg.url}
                      </div>
                    )}
                    {smsMsg.requestBody !== undefined && smsMsg.requestBody !== null && (
                      <div>
                        <span className="opacity-60">Body: </span>
                        {JSON.stringify(smsMsg.requestBody)}
                      </div>
                    )}
                    {smsMsg.responseStatus !== undefined && (
                      <div>
                        <span className="opacity-60">Status: </span>
                        {smsMsg.responseStatus}
                      </div>
                    )}
                    {smsMsg.responseBody && (
                      <div>
                        <span className="opacity-60">Response: </span>
                        {smsMsg.responseBody}
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FleetTrafficCards({ fleet, traffic }: { fleet: Overview['fleet']; traffic: Overview['traffic'] }) {
  const onlinePct = fleet.devicesTotal ? ((fleet.devicesOnline / fleet.devicesTotal) * 100).toFixed(0) : '0';
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">Флот</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Компани" value={fleet.companies} />
          <Stat label="Хэрэглэгч" value={fleet.users} />
          <Stat label="Нийт GPS" value={fleet.devicesTotal} />
          <Stat label="Идэвхтэй" value={fleet.devicesActive} />
          <Stat label="Online (5 мин)" value={`${fleet.devicesOnline} (${onlinePct}%)`} accent="emerald" />
          <Stat label="Хөдөлж байгаа" value={fleet.devicesMoving} />
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">Урсгал · Ачаалал</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Позиц / өнөөдөр" value={traffic.positionsToday.toLocaleString()} />
          <Stat label="Позиц / сүүл цаг" value={traffic.positionsLastHour.toLocaleString()} />
          <Stat label="Дохио / өнөөдөр" value={traffic.eventsToday} />
          <Stat
            label="Critical дохио"
            value={traffic.criticalToday}
            accent={traffic.criticalToday > 0 ? 'rose' : 'slate'}
          />
          <Stat label="Дунд. packet" value={`${traffic.avgPacketBytes} B`} />
          <Stat label="≈ Bandwidth" value={formatBits(traffic.bandwidthBpsEstimate)} />
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Позиц/сек дундаж: {traffic.positionsPerSecondAvg}/s · packet хэмжээ Teltonika AVL framing-аас тооцоолсон тоо.
        </div>
      </div>
    </div>
  );
}

function ResourcesCard({ r }: { r: Overview['resources'] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="font-semibold mb-4">Сервер нөөц</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="CPU тоо" value={r.cpuCount} />
        <Stat label="Load (1м)" value={r.loadAvg1.toFixed(2)} accent={r.loadAvg1 > r.cpuCount ? 'amber' : 'emerald'} />
        <Stat
          label="RAM ашиглалт"
          value={`${r.memoryPct}%`}
          accent={r.memoryPct > 85 ? 'rose' : r.memoryPct > 70 ? 'amber' : 'emerald'}
        />
        <Stat label="RAM total" value={formatBytes(r.memoryTotal)} />
        {r.disk && (
          <>
            <Stat label="Диск ашиглалт" value={`${((r.disk.used / r.disk.total) * 100).toFixed(1)}%`} />
            <Stat label="Диск free" value={formatBytes(r.disk.free)} />
          </>
        )}
        <Stat label="DB хэмжээ" value={r.dbSizeBytes != null ? formatBytes(r.dbSizeBytes) : '—'} />
        <Stat label="Redis memory" value={r.redisMemBytes != null ? formatBytes(r.redisMemBytes) : '—'} />
      </div>
    </div>
  );
}

function SecurityCard({ s }: { s: Overview['security'] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="font-semibold mb-4">Аюулгүй байдал</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Алдсан нэвтрэлт (24ц)"
          value={s.failedLogins24h}
          accent={s.failedLogins24h > 20 ? 'rose' : s.failedLogins24h > 5 ? 'amber' : 'emerald'}
        />
        <Stat
          label="Хориглосон үйлдэл (24ц)"
          value={s.deniedActions24h}
          accent={s.deniedActions24h > 10 ? 'amber' : 'emerald'}
        />
        <Stat label="Сүүлийн аудит" value={s.lastAuditAt ? new Date(s.lastAuditAt).toLocaleString() : '—'} />
        <Stat label="HTTPS" value={s.httpsEnforced ? 'On' : 'Off'} accent={s.httpsEnforced ? 'emerald' : 'rose'} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = 'slate',
}: {
  label: string;
  value: string | number;
  accent?: 'slate' | 'emerald' | 'amber' | 'rose';
}) {
  const bg: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-800',
    rose: 'bg-rose-50 text-rose-800',
  };
  return (
    <div className={`rounded-xl px-3 py-2 ${bg[accent]}`}>
      <div className="text-xs uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatBits(bps: number): string {
  if (bps < 1000) return `${bps.toFixed(0)} bps`;
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)} kbps`;
  return `${(bps / 1_000_000).toFixed(2)} Mbps`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
