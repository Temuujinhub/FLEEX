// Teltonika model capability catalog. Maps a device's free-text `model`
// string (e.g. "FMC125", "FMC650 / Teltonika") to a structured description
// of what the device can do *out of the box* — i.e. with no extra
// peripherals wired — plus what each onboard interface unlocks when an
// accessory is attached, and recommended fleet use-cases.
//
// The point: every FMx tracker ships with a 3-axis accelerometer (the
// "G-Sensor"), GNSS, GSM/4G and power sensing. That alone yields driver
// behaviour (harsh accel/brake/cornering, green driving, crash, towing),
// movement, ignition, voltage and jamming detection — no fuel probe,
// camera or CAN adapter required. Higher models add more I/O, CAN/OBD and
// offline logging. We surface that per-model so an operator picking or
// reviewing a device knows exactly what data to expect.
//
// Accuracy note: capabilities are described at the functional level and
// kept consistent with this repo (see devices/obdSignals.ts and the
// events-engine IO constants). Exact electrical specs (battery mAh, LTE
// category, I/O counts) should be confirmed against the Teltonika wiki /
// datasheet for the precise firmware in use.

export type BuiltInSignal = {
  // Attribute key as stored in positions.attributes / raw payload, so the
  // UI can cross-reference what the device is *actually* sending live.
  io: string;
  label: string;
  // What this signal lets the operator do.
  use: string;
};

export type ModelInterface = {
  name: string;        // 'RS232', '1-Wire', 'DOUT', 'CAN/OBD', 'Bluetooth'
  enables: string;     // what attaching an accessory here unlocks
  builtIn?: boolean;   // true when the port yields data with no accessory
};

export type DeviceModelSpec = {
  key: string;             // canonical model key, e.g. 'FMC125'
  match: string[];         // upper-cased substrings to match the free-text model
  name: string;            // display name
  family: string;          // 'Teltonika FMx'
  formFactor: string;      // short Mongolian descriptor
  connectivity: string;    // radio + GNSS summary
  // Capabilities that work with NO extra peripheral attached.
  builtIn: BuiltInSignal[];
  // Onboard interfaces and what each unlocks (mostly accessory-dependent).
  interfaces: ModelInterface[];
  driverBehavior: boolean; // onboard G-Sensor → harsh/green driving
  engineCut: boolean;      // has a digital output that can drive an immobiliser relay
  offlineLog: boolean;     // microSD / large internal buffer for no-coverage zones
  useCases: string[];      // recommended fleet scenarios
  notDesignedFor?: string; // honest limitation
};

// Signals every FMx tracker reports from onboard sensors alone. Reused by
// most model entries below (spread in) so the list stays consistent.
const COMMON_BUILTIN: BuiltInSignal[] = [
  { io: 'gnss',    label: 'GNSS байршил, хурд, чиглэл, өндөр', use: 'Live map, замын түүх, geofence, одометр (GPS-based)' },
  { io: 'io_240',  label: 'Хөдөлгөөн (Movement)',             use: 'Зогссон/хөдөлж буй төлөв, idle тооцоо' },
  { io: 'io_239',  label: 'Асаалт (Ignition)',                use: 'Trip эхлэл/төгсгөл, ажилласан цаг' },
  { io: 'io_21',   label: 'GSM сүлжээний түвшин',              use: 'Холболтын чанар, сүлжээгүй бүс оношлох' },
  { io: 'io_66',   label: 'Гадаад тэжээлийн хүчдэл',           use: 'Машины аккумлятор хяналт, тэжээл салалт' },
  { io: 'io_67',   label: 'Дотоод нөөц батарей',              use: 'Тэжээл тасрахад үргэлжлүүлэн илгээх чадвар' },
  { io: 'io_247',  label: 'GSM jamming илрүүлэлт',             use: 'Дамжуулагч хаах оролдлогын дохиолол (tamper)' },
  { io: 'io_252',  label: 'Тэжээл салгалт (Unplug)',          use: 'GPS-г салгасан/огтолсон үед дохиолол' },
];

// The accelerometer-driven driver-behaviour signals. These feed the
// events-engine harsh/green-driving + crash/towing events directly.
const G_SENSOR_BUILTIN: BuiltInSignal[] = [
  { io: 'io_253', label: 'Green Driving (гангам жолоодлого)', use: 'Хурд хэтрэлт, гэнэтийн тоормос, хүчтэй эргэлт — жолоочийн соёл' },
  { io: 'io_257', label: 'Цохилт илрүүлэлт (Crash)',          use: 'Осол/мөргөлдөөний агшин дохиолол' },
  { io: 'io_246', label: 'Чирэлт илрүүлэлт (Towing)',         use: 'Зөвшөөрөлгүй чирэх/зөөх дохиолол' },
];

