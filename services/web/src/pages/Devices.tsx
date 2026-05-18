import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { ExcelImport } from '../components/ExcelImport';
import { SensorsTab } from './devices/SensorsTab';
import { CommandsTab } from './devices/CommandsTab';
import { MessagesTab } from './devices/MessagesTab';
import { HealthTab } from './devices/HealthTab';
import { CountersTab } from './devices/CountersTab';
import { CustomFieldsTab } from './devices/CustomFieldsTab';
import { TripsTab } from './devices/TripsTab';

// "Машин · Төхөөрөмж" хуудас. Top filter bar (Гранж / Алба нэгж / төрөл /
// статус / search) + жагсаалт + "+ Шинэ машин" товчоор Gaikham шиг 5
// tab-тай (Үндсэн / GPS / Үзүүлэлт / Түлш / Даатгал) modal нээгдэнэ.

const VEHICLE_TYPES = [
  { value: 'HAUL_TRUCK',   label: 'Хэт том самосвал (БелАЗ)', icon: 'HaulTruck' },
  { value: 'DUMP_TRUCK',   label: 'Энгийн самосвал',           icon: 'DumpTruck' },
  { value: 'EXCAVATOR',    label: 'Экскаватор',                 icon: 'Excavator' },
  { value: 'BULLDOZER',    label: 'Бульдозер',                  icon: 'Bulldozer' },
  { value: 'GRADER',       label: 'Грейдер',                    icon: 'Grader' },
  { value: 'WHEEL_LOADER', label: 'Дугуйт ачигч',               icon: 'Loader' },
  { value: 'CRANE',        label: 'Кран',                       icon: 'Crane' },
  { value: 'DRILL_RIG',    label: 'Өрөмдөгч',                   icon: 'Drill' },
  { value: 'FUEL_TANKER',  label: 'Шатхуун цистерн',            icon: 'Tanker' },
  { value: 'WATER_TANKER', label: 'Усны цистерн',               icon: 'Water' },
  { value: 'BUS',          label: 'Автобус',                    icon: 'Bus' },
  { value: 'PICKUP',       label: 'Пикап',                      icon: 'Pickup' },
  { value: 'VAN',          label: 'Фургон',                     icon: 'Van' },
  { value: 'SEDAN',        label: 'Хөнгөн тэрэг',               icon: 'Sedan' },
  { value: 'TRACTOR',      label: 'Трактор',                    icon: 'Tractor' },
  { value: 'MOTORBIKE',    label: 'Мотоцикл',                   icon: 'Bike' },
  { value: 'OTHER',        label: 'Бусад',                      icon: 'Sedan' },
] as const;
type VehicleTypeValue = typeof VEHICLE_TYPES[number]['value'];

const FUEL_TYPES = [
  { value: 'DIESEL',   label: 'Дизель' },
  { value: 'GASOLINE', label: 'Бензин' },
  { value: 'LPG',      label: 'Шингэн хий (LPG)' },
  { value: 'CNG',      label: 'Шахмал хий (CNG)' },
  { value: 'ELECTRIC', label: 'Цахилгаан' },
  { value: 'HYBRID',   label: 'Гибрид' },
  { value: 'OTHER',    label: 'Бусад' },
] as const;

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#6b7280', '#0f172a',
];

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Идэвхтэй',
  INACTIVE: 'Идэвхгүй',
  MAINTENANCE: 'Засвар',
  DECOMMISSIONED: 'Хасагдсан',
};

