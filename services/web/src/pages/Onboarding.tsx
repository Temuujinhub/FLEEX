import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../lib/api';

// Device-onboarding wizard: helps a new tenant get their first tracker online.
// Step 1 shows the exact server host / protocol port / APN to program into the
// device; step 2 "claims" the device by registering its IMEI (the ingestor
// resolves devices by IMEI and ignores unknown ones, so a created device =
// an allowed device); step 3 confirms and links onward.

interface ProtocolPort { protocol: string; port: number; label: string }
interface ApnPreset { carrier: string; apn: string; note?: string }
interface Connection { serverHost: string; ports: ProtocolPort[]; apns: ApnPreset[]; deviceCount: number }

export function Onboarding() {
  const conn = useQuery({ queryKey: ['onboarding', 'connection'], queryFn: () => api.get<Connection>('/onboarding/connection').then((r) => r.data) });
  const [step, setStep] = useState(1);

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <h1 className="text-2xl font-bold">Төхөөрөмж холбох</h1>
        <p className="text-sm text-slate-500 mt-0.5">GPS төхөөрөмжөө Fleex рүү холбох алхамууд.</p>
      </header>

      <div className="p-4 md:p-6 max-w-3xl space-y-5">
        <Steps step={step} />
        {conn.isLoading && <Card><div className="text-sm text-slate-500">Татаж байна…</div></Card>}
        {conn.data && (
          <>
            {step === 1 && <ConnectionStep c={conn.data} onNext={() => setStep(2)} />}
            {step === 2 && <ClaimStep onBack={() => setStep(1)} onDone={() => setStep(3)} ports={conn.data.ports} />}
            {step === 3 && <DoneStep onAddAnother={() => setStep(2)} />}
          </>
        )}
      </div>
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ['Холболтын тохиргоо', 'Төхөөрөмж бүртгэх', 'Дууссан'];
  return (
    <div className="flex items-center gap-2">
      {labels.map((l, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <div key={l} className="flex items-center gap-2">
            <div className={clsx('flex items-center gap-2 rounded-full px-3 py-1.5 text-sm', active ? 'bg-brand-600 text-white' : done ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-500 border border-slate-200')}>
              <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold', active ? 'bg-white/20' : done ? 'bg-emerald-200' : 'bg-slate-100')}>{done ? '✓' : n}</span>
              <span className="hidden sm:inline">{l}</span>
            </div>
            {n < labels.length && <div className="h-px w-4 bg-slate-300" />}
          </div>
        );
      })}
    </div>
  );
}

function ConnectionStep({ c, onNext }: { c: Connection; onNext: () => void }) {
  return (
    <Card>
      <SectionTitle>1. Төхөөрөмж дээрээ дараах тохиргоог хийнэ</SectionTitle>
      <p className="text-sm text-slate-600 mb-4">Трэкерийнхээ тохиргооны SMS/программ хангамжаар дараах <strong>сервер хаяг, порт</strong>-ыг оруулна. Порт нь төхөөрөмжийн протоколоос хамаарна.</p>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <CopyRow label="Сервер хаяг (Server / IP)" value={c.serverHost} />
        {c.ports.map((p) => (
          <CopyRow key={p.protocol} label={`Порт — ${p.label}`} value={`${c.serverHost}:${p.port}`} sub={`Протокол: ${p.protocol} · TCP ${p.port}`} />
        ))}
      </div>

      <SectionTitle className="mt-6">APN (SIM картын тохиргоо)</SectionTitle>
      <p className="text-sm text-slate-600 mb-3">SIM картын оператороо сонгож APN-г оруулна. Зарим M2M/IoT багц дээр өөр байж болох тул оператортойгоо баталгаажуулна уу.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {c.apns.map((a) => (
          <div key={a.carrier} className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{a.carrier}</span>
              <code className="text-sm rounded bg-slate-100 px-2 py-0.5">{a.apn}</code>
            </div>
            {a.note && <div className="text-[11px] text-slate-400 mt-0.5">{a.note}</div>}
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <button onClick={onNext} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold py-2 px-5">Үргэлжлүүлэх →</button>
      </div>
    </Card>
  );
}

function ClaimStep({ ports, onBack, onDone }: { ports: ProtocolPort[]; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [imei, setImei] = useState('');
  const [name, setName] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [protocol, setProtocol] = useState(ports[0]?.protocol ?? 'teltonika');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post('/devices', { imei: imei.trim(), name: name.trim(), protocol, plateNumber: plateNumber.trim() || undefined }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); qc.invalidateQueries({ queryKey: ['onboarding'] }); onDone(); },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Бүртгэл амжилтгүй боллоо.'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[0-9]{14,16}$/.test(imei.trim())) { setError('IMEI нь 14–16 оронтой тоо байх ёстой.'); return; }
    if (name.trim().length < 2) { setError('Нэрээ оруулна уу.'); return; }
    create.mutate();
  };

  const input = 'w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-brand-400';
  const label = 'block text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold';

  return (
    <Card>
      <SectionTitle>2. Төхөөрөмжөө бүртгэх</SectionTitle>
      <p className="text-sm text-slate-600 mb-4">Төхөөрөмжийн <strong>IMEI</strong>-г бүртгэснээр систем тухайн төхөөрөмжийн өгөгдлийг хүлээж авна. IMEI-г төхөөрөмжийн их бие эсвэл хайрцаг дээрээс олно.</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>IMEI (14–16 орон)</label>
          <input value={imei} onChange={(e) => setImei(e.target.value)} placeholder="86XXXXXXXXXXXXX" inputMode="numeric" className={input} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label}>Нэр / Машин</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Жнь: Ачааны 01" className={input} />
          </div>
          <div>
            <label className={label}>Улсын дугаар (заавал биш)</label>
            <input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} placeholder="1234 УБА" className={input} />
          </div>
        </div>
        <div>
          <label className={label}>Протокол</label>
          <select value={protocol} onChange={(e) => setProtocol(e.target.value)} className={input}>
            {ports.map((p) => <option key={p.protocol} value={p.protocol}>{p.label}</option>)}
          </select>
        </div>

        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}

        <div className="flex justify-between pt-1">
          <button type="button" onClick={onBack} className="rounded-md border border-slate-300 hover:bg-slate-100 text-sm py-2 px-4">← Буцах</button>
          <button type="submit" disabled={create.isPending} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold py-2 px-5 disabled:opacity-50">
            {create.isPending ? 'Бүртгэж байна…' : 'Бүртгэх'}
          </button>
        </div>
      </form>
    </Card>
  );
}