const GENERIC: DeviceModelSpec = {
  key: 'GENERIC',
  match: [],
  name: 'Teltonika FMx (ерөнхий)',
  family: 'Teltonika FMx',
  formFactor: 'GPS/GNSS tracker',
  connectivity: 'GSM/LTE + GNSS (загвар тус бүрд харилцан адилгүй)',
  builtIn: [...COMMON_BUILTIN, ...G_SENSOR_BUILTIN],
  interfaces: [
    { name: 'DIN/DOUT/AIN', enables: 'Дижитал орц/гарц, аналог мэдрэгч (загвараас хамаарна)' },
    { name: 'CAN/OBD',      enables: 'Машины CAN/OBD дата (адаптер эсвэл шууд холболт шаардаж болзошгүй)' },
  ],
  driverBehavior: true,
  engineCut: false,
  offlineLog: false,
  useCases: ['Үндсэн GPS хяналт', 'Жолоочийн зан төлөв (онбоорд G-Sensor)'],
  notDesignedFor: 'Тодорхой загвар таних боломжгүй — нарийн боломжийг загвараа оруулж тодотгоно уу.',
};

export const DEVICE_MODELS: DeviceModelSpec[] = [
  {
    key: 'FMC003',
    match: ['FMC003', 'FMB003', 'FMC001', 'FMB001'],
    name: 'Teltonika FMC003',
    family: 'Teltonika FMx (OBD dongle)',
    formFactor: 'OBD-II залгуур (утасгүй суурилуулалт)',
    connectivity: '4G LTE + GNSS + Bluetooth',
    builtIn: [
      ...COMMON_BUILTIN,
      ...G_SENSOR_BUILTIN,
      { io: 'io_36',  label: 'Хөдөлгүүрийн эргэлт (RPM) — OBD', use: 'OBD портоор шууд, нэмэлт холболтгүй' },
      { io: 'io_34',  label: 'Хөргөлтийн температур — OBD',     use: 'Хэт халалт хяналт' },
      { io: 'io_32',  label: 'DTC алдааны код тоо — OBD',        use: 'Хөдөлгүүрийн эвдрэлийн урьдчилсан дохио' },
      { io: 'io_256_str', label: 'VIN дугаар — OBD',             use: 'Машины VIN автоматаар таних' },
    ],
    interfaces: [
      { name: 'OBD-II', enables: 'Машины OBD дата (RPM, түлш, температур, VIN, DTC) — портод залгахад шууд', builtIn: true },
      { name: 'Bluetooth', enables: 'BLE температур/хаалга/түлш мэдрэгч утасгүй холбох' },
    ],
    driverBehavior: true,
    engineCut: false,
    offlineLog: false,
    useCases: [
      'Хөнгөн тэрэг — 2 минутын plug-and-play суурилуулалт',
      'OBD оношилгоо (DTC, RPM, түлш) + жолоочийн зан төлөв',
      'Түрээсийн авто, жижиг бизнесийн флот',
    ],
    notDesignedFor: 'Хөдөлгүүр блоклох реле (DOUT) байхгүй — immobiliser-д тохирохгүй. OBD-гүй хүнд техникт ашиглахгүй.',
  },
  {
    key: 'FMC125',
    match: ['FMC125', 'FMB125', 'FMC130', 'FMB130'],
    name: 'Teltonika FMC125',
    family: 'Teltonika FMx (advanced)',
    formFactor: 'Утсаар суурилуулдаг бүрэн I/O tracker',
    connectivity: '4G LTE + GNSS + Bluetooth',
    builtIn: [...COMMON_BUILTIN, ...G_SENSOR_BUILTIN],
    interfaces: [
      { name: 'DIN ×2', enables: 'Асаалт, хаалга, SOS товч, нэмэлт мэдрэгч' },
      { name: 'DOUT ×2', enables: 'Хөдөлгүүр блоклох реле, дохиур/гэрэл (immobiliser)' },
      { name: 'AIN ×1', enables: 'Аналог түлшний мэдрэгч, температур' },
      { name: 'RS232', enables: 'DualCam камер, LLS түлшний мэдрэгч' },
      { name: 'RS485', enables: 'Олон LLS түлшний мэдрэгч (нарийвчлалтай түлш)' },
      { name: '1-Wire', enables: 'iButton/RFID жолооч таних, Dallas температур' },
      { name: 'CAN', enables: 'Машины CAN дата (LV-CAN200/ALL-CAN300 адаптераар)' },
      { name: 'Bluetooth', enables: 'BLE сенсорууд утасгүй' },
    ],
    driverBehavior: true,
    engineCut: true,
    offlineLog: false,
    useCases: [
      'Бүрэн флотын тээврийн хэрэгсэл',
      'Хөдөлгүүр алсаас блоклох (DOUT + реле)',
      'Түлшний хяналт (RS485/RS232 LLS), DualCam камер',
      'Жолооч iButton/RFID-аар таних',
    ],
  },
  {
    key: 'FMC150',
    match: ['FMC150', 'FMB150', 'FMC640'],
    name: 'Teltonika FMC150',
    family: 'Teltonika FMx (advanced + OBD/CAN)',
    formFactor: 'Утсаар суурилуулдаг I/O + OBD/CAN tracker',
    connectivity: '4G LTE + GNSS + Bluetooth',
    builtIn: [
      ...COMMON_BUILTIN,
      ...G_SENSOR_BUILTIN,
      { io: 'io_36',  label: 'Хөдөлгүүрийн эргэлт (RPM) — OBD/CAN', use: 'OBD/CAN холболттой үед' },
      { io: 'io_34',  label: 'Хөргөлтийн температур — OBD/CAN',     use: 'Хэт халалт хяналт' },
      { io: 'io_32',  label: 'DTC алдааны код тоо — OBD/CAN',        use: 'Эвдрэлийн урьдчилсан дохио' },
      { io: 'io_51',  label: 'Түлшний түвшин (CAN)',                 use: 'Түлшний хяналт нэмэлт мэдрэгчгүй' },
      { io: 'io_256_str', label: 'VIN дугаар — OBD',                 use: 'VIN автоматаар таних' },
    ],
    interfaces: [
      { name: 'OBD-II/CAN', enables: 'Машины OBD/CAN дата (RPM, түлш, VIN, DTC) — холбоход шууд', builtIn: true },
      { name: 'DIN/DOUT', enables: 'Асаалт, хөдөлгүүр блоклох реле' },
      { name: 'AIN', enables: 'Аналог мэдрэгч' },
      { name: 'RS232/RS485', enables: 'DualCam камер, LLS түлшний мэдрэгч' },
      { name: '1-Wire', enables: 'iButton/RFID, Dallas температур' },
      { name: 'Bluetooth', enables: 'BLE сенсорууд' },
    ],
    driverBehavior: true,
    engineCut: true,
    offlineLog: false,
    useCases: [
      'OBD/CAN дататай хөнгөн ба дунд оврын авто',
      'Түлш + хөдөлгүүрийн параметр (RPM, температур, DTC)',
      'Хөдөлгүүр блоклох + жолооч таних',
    ],
  },
  {
    key: 'FMC650',
    match: ['FMC650', 'FMM650', 'FMB650', 'FMC920'],
    name: 'Teltonika FMC650',
    family: 'Teltonika Professional (MAX)',
    formFactor: 'Хүнд техник/мэргэжлийн tracker (microSD логтой)',
    connectivity: '4G LTE (хурдан) + GNSS + Bluetooth',
    builtIn: [
      ...COMMON_BUILTIN,
      ...G_SENSOR_BUILTIN,
      { io: 'sdlog', label: 'microSD офлайн лог', use: 'Сүлжээгүй бүсэд дата хадгалж, холбогдоход илгээх' },
    ],
    interfaces: [
      { name: 'DIN олон', enables: 'Олон дижитал орц (асаалт, хаалга, PTO, мэдрэгч)' },
      { name: 'DOUT олон', enables: 'Хөдөлгүүр блоклох + олон реле/дохиур' },
      { name: 'AIN', enables: 'Аналог мэдрэгчүүд' },
      { name: 'CAN ×2 (J1939)', enables: 'Хүнд машин/тракторын дата (түлш, цаг, температур, DEF)' },
      { name: 'RS232 ×2 / RS485', enables: 'Камер, олон LLS түлшний мэдрэгч' },
      { name: '1-Wire', enables: 'iButton/RFID, температур' },
    ],
    driverBehavior: true,
    engineCut: true,
    offlineLog: true,
    useCases: [
      'Уурхай/барилгын хүнд машин, тракторын флот',
      'J1939 CAN — хөдөлгүүрийн нарийн параметр',
      'Сүлжээгүй бүс — microSD офлайн лог (дараа sync)',
      'Олон сенсор/реле шаардсан мэргэжлийн суурилуулалт',
    ],
  },
];

// Normalise a free-text model string and match it to a catalog entry.
// Falls back to a generic FMx descriptor when nothing matches.
export function matchModel(model: string | null | undefined): {
  spec: DeviceModelSpec;
  matched: boolean;
} {
  const norm = (model ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (norm) {
    for (const spec of DEVICE_MODELS) {
      if (spec.match.some((m) => norm.includes(m))) {
        return { spec, matched: true };
      }
    }
  }
  return { spec: GENERIC, matched: false };
}
