// Teltonika AVL IO ID → human label / unit / scaling map used by the
// OBD widget. IDs are the FMx series (FMC150 etc.) defaults; older FMB
// firmware may shift some IDs by one or two. We only surface the
// parameters that matter to a fleet operator — RPM, coolant temp, DTC
// count, fuel level, voltage, VIN — and gracefully skip anything the
// device doesn't report.
//
// Source: Teltonika Wiki, "AVL ID list" page, FMC150 firmware 03.29.

export type ObdSignal = {
  io: string;            // attribute key in positions.attributes, e.g. "io_36"
  label: string;
  unit?: string;
  scale?: number;        // multiply raw by this to get the friendly unit
  decimals?: number;     // display precision
  // Many OBD PIDs report 0 when the engine is off — hiding zero keeps
  // the panel uncluttered. Set false for params where 0 is meaningful
  // (DTC count, voltage, fuel %).
  hideWhenZero?: boolean;
};

export const OBD_SIGNALS: ObdSignal[] = [
  // Power / GSM (not OBD but useful in the same panel).
  { io: 'io_66', label: 'Гадаад хүчдэл',    unit: 'V', scale: 0.001, decimals: 2, hideWhenZero: false },
  { io: 'io_67', label: 'Дотоод батарей',   unit: 'V', scale: 0.001, decimals: 2, hideWhenZero: false },
  { io: 'io_68', label: 'Батерейн гүйдэл',  unit: 'mA', hideWhenZero: true },
  { io: 'io_21', label: 'GSM signal',       unit: '/5', hideWhenZero: false },

  // OBD II PIDs reported by the FMC150 OBD II adapter (standard set).
  // IO id ranges: 31..51 + 56..61 fixed-size, plus 256+ for VIN.
  { io: 'io_30',  label: 'PID Number',                 hideWhenZero: true },
  { io: 'io_31',  label: 'OBD Speed',                  unit: 'km/h', hideWhenZero: true },
  { io: 'io_32',  label: 'DTC код тоо',                 unit: 'шт',   hideWhenZero: false },
  { io: 'io_33',  label: 'Engine Load',                unit: '%',    hideWhenZero: true },
  { io: 'io_34',  label: 'Coolant Temperature',        unit: '°C',   hideWhenZero: true },
  { io: 'io_35',  label: 'Short Fuel Trim',            unit: '%',    hideWhenZero: false },
  { io: 'io_36',  label: 'Fuel Pressure',              unit: 'kPa',  hideWhenZero: true },
  { io: 'io_37',  label: 'Intake MAP',                 unit: 'kPa',  hideWhenZero: true },
  { io: 'io_38',  label: 'Engine RPM',                 unit: 'rpm',  hideWhenZero: true },
  { io: 'io_39',  label: 'Vehicle Speed (OBD)',        unit: 'km/h', hideWhenZero: true },
  { io: 'io_40',  label: 'Timing Advance',             unit: '°',    hideWhenZero: true },
  { io: 'io_41',  label: 'Intake Air Temperature',     unit: '°C',   hideWhenZero: true },
  { io: 'io_42',  label: 'MAF',                        unit: 'g/s',  scale: 0.01, decimals: 2, hideWhenZero: true },
  { io: 'io_43',  label: 'Throttle Position',          unit: '%',    hideWhenZero: true },
  { io: 'io_44',  label: 'Run Time Since Engine Start', unit: 's',   hideWhenZero: true },
  { io: 'io_45',  label: 'Distance MIL ON',            unit: 'km',   hideWhenZero: false },
  { io: 'io_46',  label: 'Rel. Fuel Rail Pressure',    unit: 'kPa',  scale: 10, hideWhenZero: true },
  { io: 'io_47',  label: 'Direct Fuel Rail Pressure',  unit: 'kPa',  scale: 10, hideWhenZero: true },
  { io: 'io_48',  label: 'Commanded EGR',              unit: '%',    hideWhenZero: true },
  { io: 'io_49',  label: 'EGR Error',                  unit: '%',    hideWhenZero: false },
  { io: 'io_51',  label: 'Түлшний түвшин (CAN)',       unit: '%',    hideWhenZero: false },
  { io: 'io_53',  label: 'Absolute Load',              unit: '%',    hideWhenZero: true },
  { io: 'io_54',  label: 'Ambient Air Temperature',    unit: '°C',   hideWhenZero: true },
  { io: 'io_55',  label: 'Time MIL On',                unit: 'мин',  hideWhenZero: false },
  { io: 'io_56',  label: 'Time Since Codes Cleared',   unit: 'мин',  hideWhenZero: false },
  { io: 'io_57',  label: 'Abs. Fuel Rail Pressure',    unit: 'kPa',  scale: 10, hideWhenZero: true },
  { io: 'io_58',  label: 'Hybrid Battery Life',        unit: '%',    hideWhenZero: true },
  { io: 'io_59',  label: 'Engine Oil Temperature',     unit: '°C',   hideWhenZero: true },
  { io: 'io_60',  label: 'Fuel Injection Timing',      unit: '°',    hideWhenZero: true },
  { io: 'io_61',  label: 'Engine Fuel Rate',           unit: 'L/h',  scale: 0.01, decimals: 2, hideWhenZero: true },

  // Mileage / hours / ignition / sensors that we already promote to
  // top-level columns — included here so the OBD panel acts as a
  // single one-stop view.
  { io: 'io_16',  label: 'Total Odometer',             unit: 'km', scale: 0.001, decimals: 0, hideWhenZero: false },
  { io: 'io_234', label: 'Engine Hours',               unit: 'h',  scale: 1 / 3_600_000, decimals: 1, hideWhenZero: false },
  { io: 'io_239', label: 'Ignition',                                                            hideWhenZero: false },
  { io: 'io_240', label: 'Movement',                                                            hideWhenZero: false },

  // Variable-length / extended IDs. The Teltonika FMC150 wiki lists
  // VIN at AVL 256 when the OBD VIN auto-detect feature is enabled.
  // The ingestor stores the printable-ASCII payload under `io_256_str`
  // (the unsuffixed `io_256` holds the int64 truncation, which is
  // garbage for a 17-char VIN).
  { io: 'io_256_str', label: 'VIN дугаар',                                                      hideWhenZero: false },
];

export function decodeObd(payload: Record<string, any> | null | undefined): { sig: ObdSignal; value: string }[] {
  if (!payload) return [];
  const out: { sig: ObdSignal; value: string }[] = [];
  for (const sig of OBD_SIGNALS) {
    const raw = payload[sig.io];
    if (raw == null) continue;
    if (sig.hideWhenZero && Number(raw) === 0) continue;
    let display: string;
    if (typeof raw === 'string') {
      display = raw;
    } else {
      const v = sig.scale ? Number(raw) * sig.scale : Number(raw);
      display = Number.isFinite(v)
        ? (sig.decimals != null ? v.toFixed(sig.decimals) : v.toString())
        : String(raw);
    }
    out.push({ sig, value: sig.unit ? `${display} ${sig.unit}` : display });
  }
  return out;
}