function DoneStep({ onAddAnother }: { onAddAnother: () => void }) {
  return (
    <Card>
      <div className="text-center py-4">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-2xl">✓</div>
        <SectionTitle className="justify-center">Төхөөрөмж бүртгэгдлээ</SectionTitle>
        <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">Төхөөрөмж тань серверт холбогдоод эхний байршлаа илгээмэгц газрын зураг дээр харагдана. Холбогдоход хэдэн минут зарцуулж болно.</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link to="/app/map" className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold py-2 px-5">Газрын зураг харах</Link>
          <Link to="/app/devices" className="rounded-md border border-slate-300 hover:bg-slate-100 text-sm py-2 px-4">Төхөөрөмжүүд</Link>
          <button onClick={onAddAnother} className="rounded-md border border-slate-300 hover:bg-slate-100 text-sm py-2 px-4">+ Дахин нэмэх</button>
        </div>
      </div>
    </Card>
  );
}

function CopyRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  };
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
        <div className="font-mono text-sm truncate">{value}</div>
        {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
      </div>
      <button onClick={copy} className="shrink-0 rounded-md border border-slate-300 hover:bg-slate-100 text-xs py-1.5 px-3">{copied ? 'Хуулсан ✓' : 'Хуулах'}</button>
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('flex items-center gap-2 text-sm font-semibold mb-1', className)}>{children}</div>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">{children}</div>;
}
