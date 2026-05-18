// Teltonika AVL IO ID → human label / unit / scaling map used by the
// OBD widget. We only surface the parameters that matter to a fleet
// operator (RPM, coolant temp, DTC count, ...). Anything unmapped stays
// hidden so the UI doesn't get noisy when a particular vehicle only
// reports a subset of OBD PIDs.
//
// The `scale` is what to multiply the raw value by to get a friendly
// unit. `decimals` controls display precision.

export type ObdSignal = {
  io: string;            // attribute key, e.g. "io_262"
  label: string;
  unit?: string;
  scale?: number;
  decimals?: number;
  // When the device explicitly returns a sentinel value (often 0 with no
  // OBD line), we hide it. Set `hideWhenZero: true` for params that
  // are commonly 0 with no real reading (RPM, Speed, MAF).
  hideWhenZero?: boolean;
};

export const OBD_SIGNALS: ObdSignal[] = [
  { io: 'io_30',  label: 'DTC код тоо',         unit: 'шт', hideWhenZero: false },
  { io: 'io_31',  label: 'Хөдөлгүүрийн ачаалал', unit: '%', hideWhenZero: true },
  { io: 'io_32',  label: 'Хөргөлтийн температур', unit: '°C', hideWhenZero: true },
  { io: 'io_36',  label: 'Хөдөлгүүрийн RPM',     unit: 'rpm', hideWhenZero: true },
  { io: 'io_37',  label: 'Хурд (CAN)',           unit: 'km/h', hideWhenZero: true },
  { io: 'io_38',  label: 'Timing Advance',       unit: '°', hideWhenZero: true },
  { io: 'io_39',  label: 'Хүлээн авах темп.',    unit: '°C', hideWhenZero: true },
  { io: 'io_41',  label: 'Throttle Position',    unit: '%', hideWhenZero: true },
  { io: 'io_42',  label: 'Run Time',             unit: 's', hideWhenZero: true },
  { io: 'io_43',  label: 'Distance MIL ON',      unit: 'km', hideWhenZero: true },
  { io: 'io_48',  label: 'Түлшний түвшин',       unit: '%', hideWhenZero: false },
  { io: 'io_51',  label: 'Тоормосны даралт',     unit: 'kPa', hideWhenZero: true },
  { io: 'io_52',  label: 'MAF',                  unit: 'g/s', scale: 0.01, decimals: 2, hideWhenZero: true },
  // Voltages — useful even outside OBD.
  { io: 'io_66',  label: 'Гадаад хүчдэл',        unit: 'V', scale: 0.001, decimals: 1, hideWhenZero: false },
  { io: 'io_67',  label: 'Дотоод батарей',       unit: 'V', scale: 0.001, decimals: 1, hideWhenZero: false },
  // Common Teltonika OBD PIDs (FMx CAN-OBD adapter). IDs vary by adapter
  // firmware — these match the standard FM-Bxxx / FMC150 set.
  { io: 'io_256', label: 'VIN дугаар',           hideWhenZero: false },
  { io: 'io_257', label: 'Engine Load',          unit: '%', hideWhenZero: true },
  { io: 'io_258', label: 'Coolant Temperature',  unit: '°C', hideWhenZero: true },
  { io: 'io_259', label: 'Short Fuel Trim',      unit: '%', hideWhenZero: false },
  { io: 'io_260', label: 'Fuel Pressure',        unit: 'kPa', hideWhenZero: true },
  { io: 'io_261', label: 'Intake MAP',           unit: 'kPa', hideWhenZero: true },
  { io: 'io_262', label: 'Engine RPM',           unit: 'rpm', hideWhenZero: true },
  { io: 'io_263', label: 'Vehicle Speed (OBD)',  unit: 'km/h', hideWhenZero: true },
  { io: 'io_264', label: 'Timing Advance',       unit: '°', hideWhenZero: true },
  { io: 'io_265', label: 'Intake Air Temperature', unit: '°C', hideWhenZero: true },
  { io: 'io_266', label: 'MAF',                  unit: 'g/s', scale: 0.01, decimals: 2, hideWhenZero: true },
  { io: 'io_267', label: 'Throttle Position',    unit: '%', hideWhenZero: true },
  { io: 'io_269', label: 'Distance MIL ON',      unit: 'km', hideWhenZero: false },
  { io: 'io_273', label: 'Fuel Level (CAN)',     unit: '%', hideWhenZero: false },
];

export function decodeObd(payload: Record<string, any> | null | undefined): { sig: ObdSignal; value: string }[] {
  if (!payload) return [];
  const out: { sig: ObdSignal; value: string }[] = [];
  for (const sig of OBD_SIGNALS) {
    const raw = payload[sig.io];
    if (raw == null) continue;
    if (sig.hideWhenZero && Number(raw) === 0) continue;
    const v = sig.scale ? Number(raw) * sig.scale : Number(raw);
    const display = Number.isFinite(v)
      ? (sig.decimals != null ? v.toFixed(sig.decimals) : v.toString())
      : String(raw);
    out.push({ sig, value: sig.unit ? `${display} ${sig.unit}` : display });
  }
  return out;
}