// ── Page ──────────────────────────────────────────────────────
export function Devices() {
  const [groupId, setGroupId] = useState('');
  const [garageId, setGarageId] = useState('');
  const [vtype, setVtype] = useState<string>('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showGarage, setShowGarage] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showGpsGuide, setShowGpsGuide] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [statusTarget, setStatusTarget] = useState<any | null>(null);

  const params = new URLSearchParams();
  if (groupId) params.set('groupId', groupId);
  if (garageId) params.set('garageId', garageId);
  if (vtype) params.set('vehicleType', vtype);
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const devices = useQuery({
    queryKey: ['devices', params.toString()],
    queryFn: () => api.get(`/devices?${params.toString()}`).then((r) => r.data),
  });
  const garages = useQuery({
    queryKey: ['garages'],
    queryFn: () => api.get('/garages').then((r) => r.data),
  });
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then((r) => r.data),
  });
  // Driver list feeds the "Жолооч" picker in the device modal. Each device
  // can be assigned to at most one driver (Device.driverId); a driver can
  // own several devices.
  const drivers = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get('/drivers').then((r) => r.data),
  });

  const stats = useMemo(() => {
    const list: any[] = devices.data ?? [];
    return {
      total: list.length,
      online: list.filter((d) => d.online).length,
      active: list.filter((d) => d.status === 'ACTIVE').length,
      maintenance: list.filter((d) => d.status === 'MAINTENANCE').length,
    };
  }, [devices.data]);

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Машин · Төхөөрөмж</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Уурхайн флотын машин механизмын бүртгэл, гранж ба алба нэгжээр ангилан удирдана.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGpsGuide(true)}
              className="rounded-md border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-800 text-sm font-medium px-3 py-2"
              title="Teltonika FMC650 / бусад GPS төхөөрөмжийг яаж холбох вэ"
            >
              📡 GPS холболтын заавар
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2"
            >
              📂 Excel-ээс импортлох
            </button>
            <button
              onClick={() => setShowGarage(true)}
              className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2"
            >
              + Шинэ гранж
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 shadow"
            >
              + Шинэ машин
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Нийт" value={stats.total} accent="brand" />
          <Stat label="Онлайн" value={stats.online} accent="emerald" />
          <Stat label="Идэвхтэй" value={stats.active} accent="slate" />
          <Stat label="Засварт" value={stats.maintenance} accent="amber" />
        </div>
      </header>

      <div className="px-6 md:px-8 py-3 bg-white border-b border-slate-200">
        <div className="flex flex-wrap items-end gap-2">
          <FilterSelect
            label="Гранж"
            value={garageId}
            onChange={setGarageId}
            options={[{ value: '', label: 'Бүх гранж' }, ...(garages.data ?? []).map((g: any) => ({ value: g.id, label: g.name }))]}
          />
          <FilterSelect
            label="Алба нэгж"
            value={groupId}
            onChange={setGroupId}
            options={[{ value: '', label: 'Бүх алба' }, ...(groups.data ?? []).map((g: any) => ({ value: g.id, label: g.name }))]}
          />
          <FilterSelect
            label="Төрөл"
            value={vtype}
            onChange={setVtype}
            options={[{ value: '', label: 'Бүх төрөл' }, ...VEHICLE_TYPES.map((t) => ({ value: t.value, label: t.label }))]}
          />
          <FilterSelect
            label="Статус"
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'Бүх статус' },
              { value: 'ACTIVE', label: 'Идэвхтэй' },
              { value: 'INACTIVE', label: 'Идэвхгүй' },
              { value: 'MAINTENANCE', label: 'Засвар' },
              { value: 'DECOMMISSIONED', label: 'Хасагдсан' },
            ]}
          />
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">
              Хайх
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Нэр, IMEI, дугаар..."
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Машин</th>
                <th className="text-left px-4 py-3 font-semibold">IMEI</th>
                <th className="text-left px-4 py-3 font-semibold">Дугаар</th>
                <th className="text-left px-4 py-3 font-semibold">Жолооч</th>
                <th className="text-left px-4 py-3 font-semibold">Гранж</th>
                <th className="text-left px-4 py-3 font-semibold">Алба</th>
                <th className="text-left px-4 py-3 font-semibold">Статус</th>
                <th className="text-right px-4 py-3 font-semibold">Сүүлд</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {devices.isLoading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Уншиж байна…</td></tr>
              )}
              {!devices.isLoading && (devices.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <div className="text-slate-400 text-sm">Машин олдсонгүй</div>
                    <button
                      onClick={() => setShowAdd(true)}
                      className="mt-3 text-brand-700 hover:underline text-sm font-medium"
                    >
                      Эхний машинаа нэмье →
                    </button>
                  </td>
                </tr>
              )}
              {(devices.data ?? []).map((d: any) => {
                const tpl = VEHICLE_TYPES.find((t) => t.value === d.vehicleType);
                const color = d.color ?? '#1670f1';
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: color + '22', color }}
                        >
                          <span className="h-5 w-5"><VIcon name={tpl?.icon ?? 'Sedan'} /></span>
                        </div>
                        <div>
                          <div className="font-medium">{d.name}</div>
                          <div className="text-xs text-slate-500">{tpl?.label ?? '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">{d.imei}</td>
                    <td className="px-4 py-3 text-slate-600">{d.plateNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {d.driver?.fullName ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.garage?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{d.group?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-1',
                          d.online ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600',
                        )}
                      >
                        <span className={clsx('h-1.5 w-1.5 rounded-full', d.online ? 'bg-emerald-500' : 'bg-slate-400')} />
                        {d.online ? 'Онлайн' : STATUS_LABELS[d.status] ?? 'Офлайн'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 text-right">
                      {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('mn-MN') : '—'}
                    </td>
                    <td className="px-2 py-3">
                      <DeviceRowActions
                        device={d}
                        onEdit={() => setEditTarget(d)}
                        onCheck={() => setStatusTarget(d)}
                        onDelete={() => setDeleteTarget(d)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <AddVehicleModal
          garages={garages.data ?? []}
          groups={groups.data ?? []}
          drivers={drivers.data ?? []}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTarget && (
        <AddVehicleModal
          device={editTarget}
          garages={garages.data ?? []}
          groups={groups.data ?? []}
          drivers={drivers.data ?? []}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteDeviceModal device={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
      {statusTarget && (
        <ConnectionStatusModal device={statusTarget} onClose={() => setStatusTarget(null)} />
      )}
      {showGpsGuide && <GpsSetupGuideModal onClose={() => setShowGpsGuide(false)} />}
      {showGarage && <AddGarageModal onClose={() => setShowGarage(false)} />}
      {showImport && (
        <ExcelImport
          resource="devices"
          title="Машинуудыг Excel-ээс импортлох"
          invalidateKeys={['devices']}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ── Filter pieces ─────────────────────────────────────────────
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="min-w-[150px]">
      <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: 'brand' | 'emerald' | 'amber' | 'slate';
}) {
  const tint: Record<string, string> = {
    brand:   'text-brand-700 bg-brand-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    amber:   'text-amber-700 bg-amber-50',
    slate:   'text-slate-700 bg-slate-100',
  };
  return (
    <div className={`rounded-xl px-4 py-3 ${tint[accent]}`}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

// ── Add Vehicle Modal ─────────────────────────────────────────
type FormState = {
  imei: string; name: string;
  groupId: string; garageId: string; driverId: string;
  plateNumber: string; vin: string; color: string;
  vehicleType: VehicleTypeValue | ''; vehicleSubtype: string; model: string;
  simNumber: string;
  chassisLengthMm: string; chassisWidthMm: string; chassisHeightMm: string;
  payloadKg: string; grossWeightKg: string; seatCount: string;
  axleCount: string; wheelSize: string; wheelCount: string; trailerPlate: string;
  fuelType: string; fuelGrade: string;
  tankCapacityL: string; fuelConsumptionL100Km: string;
  insuranceContract1: string; insuranceUntil1: string;
  insuranceContract2: string; insuranceUntil2: string;
  speedLimit: string;
};
const EMPTY_FORM: FormState = {
  imei: '', name: '', groupId: '', garageId: '', driverId: '',
  plateNumber: '', vin: '', color: '#1670f1',
  vehicleType: 'HAUL_TRUCK', vehicleSubtype: '', model: '',
  simNumber: '',
  chassisLengthMm: '', chassisWidthMm: '', chassisHeightMm: '',
  payloadKg: '', grossWeightKg: '', seatCount: '',
  axleCount: '', wheelSize: '', wheelCount: '', trailerPlate: '',
  fuelType: 'DIESEL', fuelGrade: '',
  tankCapacityL: '', fuelConsumptionL100Km: '',
  insuranceContract1: '', insuranceUntil1: '',
  insuranceContract2: '', insuranceUntil2: '',
  speedLimit: '',
};

function AddVehicleModal({
  garages,
  groups,
  drivers,
  device,
  onClose,
}: {
  garages: any[];
  groups: any[];
  drivers: any[];
  device?: any;
  onClose: () => void;
}) {
  const isEdit = !!device;
  // Top-level tabs. The runtime / GPS-device-related views (sensors, commands,
  // messages, counters, health) live as sub-tabs under "gps" so the modal
  // header stays compact even for a saved device.
  type Tab = 'basic' | 'gps' | 'specs' | 'fuel' | 'trips' | 'insurance' | 'custom';
  type GpsSub = 'config' | 'sensors' | 'commands' | 'messages' | 'counters' | 'health';
  const [tab, setTab] = useState<Tab>('basic');
  const [gpsSub, setGpsSub] = useState<GpsSub>('config');
  // The runtime / view-only tabs persist their own state — they don't
  // round-trip through this modal's Save button. We hide the Save CTA
  // (and rename Cancel → Close) whenever one of them is active.
  const isRuntime =
    tab === 'trips' ||
    tab === 'custom' ||
    (tab === 'gps' && gpsSub !== 'config');
  const [form, setForm] = useState<FormState>(() => device ? deviceToForm(device) : EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: (payload: any) =>
      isEdit
        ? api.patch(`/devices/${device.id}`, payload).then((r) => r.data)
        : api.post('/devices', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      // Driver list embeds the assigned devices, so it needs to refresh too.
      qc.invalidateQueries({ queryKey: ['drivers'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа гарлаа');
    },
  });

  const submit = () => {
    setError(null);
    if (!isEdit && !/^\d{14,16}$/.test(form.imei)) {
      setError('IMEI 14–16 оронтой тоо байх ёстой'); setTab('gps'); return;
    }
    if (form.name.trim().length < 2) {
      setError('Машины нэрийг 2-оос дээш тэмдэгтээр оруулна уу'); setTab('basic'); return;
    }
    const payload: Record<string, any> = { name: form.name.trim() };
    if (!isEdit) payload.imei = form.imei.trim();
    const strKeys: (keyof FormState)[] = [
      'plateNumber', 'vin', 'color', 'vehicleSubtype', 'model', 'simNumber',
      'wheelSize', 'trailerPlate', 'fuelGrade',
      'insuranceContract1', 'insuranceContract2',
    ];
    for (const k of strKeys) {
      const v = form[k] as string;
      if (v && v.trim()) payload[k] = v.trim();
    }
    if (form.vehicleType) payload.vehicleType = form.vehicleType;
    if (form.fuelType)    payload.fuelType = form.fuelType;
    if (form.groupId)  payload.groupId  = form.groupId;
    if (form.garageId) payload.garageId = form.garageId;
    // On edit we send `driverId: null` to unassign — on create we just skip.
    if (form.driverId) payload.driverId = form.driverId;
    else if (isEdit)   payload.driverId = null;
    const intKeys: (keyof FormState)[] = [
      'chassisLengthMm', 'chassisWidthMm', 'chassisHeightMm',
      'payloadKg', 'grossWeightKg', 'seatCount',
      'axleCount', 'wheelCount',
    ];
    for (const k of intKeys) {
      const v = form[k] as string;
      if (v !== '') {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) payload[k] = n;
      }
    }
    const floatKeys: (keyof FormState)[] = ['tankCapacityL', 'fuelConsumptionL100Km', 'speedLimit'];
    for (const k of floatKeys) {
      const v = form[k] as string;
      if (v !== '') {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) payload[k] = n;
      }
    }
    if (form.insuranceUntil1) payload.insuranceUntil1 = new Date(form.insuranceUntil1).toISOString();
    if (form.insuranceUntil2) payload.insuranceUntil2 = new Date(form.insuranceUntil2).toISOString();

    mutation.mutate(payload);
  };

  return (
    <ModalShell title={isEdit ? `Машин засах · ${device.name}` : 'Шинэ машин'} onClose={onClose} fixedHeight>
      <div className="flex flex-wrap border-b border-slate-200 bg-slate-50">
        {([
          { id: 'basic',     label: 'Үндсэн',     always: true },
          { id: 'gps',       label: 'GPS',        always: true },
          { id: 'specs',     label: 'Үзүүлэлт',   always: true },
          { id: 'fuel',      label: 'Түлш',       always: true },
          { id: 'trips',     label: 'Замууд',     always: false },
          { id: 'insurance', label: 'Даатгал',    always: true },
          { id: 'custom',    label: 'Нэмэлт',     always: false },
        ] as { id: Tab; label: string; always: boolean }[])
          .filter((t) => t.always || isEdit)
          .map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as any)}
            className={clsx(
              'px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap',
              tab === t.id
                ? 'border-brand-600 text-brand-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'basic' && (
          <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
            <Field label="Машины нэр *" hint="Дотооддоо ялгах нэр. Жишээ: 'Самосвал №14' эсвэл 'БелАЗ-12'." tooltip="Энэ нэр газрын зураг, тайлан, дохиолол бүгдэд харагдана. Хэрэглэгчид ойлгомжтой богино нэр сонгоорой.">
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Жишээ: Самосвал №14" className={input} />
            </Field>
            <Field label="Улсын дугаар" hint="Жишээ: 1234УБА">
              <input value={form.plateNumber} onChange={(e) => set('plateNumber', e.target.value)} placeholder="1234УБА" className={input} />
            </Field>
            <Field label="VIN" hint="17 оронтой араан дугаар. Хайчилбар дээр сийлмэл байдаг." tooltip="Vehicle Identification Number — олон улсын стандарт. Заавал биш ч даатгал, замын цагдаагийн тайланд хэрэгтэй.">
              <input value={form.vin} onChange={(e) => set('vin', e.target.value)} placeholder="WBA12345678901234" className={input} />
            </Field>

            <Field label="Гранж" hint="Машин ямар физик байршилд байрладаг (depot)." tooltip="Машин үүсгэхээс өмнө '+ Шинэ гранж' товчоор гранж нэмж болно.">
              <select value={form.garageId} onChange={(e) => set('garageId', e.target.value)} className={input}>
                <option value="">— Сонгох —</option>
                {garages.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
              </select>
              {garages.length === 0 && (
                <div className="text-[11px] text-amber-700 mt-1">
                  Гранж бүртгэгдээгүй. Хэрэгтэй бол "+ Шинэ гранж" товчоор үүсгэнэ үү.
                </div>
              )}
            </Field>
            <Field label="Алба нэгж" hint="Машиныг ямар хэлтэст харьяалуулах." tooltip="Жнь: 'Зам барилгын алба', 'Ачаа тээвэр', 'Уулын экскаваторын алба'. Алба нэгжийг 'Алба нэгж' цэснээс нэмж/засна.">
              <select value={form.groupId} onChange={(e) => set('groupId', e.target.value)} className={input}>
                <option value="">— Сонгох —</option>
                {groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
              </select>
              {groups.length === 0 && (
                <div className="text-[11px] text-amber-700 mt-1">
                  Алба нэгж бүртгэгдээгүй. <b>"Алба нэгж"</b> цэснээс нэмнэ үү.
                </div>
              )}
            </Field>

            <Field label="Жолооч" className="md:col-span-2" hint="Тухайн машиныг хариуцах жолооч." tooltip="Жолоочийг 'Жолооч · Ажилчид' цэснээс үүсгэсэн байх ёстой. Нэг машинд нэг жолооч; нэг жолооч хэдэн ч машинтай байж болно. Хоосон үлдээвэл хариуцагчгүй гэж тооцогдоно — салгахдаа '— Жолооч хуваарилаагүй —' сонго.">
              <select value={form.driverId} onChange={(e) => set('driverId', e.target.value)} className={input}>
                <option value="">— Жолооч хуваарилаагүй —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}{d.employeeId ? ` · ${d.employeeId}` : ''}
                  </option>
                ))}
              </select>
              {drivers.length === 0 && (
                <div className="text-[11px] text-amber-700 mt-1">
                  Жолооч бүртгэгдээгүй. <b>"Жолооч · Ажилчид"</b> цэснээс нэмнэ үү.
                </div>
              )}
            </Field>

            <Field label="Машины төрөл" className="md:col-span-2">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {VEHICLE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set('vehicleType', t.value)}
                    className={clsx(
                      'flex flex-col items-center gap-1.5 rounded-lg border p-2 transition',
                      form.vehicleType === t.value
                        ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-200'
                        : 'border-slate-200 hover:border-brand-300',
                    )}
                  >
                    <span
                      className="h-7 w-7"
                      style={{ color: form.vehicleType === t.value ? (form.color || '#1670f1') : '#475569' }}
                    >
                      <VIcon name={t.icon} />
                    </span>
                    <span className="text-[10px] text-slate-600 text-center leading-tight">{t.label}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Дэд төрөл (текст)" className="md:col-span-2">
              <input value={form.vehicleSubtype} onChange={(e) => set('vehicleSubtype', e.target.value)} placeholder="Жишээ: БелАЗ 75131" className={input} />
            </Field>

            <Field label="Өнгө" className="md:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set('color', c)}
                    title={c}
                    className={clsx(
                      'h-7 w-7 rounded-md border-2 transition',
                      form.color === c ? 'border-slate-900 scale-110' : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </Field>
          </div>
        )}

        {tab === 'gps' && (
          <div className="space-y-4">
            {/* Sub-tab nav. The runtime views (sensors / commands / messages /
                counters / health) only render once the device has been
                saved — they all depend on a real Device id. */}
            <div className="flex flex-wrap gap-1 bg-slate-100 rounded-lg p-1">
              {([
                { id: 'config',   label: 'Тохиргоо', always: true },
                { id: 'sensors',  label: 'Мэдрэгч',  always: false },
                { id: 'commands', label: 'Команд',   always: false },
                { id: 'messages', label: 'Мессеж',   always: false },
                { id: 'counters', label: 'Тоолуур',  always: false },
                { id: 'health',   label: 'Эрүүл',    always: false },
              ] as { id: GpsSub; label: string; always: boolean }[])
                .filter((s) => s.always || isEdit)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setGpsSub(s.id)}
                    className={clsx(
                      'px-3 py-1.5 text-xs font-semibold rounded-md transition whitespace-nowrap',
                      gpsSub === s.id
                        ? 'bg-white text-brand-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
            </div>

            {gpsSub === 'config' && (
              <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
                <Field label="IMEI *" hint="14-16 оронтой тоо. GPS төхөөрөмжийн дотоод ID. Үүсгэсний дараа өөрчилж болохгүй." tooltip="IMEI нь GPS-н зөөврийн дугаар. Teltonika FMC650-н хувьд төхөөрөмжийн ард наалт дээр бичсэн байдаг (15 оронтой). Хэрэв олдохгүй бол төхөөрөмжид холбогдох тусгай команд (IMEI?) илгээж унших боломжтой.">
                  <input
                    value={form.imei}
                    onChange={(e) => set('imei', e.target.value.replace(/\D/g, ''))}
                    placeholder="352093081234567"
                    disabled={isEdit}
                    className={clsx(input, isEdit && 'bg-slate-100 text-slate-500')}
                  />
                </Field>
                <Field label="Модель" hint="GPS төхөөрөмжийн загвар. Жнь: FMC650, FMB920, GH5200." tooltip="Энэ нь GPS box-ын брэнд+загвар. Машины брэнд биш. Дэмжигдсэн загварууд: Teltonika (FMx цуврал), Queclink, Concox, Ruptela.">
                  <input value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="FMC650 / Teltonika..." className={input} />
                </Field>
                <Field label="SIM-ийн дугаар" hint="GPS төхөөрөмжид суусан SIM-ийн утасны дугаар." tooltip="SMS-р тохиргоо илгээх (жнь: APN, серверийн хаяг) болон асуудал гарвал утсаар хянахад ашиглагдана." className="md:col-span-2">
                  <input value={form.simNumber} onChange={(e) => set('simNumber', e.target.value)} placeholder="+97699112233" className={input} />
                </Field>
                <div className="md:col-span-2 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-900 px-3 py-2">
                  ℹ GPS төхөөрөмжийн сервер/порт/APN тохиргооны дэлгэрэнгүйг хуудасны дээд талын
                  <b> "📡 GPS холболтын заавар" </b> товчоор үзнэ үү.
                </div>
              </div>
            )}

            {isEdit && gpsSub === 'sensors'  && <SensorsTab deviceId={device.id} />}
            {isEdit && gpsSub === 'commands' && <CommandsTab deviceId={device.id} deviceOnline={device.online} />}
            {isEdit && gpsSub === 'messages' && <MessagesTab deviceId={device.id} />}
            {isEdit && gpsSub === 'counters' && <CountersTab deviceId={device.id} />}
            {isEdit && gpsSub === 'health'   && <HealthTab deviceId={device.id} />}
          </div>
        )}

        {tab === 'specs' && (
          <div className="grid md:grid-cols-3 gap-x-5 gap-y-4">
            <SectionTitle title="Хэмжээ (мм)" />
            <Field label="Урт"><input value={form.chassisLengthMm} onChange={(e) => set('chassisLengthMm', e.target.value)} placeholder="мм" className={input} /></Field>
            <Field label="Өргөн"><input value={form.chassisWidthMm} onChange={(e) => set('chassisWidthMm', e.target.value)} placeholder="мм" className={input} /></Field>
            <Field label="Өндөр"><input value={form.chassisHeightMm} onChange={(e) => set('chassisHeightMm', e.target.value)} placeholder="мм" className={input} /></Field>

            <SectionTitle title="Даацын мэдээлэл" />
            <Field label="Даац (кг)"><input value={form.payloadKg} onChange={(e) => set('payloadKg', e.target.value)} placeholder="кг" className={input} /></Field>
            <Field label="Нийт жин (кг)"><input value={form.grossWeightKg} onChange={(e) => set('grossWeightKg', e.target.value)} placeholder="кг" className={input} /></Field>
            <Field label="Зорчигчдын тоо"><input value={form.seatCount} onChange={(e) => set('seatCount', e.target.value)} className={input} /></Field>

            <SectionTitle title="Дугуй · тэнхлэг" />
            <Field label="Тэнхлэгийн тоо"><input value={form.axleCount} onChange={(e) => set('axleCount', e.target.value)} className={input} /></Field>
            <Field label="Дугуйн хэмжээ"><input value={form.wheelSize} onChange={(e) => set('wheelSize', e.target.value)} placeholder="R22.5..." className={input} /></Field>
            <Field label="Дугуйн нийт тоо"><input value={form.wheelCount} onChange={(e) => set('wheelCount', e.target.value)} className={input} /></Field>

            <SectionTitle title="Чиргүүл · хязгаар" />
            <Field label="Чиргүүлийн улсын дугаар"><input value={form.trailerPlate} onChange={(e) => set('trailerPlate', e.target.value)} className={input} /></Field>
            <Field label="Зөвшөөрөгдөх хурд (км/ц)"><input value={form.speedLimit} onChange={(e) => set('speedLimit', e.target.value)} placeholder="80" className={input} /></Field>
          </div>
        )}

        {tab === 'fuel' && (
          <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
            <Field label="Түлшний төрөл">
              <select value={form.fuelType} onChange={(e) => set('fuelType', e.target.value)} className={input}>
                <option value="">— Сонгох —</option>
                {FUEL_TYPES.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
              </select>
            </Field>
            <Field label="Түлшний зэрэг (АИ-92, DT-Л...)">
              <input value={form.fuelGrade} onChange={(e) => set('fuelGrade', e.target.value)} className={input} />
            </Field>
            <Field label="Бакны хэмжээ (Л)">
              <input value={form.tankCapacityL} onChange={(e) => set('tankCapacityL', e.target.value)} placeholder="800" className={input} />
            </Field>
            <Field label="Нормт зарцуулалт (Л/100км)">
              <input value={form.fuelConsumptionL100Km} onChange={(e) => set('fuelConsumptionL100Km', e.target.value)} placeholder="45" className={input} />
            </Field>
            <div className="md:col-span-2 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-900 px-3 py-2">
              ℹ Бодит цагийн шатхууны түвшин CAN-bus / fuel-probe мэдрэгчтэй машинд автоматаар уншигдана.
              Энд оруулсан утгууд нь тооцоо болон тайланд ашиглагдана.
            </div>
          </div>
        )}

        {tab === 'insurance' && (
          <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
            <Field label="Гэрээний дугаар №1">
              <input value={form.insuranceContract1} onChange={(e) => set('insuranceContract1', e.target.value)} className={input} />
            </Field>
            <Field label="Хүчинтэй хугацаа">
              <input type="date" value={form.insuranceUntil1} onChange={(e) => set('insuranceUntil1', e.target.value)} className={input} />
            </Field>
            <Field label="Гэрээний дугаар №2">
              <input value={form.insuranceContract2} onChange={(e) => set('insuranceContract2', e.target.value)} className={input} />
            </Field>
            <Field label="Хүчинтэй хугацаа">
              <input type="date" value={form.insuranceUntil2} onChange={(e) => set('insuranceUntil2', e.target.value)} className={input} />
            </Field>
          </div>
        )}

        {/* Standalone runtime tabs — only mounted for an existing device. */}
        {isEdit && tab === 'trips'  && <TripsTab deviceId={device.id} />}
        {isEdit && tab === 'custom' && <CustomFieldsTab deviceId={device.id} />}
      </div>

      {error && (
        <div className="mx-6 mb-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">
          {error}
        </div>
      )}
      <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
        <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">
          {isRuntime ? 'Хаах' : 'Цуцлах'}
        </button>
        {!isRuntime && (
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60"
          >
            {mutation.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
          </button>
        )}
      </div>
    </ModalShell>
  );
}

// ── Add Garage Modal ──────────────────────────────────────────
function AddGarageModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [capacity, setCapacity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/garages', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['garages'] });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Хадгалах үед алдаа гарлаа');
    },
  });

  return (
    <ModalShell title="Шинэ гранж" onClose={onClose} maxWidth="max-w-md">
      <div className="p-6 space-y-4">
        <Field label="Гранжийн нэр *">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Жишээ: Гол гранж" className={input} />
        </Field>
        <Field label="Хаяг">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Улаанбаатар, СБД..." className={input} />
        </Field>
        <Field label="Багтаамж (машины тоо)">
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} className={input} />
        </Field>
        {error && (
          <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>
        )}
      </div>
      <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
        <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">
          Цуцлах
        </button>
        <button
          onClick={() => {
            if (name.trim().length < 2) { setError('Нэрийг 2-оос дээш тэмдэгтээр оруулна уу'); return; }
            const payload: any = { name: name.trim() };
            if (address) payload.address = address;
            const n = parseInt(capacity, 10);
            if (!Number.isNaN(n)) payload.capacity = n;
            mutation.mutate(payload);
          }}
          disabled={mutation.isPending}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-60"
        >
          {mutation.isPending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Shared bits ───────────────────────────────────────────────
const input =
  'w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({
  label,
  hint,
  tooltip,
  children,
  className,
}: {
  label: string;
  hint?: string;
  tooltip?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">
        <span>{label}</span>
        {tooltip && <InfoTip text={tooltip} />}
      </label>
      {children}
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

// Click эсвэл hover-оор popover үзүүлдэг ⓘ icon.
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        className="text-slate-400 hover:text-brand-600 leading-none normal-case tracking-normal"
        aria-label="Тайлбар"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <span className="absolute left-5 top-0 z-20 w-64 bg-slate-900 text-white text-[11px] normal-case tracking-normal leading-relaxed px-3 py-2 rounded-md shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="md:col-span-3 text-xs uppercase tracking-widest text-slate-500 font-semibold border-b border-slate-100 pb-1 mt-2">
      {title}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  maxWidth = 'max-w-3xl',
  fixedHeight = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
  // When `true`, the modal locks to ~85vh so its overall size doesn't jump
  // as the user switches between tabs of different intrinsic heights.
  fixedHeight?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className={clsx(
        'w-full bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden',
        fixedHeight ? 'h-[85vh]' : 'max-h-[92vh]',
        maxWidth,
      )}>
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ── Vehicle icons (inline SVG, single file to keep things compact) ─
function VIcon({ name }: { name: string }) {
  const c: Record<string, ReactNode> = {
    HaulTruck: <><path d="M2 17h11l2-3h3l4 4v1h-2" /><path d="M2 7l3-3h5l4 4v9H2z" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></>,
    DumpTruck: <><path d="M2 16h10V8H2z" /><path d="M12 11h5l3 3v3h-8" /><path d="M3 8l2-3h5l2 3" /><circle cx="6" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
    Excavator: <><path d="M2 19h12v-3H2z" /><path d="M5 16V8h5l4 4-2 3" /><path d="M14 10l5-2 2 4-2 3" /><circle cx="6" cy="20" r="1.5" /><circle cx="12" cy="20" r="1.5" /></>,
    Bulldozer: <><path d="M3 18h11v-4H3z" /><path d="M2 14l1-5h6l1 3" /><path d="M14 12l5-1v6h-5" /><circle cx="6" cy="19" r="1.5" /><circle cx="12" cy="19" r="1.5" /></>,
    Grader:    <><path d="M3 16h17l-3-6h-8L7 13H3z" /><circle cx="6" cy="18" r="1.5" /><circle cx="12" cy="18" r="1.5" /><circle cx="18" cy="18" r="1.5" /></>,
    Loader:    <><path d="M3 17h10v-4H3z" /><path d="M3 13l3-4h5l2 2" /><path d="M13 13l5-1 3 3-1 3h-7" /><circle cx="6" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" /></>,
    Crane:     <><path d="M3 19h8v-4H3z" /><path d="M5 15V9h4v3" /><path d="M9 8l13 1" /><path d="M22 9l-3 6" /><circle cx="5" cy="20" r="1.4" /><circle cx="10" cy="20" r="1.4" /></>,
    Drill:     <><path d="M3 18h10v-3H3z" /><path d="M6 15V8h5v6" /><path d="M11 4v10" /><path d="M9 5l4 2-4 2" /><circle cx="5" cy="19" r="1.4" /><circle cx="11" cy="19" r="1.4" /></>,
    Tanker:    <><path d="M2 16h13V9H2z" /><circle cx="8.5" cy="12.5" r="2" /><path d="M15 11h5l2 2v3h-7" /><circle cx="6" cy="18" r="1.5" /><circle cx="18" cy="18" r="1.5" /></>,
    Water:     <><path d="M2 16h14V8H2z" /><path d="M4 12c2-2 4 2 6 0s4 2 6 0" /><circle cx="6" cy="18" r="1.5" /><circle cx="14" cy="18" r="1.5" /></>,
    Bus:       <><rect x="3" y="6" width="18" height="11" rx="2" /><path d="M3 13h18M7 6V4M17 6V4" /><circle cx="7" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>,
    Pickup:    <><path d="M2 16h9v-5H2z" /><path d="M11 11h5l4 3v2h-9" /><path d="M3 11l1-2h6v2" /><circle cx="6" cy="18" r="1.5" /><circle cx="17" cy="18" r="1.5" /></>,
    Van:       <><path d="M3 17V8h11l4 3v6" /><path d="M3 17h18" /><circle cx="7" cy="18" r="1.5" /><circle cx="17" cy="18" r="1.5" /></>,
    Sedan:     <><path d="M3 16h18l-2-5H7L4 14H3z" /><circle cx="7" cy="17" r="1.5" /><circle cx="17" cy="17" r="1.5" /></>,
    Tractor:   <><circle cx="16" cy="17" r="3" /><circle cx="6" cy="18" r="2" /><path d="M9 13V8h5v4M14 11l4 1v3" /></>,
    Bike:      <><circle cx="6" cy="17" r="3" /><circle cx="17" cy="17" r="3" /><path d="M6 17l4-7h5l2 7M10 10l3-4h3" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      {c[name] ?? c.Sedan}
    </svg>
  );
}

// ── Device row "..." menu ─────────────────────────────────────────
function DeviceRowActions({
  device, onEdit, onCheck, onDelete,
}: { device: any; onEdit: () => void; onCheck: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative flex justify-end">
      <button onClick={() => setOpen((v) => !v)} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Үйлдэл">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-56 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <button onClick={() => { setOpen(false); onEdit(); }} className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">✎ Засах</button>
          <button onClick={() => { setOpen(false); onCheck(); }} className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">📡 GPS холболт шалгах</button>
          <button onClick={() => { setOpen(false); onDelete(); }} className="block w-full text-left px-3 py-2 text-sm text-rose-700 hover:bg-rose-50">🗑 Устгах</button>
        </div>
      )}
    </div>
  );
}

// ── Delete device modal ───────────────────────────────────────────
function DeleteDeviceModal({ device, onClose }: { device: any; onClose: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.delete(`/devices/${device.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); onClose(); },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Устгах үед алдаа');
    },
  });
  const canDelete = confirmText.trim() === device.imei;
  return (
    <ModalShell title="Машин устгах" onClose={onClose} maxWidth="max-w-md">
      <div className="p-6 space-y-3">
        <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
          <b>{device.name}</b> ({device.imei})-г бүрмөсөн устгах гэж байна.
        </div>
        <p className="text-sm text-slate-700">
          GPS-н түүх (positions), үйл явдал, дохиолол, засварын ажил бүгд цацарч устгагдана.
          Энэ үйлдлийг буцаах боломжгүй.
        </p>
        <p className="text-sm text-slate-700">Баталгаажуулахын тулд IMEI-г бичээрэй:</p>
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={device.imei} className={input} />
        <p className="text-xs text-slate-500">
          💡 Машин түр ашиглахгүй бол <b>"Засах"</b> → статусыг <b>"Идэвхгүй"</b> болгох арга илүү тохиромжтой.
        </p>
        {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">{error}</div>}
      </div>
      <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
        <button onClick={onClose} className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2">Цуцлах</button>
        <button onClick={() => mutation.mutate()} disabled={!canDelete || mutation.isPending} className="rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {mutation.isPending ? 'Устгаж байна…' : 'Бүрмөсөн устгах'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── GPS connection status modal ───────────────────────────────────
function ConnectionStatusModal({ device, onClose }: { device: any; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['devices', device.id],
    queryFn: () => api.get(`/devices/${device.id}`).then((r) => r.data),
    refetchInterval: 5_000,
  });
  const d = detail.data ?? device;
  const lastSeen = d.lastSeenAt ? new Date(d.lastSeenAt) : null;
  const seconds = lastSeen ? Math.round((Date.now() - lastSeen.getTime()) / 1000) : null;
  const online = !!d.online || (seconds !== null && seconds < 180);
  return (
    <ModalShell title={`GPS холболт · ${d.name}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="p-6 space-y-4">
        <div className={clsx(
          'rounded-lg p-4 flex items-center gap-3',
          online ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200',
        )}>
          <div className={clsx('h-3 w-3 rounded-full animate-pulse', online ? 'bg-emerald-500' : 'bg-rose-500')} />
          <div>
            <div className={clsx('text-base font-bold', online ? 'text-emerald-900' : 'text-rose-900')}>
              {online ? 'Холбогдсон' : 'Холбогдоогүй'}
            </div>
            <div className="text-xs text-slate-700">
              {lastSeen
                ? <>Сүүлд: <b>{formatRelative(seconds!)}</b> өмнө ({lastSeen.toLocaleString('mn-MN')})</>
                : <>GPS-аас ямар нэг мэдээ хүлээж аваагүй байна</>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat2 label="IMEI" value={d.imei} mono />
          <Stat2 label="Модель" value={d.model ?? '—'} />
          <Stat2 label="Протокол" value={d.protocol ?? 'Тодорхойгүй'} />
          <Stat2 label="Хурд" value={d.lastSpeed != null ? `${d.lastSpeed.toFixed(1)} km/h` : '—'} />
          <Stat2 label="Батарей" value={d.batteryVolt != null ? `${d.batteryVolt.toFixed(1)} V` : '—'} />
          <Stat2 label="Хөдөлгүүр" value={d.ignitionOn == null ? '—' : (d.ignitionOn ? 'Асаалттай' : 'Унтраалттай')} />
          <Stat2 label="Одометр" value={d.odometerKm != null ? `${d.odometerKm.toFixed(0)} km` : '—'} />
          <Stat2 label="Бүртгэсэн" value={d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'} />
        </div>

        {!online && (
          <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2 space-y-1">
            <div className="font-semibold">Холбогдоогүй бол шалгах:</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>GPS төхөөрөмжийн SIM-д интернет багц байгаа эсэх</li>
              <li>Машины асаалт ON эсэх (GPS унтарсан байж магадгүй)</li>
              <li>APN, серверийн хаяг, порт зөв тохируулсан эсэх — дээрх "📡 GPS холболтын заавар" харна уу</li>
              <li>IMEI зөв оруулсан эсэх (төхөөрөмж дээрх наалттай тулгах)</li>
            </ol>
          </div>
        )}

        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['devices', device.id] })}
          disabled={detail.isFetching}
          className="w-full rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium py-2 text-slate-700 disabled:opacity-50"
        >
          🔄 {detail.isFetching ? 'Шалгаж байна…' : 'Дахин шалгах'} (5 сек тутамд автоматаар сэргээгдэнэ)
        </button>
      </div>
    </ModalShell>
  );
}

function Stat2({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className={clsx('text-slate-900 mt-0.5', mono && 'font-mono text-xs tabular-nums')}>{value}</div>
    </div>
  );
}

function formatRelative(seconds: number): string {
  if (seconds < 60) return `${seconds} сек`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} цаг`;
  return `${Math.floor(seconds / 86400)} өдөр`;
}

// ── GPS setup guide modal (Teltonika FMC650 + бусад) ──────────────
function GpsSetupGuideModal({ onClose }: { onClose: () => void }) {
  const host = window.location.hostname;
  const ingestorPort = 5027;
  return (
    <ModalShell title="GPS төхөөрөмж холбох заавар" onClose={onClose}>
      <div className="p-6 space-y-5 overflow-y-auto">
        <div className="bg-gradient-to-br from-brand-50 to-white border border-brand-200 rounded-xl p-4 text-sm">
          <div className="font-bold text-brand-900 mb-1">Серверийн тохиргоо</div>
          <p className="text-slate-700">
            Дараах хаяг + портыг GPS төхөөрөмжийн "сервер" талбарт оруулна. Бүх Teltonika / Queclink /
            Concox загвар адил параметртэй.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-sm">
            <CopyRow label="Серверийн хаяг" value={host} />
            <CopyRow label="Порт" value={String(ingestorPort)} />
            <CopyRow label="Протокол" value="TCP" />
            <CopyRow label="APN (Mobicom)" value="internet" />
          </div>
        </div>

        <div>
          <h3 className="font-bold text-slate-900 mb-2">📦 Teltonika FMC650 (заавар)</h3>
          <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1.5">
            <li><b>Teltonika Configurator</b>-г USB-ээр холбож суулгана уу. (FMC650-н хувьд "FMx Configurator")</li>
            <li>Зүүн талын меню — <b>GPRS</b> → <b>GPRS Settings</b>:
              <ul className="list-disc list-inside ml-5 mt-1 text-xs text-slate-600">
                <li>APN: <code>internet</code> (Mobicom), <code>unitelnet</code> (Unitel) эсвэл операторын зааснаар</li>
                <li>APN username / password: хоосон (Монголын ихэнх оператор)</li>
              </ul>
            </li>
            <li><b>GPRS Settings → Server Settings</b>:
              <ul className="list-disc list-inside ml-5 mt-1 text-xs text-slate-600">
                <li>Domain: <code className="font-mono">{host}</code></li>
                <li>Port: <code className="font-mono">{ingestorPort}</code></li>
                <li>Protocol: <b>TCP</b></li>
              </ul>
            </li>
            <li><b>System → Sleep Mode</b>: "No Sleep" эсвэл "Online Sleep" сонгож, төхөөрөмж унтрахаас сэргийлнэ.</li>
            <li><b>Data Acquisition</b>: On Move / On Stop тэмдэгтийг ON, давтамжийг 30-60 сек тогтооно.</li>
            <li><b>Save to device</b> товч даран хадгална. Машины асаалтыг түр унтрааж асаахад серверт холбогдоно.</li>
          </ol>
        </div>

        <div>
          <h3 className="font-bold text-slate-900 mb-2">📲 Зайнаас SMS-ээр тохируулах (FMC650)</h3>
          <div className="rounded-md bg-slate-900 text-emerald-200 font-mono text-xs px-3 py-3 leading-relaxed whitespace-pre-wrap">
{`  setparam 2001:internet
  setparam 2004:${host}
  setparam 2005:${ingestorPort}
  setparam 2006:0
  saveconfig`}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            SMS-н эхэнд төхөөрөмжийн нууц үг (default: <code>...</code>) бичих ёстой. Жнь:
            <code className="ml-1">  setparam 2004:{host}</code>
          </p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900 mb-2">✅ Холбогдсон эсэхийг шалгах</h3>
          <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1.5">
            <li>"+ Шинэ машин" товчоор уг IMEI-тэй машин нэмнэ</li>
            <li>Машины мөрөн дээрх "..." → <b>"GPS холболт шалгах"</b> дарна</li>
            <li>5 сек тутамд автомат сэргээгдэнэ — холбогдсон бол ногоон "Холбогдсон" болно</li>
            <li>Эхний position ирэхэд "Шууд газрын зураг" хуудсанд машин гарч ирнэ</li>
          </ol>
        </div>

        <div className="rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900 px-3 py-2">
          <b>Анхааруулга:</b> Зарим оператор-ын firewall-аас болоод TCP порт хаагдсан байж болно.
          Холбогдохгүй бол операторт хандаж <b>port {ingestorPort} outgoing</b>-г нээлгээрэй.
        </div>
      </div>
      <div className="border-t border-slate-200 px-6 py-3 flex justify-end bg-slate-50">
        <button onClick={onClose} className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2">Ойлголоо</button>
      </div>
    </ModalShell>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="text-slate-900 truncate">{value}</span>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="shrink-0 text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded normal-case"
        >
          {copied ? '✓' : 'Хуулах'}
        </button>
      </div>
    </div>
  );
}

// device → form мapping (edit modal pre-population).
function deviceToForm(d: any): FormState {
  const dateStr = (x: any) => (x ? new Date(x).toISOString().slice(0, 10) : '');
  const s = (x: any) => (x == null ? '' : String(x));
  return {
    imei: s(d.imei), name: s(d.name),
    groupId: s(d.groupId), garageId: s(d.garageId),
    driverId: s(d.driverId ?? d.driver?.id),
    plateNumber: s(d.plateNumber), vin: s(d.vin), color: s(d.color) || '#1670f1',
    vehicleType: (d.vehicleType ?? '') as any, vehicleSubtype: s(d.vehicleSubtype), model: s(d.model),
    simNumber: s(d.simNumber),
    chassisLengthMm: s(d.chassisLengthMm), chassisWidthMm: s(d.chassisWidthMm), chassisHeightMm: s(d.chassisHeightMm),
    payloadKg: s(d.payloadKg), grossWeightKg: s(d.grossWeightKg), seatCount: s(d.seatCount),
    axleCount: s(d.axleCount), wheelSize: s(d.wheelSize), wheelCount: s(d.wheelCount), trailerPlate: s(d.trailerPlate),
    fuelType: s(d.fuelType), fuelGrade: s(d.fuelGrade),
    tankCapacityL: s(d.tankCapacityL), fuelConsumptionL100Km: s(d.fuelConsumptionL100Km),
    insuranceContract1: s(d.insuranceContract1), insuranceUntil1: dateStr(d.insuranceUntil1),
    insuranceContract2: s(d.insuranceContract2), insuranceUntil2: dateStr(d.insuranceUntil2),
    speedLimit: s(d.speedLimit),
  };
}
