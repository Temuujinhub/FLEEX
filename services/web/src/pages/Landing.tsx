import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, API_BASE } from '../lib/api';

// Default copy when the operator has not customised the landing page
// through the super-admin settings page. The CMS-backed values
// override these when present.
const DEFAULT_HERO_TAGLINE = 'Уурхайн жолоочдыг хамгаалж, шифт KPI-г автоматжуулсан флот удирдлага';
const DEFAULT_HERO_SUBTEXT =
  'Уул уурхайн HSE policy шаардлагуудыг код-гүй биелүүлсэн систем. Lone-worker автомат сэрэмжлүүлэг, panic ⇒ ойролцоох жолоочдод 30 секундийн дотор тусламж, идэвхгүй цагийн нэхэмжлэлийн Excel, ээлжийн тайлан, засварын урьдчилсан тооцоо. Teltonika Pro GPS дээр суурилсан, монгол хэлтэй, Монголд hosting хийсэн.';

// Fallback Unsplash photos for every image slot. The CMS overrides these
// when the super admin uploads a replacement.
const DEFAULT_IMAGES: Record<string, string> = {
  hero:               'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=1200&q=80&auto=format&fit=crop',
  about:              'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1200&q=80&auto=format&fit=crop',
  'use-case-mining':  'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=1200&q=80&auto=format&fit=crop',
  'use-case-delivery':'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1200&q=80&auto=format&fit=crop',
  'use-case-intercity':'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1200&q=80&auto=format&fit=crop',
  'use-case-bus':     'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=1200&q=80&auto=format&fit=crop',
  'use-case-rental':  'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=1200&q=80&auto=format&fit=crop',
  'why-us':           'https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80&auto=format&fit=crop',
};

function resolveImage(
  settings: { images?: Record<string, { hasImage: boolean; updatedAt?: string }> } | undefined,
  key: keyof typeof DEFAULT_IMAGES,
): string {
  const meta = settings?.images?.[key];
  if (meta?.hasImage) {
    const v = meta.updatedAt ? encodeURIComponent(meta.updatedAt) : '';
    return `${API_BASE}/landing/images/${key}?v=${v}`;
  }
  return DEFAULT_IMAGES[key];
}

// Sales-focused landing page for fleex.mn — MediaPRO ХХК-ийн product.
// Sections (top → bottom): nav, hero, key-numbers strip, "why fleex"
// pillars, about MediaPRO, use cases, features, why-us, pricing, FAQ,
// contact (CTA repeated), footer.

const NAV = [
  { href: '#why',              label: 'Яагаад Fleex?' },
  { href: '#highlights-2026',  label: 'Mining 2026' },
  { href: '#use-cases',        label: 'Хэрэглээний салбар' },
  { href: '#features',         label: 'Боломжууд' },
  { href: '#pricing',          label: 'Үнэ' },
  { href: '#contact',          label: 'Холбоо барих' },
];

const KEY_NUMBERS = [
  { value: '< 30с',  label: 'PANIC ⇒ хариу үйлдэл' },
  { value: '2ц',     label: 'Lone-worker risk детект' },
  { value: '14 хон', label: 'Засвар урьдчилан мэдэгдэх' },
  { value: '1000+',  label: 'Зэрэгцээ төхөөрөмж' },
];

const WHY_FLEEX = [
  {
    icon: '🆘',
    title: '"Lone worker" автомат хамгаалалт',
    body:
      'Жолооч 2 цаг хариу алга, эсвэл хөдөлгөөнгүй зогссон бол менежерт автомат сэрэмжлүүлэг. Pit-ийн алслагдсан хэсэгт зүрхний түгшилт, гэнэтийн осолд орсон жолоочийг яаралтай олж тусална. OT-н HSE-S-001 policy-ийг гар бичигтгүй автоматжуулсан.',
  },
  {
    icon: '🚨',
    title: 'PANIC ⇒ 5km дотор шууд SMS',
    body:
      'Жолооч улаан товч дармагц 5km радиуст ажиллаж буй жолоочдийн утсанд Google Maps холбоостой SMS яваад дуусчихсан байна. Radio call хүлээх шаардлагагүй — 30 секундийн дотор анхны хариу үйлдэл.',
  },
  {
    icon: '⛽',
    title: 'Шатахууны зардлыг 10–15% бууруулна',
    body:
      'Fuel probe эсвэл CAN-bus-аар бодит түвшинг секунд тутам хардаг. Гэнэт буурсан үед SMS / push дохио шууд явна — алдагдал, хулгай гарвал тэр өдөртөө мэдэгдэнэ.',
  },
  {
    icon: '⏱️',
    title: 'Хөдөлгүүр сул зогсох цагийг 30%-аар хасна',
    body:
      'Машин асаалттай, хурд 0 байх бүх минутыг тоолж дансанд бичнэ. Idle цаг × ₮/цаг тарифаар нэхэмжлэх дүн Excel-ийн товчоор гарна — нягтлан бодогчид баримтжина.',
  },
  {
    icon: '🤖',
    title: 'Жолооч бүрд 0–100 онооны үнэлгээ',
    body:
      'Сар бүрийн 1-нд жолооч бүрд scorecard PDF автоматаар email-ээр явна — HR-н ажлыг 2-3 цагаар хэмнэдэг. Менежерт rank-н нэгдсэн тайлан давхар.',
  },
  {
    icon: '📋',
    title: 'Dispatcher live kanban',
    body:
      'Бүх машинаа нэг харагдацанд — хөдөлж буй, хүлээж буй, холбоо тасарсан. 50+ машинтай pit-д map-р pin scan хийх шаардлагагүй; "25м зогссон" гэх timer-р шууд анхааралд авна.',
  },
  {
    icon: '🌙',
    title: 'Geofence өдөр / шөнийн хурдны хязгаар',
    body:
      'Нэг geofence-д хоёр хурд — өдрийн 50, шөнийн 30. Цагаар автомат сэлгэгдэнэ. Haul road-ийн шуурга, харанхуйн нөхцөлд аюулгүй байдлыг код-гүй тохиргоогоор хангана.',
  },
  {
    icon: '🔧',
    title: 'Засварын урьдчилсан тооцоолол',
    body:
      'Одометр + сүүлийн 30 хоногийн дундаж км/өдөр → "Oil change 12 хоногийн дараа болно". 14 хоногийн өмнө менежерт автомат email — workshop slot, ОУ-аас захиалах эд ангид lead time өгнө.',
  },
  {
    icon: '🔑',
    title: 'Алсаас хөдөлгүүр асаах / унтраах',
    body:
      'Түрээсийн машин төлбөргүй болсон, корпорат машиныг зөвшөөрөлгүй хүн жолоодох гээд олон тохиолдол. Диспетчер 1 товчоор хөдөлгүүрийг түгжинэ. RFID карт уншуулж л дахин асна.',
  },
  {
    icon: '🎥',
    title: 'Осол / зөрчилд видео нотолгоо',
    body:
      'Dash-cam-тай холбосон тохиолдолд осол, ширүүн тоормосолт, panic дохио гарсан хором бүрд өмнө 15 / хойно 15 секундын бичлэг тус машинд хадгалагдана. Даатгал, шүүхийн мэтгэлцээнд хэрэглэхэд бэлэн.',
  },
  {
    icon: '🛡️',
    title: 'Teltonika Pro GPS — Үйлдвэрлэлийн зэрэглэл',
    body:
      'Бид Teltonika FMC650 / FMM650, Garmin dezl-ийг ашиглаж байна. -40°C-д ажиллана, GSM-ийг жаам хийсэн, эсвэл утсыг тасалсан үед ч таны server-руу анхааруулга илгээнэ.',
  },
];

const USE_CASES = [
  {
    title: 'Уул уурхай · Хүнд тоног төхөөрөмж',
    imgKey: 'use-case-mining' as const,
    body:
      'БелАЗ, CAT 793 ангиллын самосвал, экскаватор, бульдозер, грейдер, дугуйт ачигч. Тоосжилт ихтэй, -40°C-ийн хүйтэн нөхцөлд ажиллахад зориулсан төхөөрөмжүүд хэрэглэдэг. OT-н HSE policy шаардлагуудтай (lone-worker, speed management, dispatch monitoring, emergency response) автомат нийцэлтэй.',
    bullets: [
      'Lone-worker автомат risk event (2ц+ хариу алга)',
      'PANIC дохио ⇒ ойролцоох жолоочдод 5km дотор SMS',
      'Geofence-д өдөр / шөнийн хурдны хязгаар',
      'Brigade ээлжийг өнгөөр ялгасан Dispatcher live board',
      'Idle цаг × тариф = нэхэмжлэх дүн (Excel)',
      'Workshop slot — засвар 14 хоногийн өмнө автомат сэрэмжлүүлэг',
    ],
  },
  {
    title: 'Хотын хүргэлт',
    imgKey: 'use-case-delivery' as const,
    body:
      'Дэлгүүрийн хүргэлт, фургон, Porter. Жолоочийн чиглэл нягтласан, хүргэлтийн цаг, маршрутын түүх Excel / PDF-ээр шууд гарна.',
    bullets: ['Хүргэлт хэдэн цагт хийгдсэн нь баримтжина', 'Тойм маршрут, idle time тайлан', 'Хэрэглэгчдийн SLA dashboard'],
  },
  {
    title: 'Хот хоорондын тээвэр',
    imgKey: 'use-case-intercity' as const,
    body:
      'Контейнер, цистерн, ачааны том машин. Сүлжээ алдсан газар offline cache, дахин холбогдмогц автоматаар сэргээнэ — ачааны нэг ч мөр гээгдэхгүй.',
    bullets: ['Маршрут оновчлол, шатхуун хулгайн анхааруулга', 'Жолоочийн ажилласан цаг, унтлагын дохио', 'Шилжилт, ачааны баримт'],
  },
  {
    title: 'Нийтийн тээвэр · Автобус',
    imgKey: 'use-case-bus' as const,
    body:
      'Хот доторх автобус, маршрутын такси, корпорат шатлын машин. Зорчигчдод ETA, маршрутаас гарсан бүртгэл, давтамжийн тайлан.',
    bullets: ['Маршрутын дагуу үлдсэн зайн ETA', 'Зогсоол алгассан тохиолдол', 'Шатлал жолоочийг RFID-аар таних'],
  },
  {
    title: 'Машин түрээс · Каршэринг',
    imgKey: 'use-case-rental' as const,
    body:
      'Түрээслүүлсэн машин нь хаана яаж байгааг 1 click-ээр харна. Алсаас хөдөлгүүр түгжих боломжтой учир машин эзгүйрэх эрсдэл бараг 0 болно.',
    bullets: ['Алсаас engine block / unblock', 'Geofence үндэслэсэн billing', 'Жолоочийн RFID түүх'],
  },
];

const FEATURES = [
  {
    icon: '📍',
    title: 'Real-time GPS tracking',
    body: 'WebSocket + Redis Pub/Sub ашиглан секунд тутмын байршил. Газрын зураг 3 layer (гудамж, хиймэл дагуул, рельеф).',
  },
  {
    icon: '⛽',
    title: 'Шатахуун мэдрэгчийн интеграц',
    body: 'CAN-bus / fuel-probe-аас бодит зарцуулалт, цэнэглэлт, гэнэтийн алдагдлыг 1 минутын дотор илрүүлж дохио өгнө. Калибрацийг хүснэгтэн хэлбэрээр оруулна — JSON код бичих хэрэггүй.',
  },
  {
    icon: '🔧',
    title: 'Засварын урьдчилсан тооцоолол',
    body: 'Одометр + сүүлийн 30 хоногийн дундаж км/өдөр → "Oil change 12 хоногийн дараа". 14 хоног үлдсэн үед менежерт автомат email — workshop slot захиалах цаг хангалттай.',
  },
  {
    icon: '🤖',
    title: 'Жолоочийн scorecard (cron)',
    body: 'Сар бүрийн 1-нд жолооч бүрт оноо нь email-ээр автомат. Eco-driving 0–100. Манагерт rank-сан нэгдсэн тайлан. HR-н ажлыг 2-3 цагаар хэмнэдэг.',
  },
  {
    icon: '🆘',
    title: 'Lone-worker safety алгоритм',
    body: 'Жолооч 2 цаг хариу алга, эсвэл хөдөлгөөнгүй зогссон бол автомат risk event. Pit-ийн алслагдсан хэсэгт зүрхний түгшилт, гэнэтийн осолд орсон жолоочийг шууд илрүүлнэ.',
  },
  {
    icon: '🚨',
    title: 'PANIC ⇒ ойролцоох жолоочдод',
    body: 'Жолооч улаан товч дармагц 5km дотор ажиллаж буй жолоочдод Google Maps холбоостой SMS. Radio call хүлээх шаардлагагүй — 30 секундийн анхны хариу.',
  },
  {
    icon: '🛑',
    title: 'Алсаас хөдөлгүүр унтраах / асаах',
    body: 'Жолооч аюултай байдалд орсон, машин хулгайлагдсан, түрээсийн төлбөр төлөгдөөгүй тохиолдолд алсаас хяналт. RFID карт уншуулж л дахин асна.',
  },
  {
    icon: '🎥',
    title: 'Видео аналитик · Dash-cam',
    body: 'Mobile брэндийн dash-cam төхөөрөмжтэй интеграц. Осол гарсан агшинд өмнө/хойно 30 секундийн бичлэгийг автоматаар хадгална.',
  },
  {
    icon: '📍',
    title: 'Place ↔ Geofence авто-синхрон',
    body: 'Газрын зураг дээр Place тэмдэглэхэд автомат geofence үүснэ. Refuel station, weighbridge, dumping bay тус бүрд орох/гарах автомат event — production KPI шууд бэлэн.',
  },
  {
    icon: '🌙',
    title: 'Geofence өдөр / шөнийн хурд',
    body: 'Нэг бүс, хоёр хурд — өдрийн 50, шөнийн 30. Цагаар автомат сэлгэгдэнэ. Haul road шуурга, харанхуйд аюулгүй байдлыг код-гүй хангана.',
  },
  {
    icon: '📋',
    title: 'Dispatcher live kanban',
    body: 'Хөдөлж буй / хүлээж буй / холбоо тасарсан 3-баганат самбар. 50+ машин дээр map-р pin scan хийх шаардлагагүй — "25м зогссон" timer-р шууд анхааруулна.',
  },
  {
    icon: '👥',
    title: 'Driver shift hierarchy',
    body: 'Бригад / ээлжийг model болгож тус тусдаа тайлан. Өглөөний vs шөнийн ээлжийн idle, оноо, ачаалал — менежер аль нь илүү бүтээмжтэй вэ гэдгийг хэмжинэ.',
  },
  {
    icon: '💰',
    title: 'Idle billing — Excel',
    body: 'Жолооч тус бүрийн idle цаг × ₮/цаг тариф = нэхэмжлэх дүн. Shift-ээр шүүгдэнэ. Нягтлан бодогчид Excel-ийн товчоор шууд татаж явуулна.',
  },
  {
    icon: '🗺️',
    title: 'Geofence ба маршрут',
    body: 'Polygon / circle бүс, давхар бүс, маршрут хазайлт, түр оруулга/гарга мэдэгдэл. Place-ээр Geofence авто-үүсгэх.',
  },
  {
    icon: '📊',
    title: 'KPI тайлан, экспорт',
    body: '12 сарын дата хадгалалт, TimescaleDB compression. Excel / PDF-ээр трип, idle, fuel, driver, geofence, scorecard тайлан.',
  },
  {
    icon: '🔐',
    title: 'Аудит, эрхийн түвшин',
    body: '6-түвшинт RBAC (SUPER_ADMIN → VIEWER), tamper-evident hash chain audit log, multi-tenant tenant-isolation.',
  },
];

// 2026 онд нэмэгдсэн шинэ боломжуудыг тусгайлан онцолж байгаа hero list.
// Landing page-ийн дунд section болгож харуулна — энэ нь бид-ийн уул уурхайн
// сектортой ажиллах гэрээний дараах хөгжүүлэлтийн тойм.
const HIGHLIGHTS_2026 = [
  {
    badge: 'SAFETY',
    title: 'Lone-worker автомат хамгаалалт',
    body:
      'OT-н HSE-S-001 policy-ийг гар бичигтгүй автоматжуулсан. 2 цаг хариу/хөдөлгөөнгүй ⇒ автомат risk event ⇒ менежерт SMS+email. Pit-ийн алслагдсан хэсэгт хэн ч хэдийнэ "хүн ажиллаж байна" гэдгийг харна.',
  },
  {
    badge: 'SAFETY',
    title: 'PANIC ⇒ автомат хамтрагч',
    body:
      'Жолооч улаан товч дармагц 5km радиуст идэвхтэй машин нэг бүрд Google Maps холбоостой SMS. Анхны хариу үйлдэл 30 секундийн дотор — radio операторт хүлээх алгасуулсан.',
  },
  {
    badge: 'OPERATIONS',
    title: 'Dispatcher live board',
    body:
      'Pit supervisor нь LiveMap-ийн pin цэгүүдийг scan хийхээ болино. 3-баганат kanban (хөдөлж / хүлээж / холбоогүй) дээр идэвхгүй машин 10 минут болмогц шилжих — авто-эрэмбэлэгдсэн анхааруулга.',
  },
  {
    badge: 'OPERATIONS',
    title: 'Driver shift hierarchy',
    body:
      'Brigade-уудыг өнгөөр ялгасан — диспетчер pit-д нэг харахдаа аль ээлж аль машинд хариуцаж байгааг шууд харна. Idle billing, eco-driving leaderboard ээлжээр шүүгдэнэ.',
  },
  {
    badge: 'FINANCE',
    title: 'Idle billing нэхэмжлэл',
    body:
      'Идэвхгүй ажилласан цаг × тариф = нэхэмжлэх дүн. Shift-ээр шүүж, Excel-ийн товчоор шууд татах. OT-н contractor-уудын нэхэмжлэл нэг өдөр биш, 5 минут болсон.',
  },
  {
    badge: 'PREDICTIVE',
    title: 'Засварын урьдчилсан тооцоолол',
    body:
      'Одометр + сүүлийн 30 хоногийн дундаж км → "Oil change 12 хоногийн дараа". 14 хоног үлдсэн үед автомат email. Workshop slot, ОУ-аас захиалах эд ангид 15 хоногийн lead time өгсөн.',
  },
  {
    badge: 'COMPLIANCE',
    title: 'Geofence өдөр / шөнийн хурд',
    body:
      'Нэг бүс, хоёр хурдны хязгаар, цагаар автомат сэлгэлт. Haul road шуурга, харанхуйн нөхцөлд аюулгүй байдлын policy-г code-гүй тохиргоогоор хангана. HSE-S-002 шаардлагатай нийцлэг.',
  },
  {
    badge: 'PRODUCTIVITY',
    title: 'Place ↔ Geofence авто-синхрон',
    body:
      'Refuel station, weighbridge, dumping bay тус бүрд цэг тэмдэглээд geofence авто-үүснэ. Орох/гарах бүх event бүртгэгдэх — production cycle, шатхууны хулгай нэг л dataset.',
  },
  {
    badge: 'HR',
    title: 'Жолоочийн scorecard cron',
    body:
      'Сар бүрийн 1-нд жолооч бүрд PDF email-ээр автоматаар явна. HR-ийн manual Excel ажлыг 2-3 цагаар хэмнэсэн. Менежерт rank-сан нэгдсэн тайлан хавсралттай.',
  },
  {
    badge: 'CALIBRATION',
    title: 'Sensor calibration UI',
    body:
      'Шатахуун мэдрэгчийн калибраци хүснэгтэн editor + real-time preview chart. JSON код бичдэг DevOps-н дамжуулга цуцалсан — менежер 5 минутад шинэчилнэ.',
  },
];

const PRICING = [
  {
    name: 'Starter',
    devices: '1–10 машин',
    price: '200,000₮',
    period: 'сард',
    highlight: false,
    features: ['Real-time tracking', 'Geofence, хурдны дохиолол', '6 сарын дата хадгалалт', 'Excel/PDF тайлан', 'Имэйл дэмжлэг'],
  },
  {
    name: 'Business',
    devices: '11–50 машин',
    price: '800,000₮',
    period: 'сард',
    highlight: true,
    features: ['Starter-ийн бүх боломж', '12 сарын дата хадгалалт', 'AI жолоочийн зан төлвийн оноо', 'API хандалт', 'RFID / Driver ID', 'Утсан + чат дэмжлэг'],
  },
  {
    name: 'Pro',
    devices: '51–100 машин',
    price: '1,500,000₮',
    period: 'сард',
    highlight: false,
    features: ['Business-ийн бүх боломж', 'CAN / OBD-II дэмжлэг', 'Алсаас түлхүүргүй асаах/унтраах', 'Видео аналитик · Dash-cam', 'Custom dashboard', '24/7 яаралтай тусламж'],
  },
  {
    name: 'Enterprise',
    devices: '100+ машин',
    price: 'Тусгай',
    period: 'тариф',
    highlight: false,
    features: ['Pro-ийн бүх боломж', 'Тусгай deployment (on-premise)', 'White-label брэндинг', 'Захиалгат integration', 'Тусгай SLA, account manager'],
  },
];

export function Landing() {
  // CMS data — super_admin can override hero copy / image via the
  // Landing settings page. Cache for 5 minutes so the marketing site is
  // fast even when the admin updates content.
  const settings = useQuery({
    queryKey: ['landing-settings'],
    queryFn: () => api.get('/landing').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const heroTagline = (settings.data?.heroTagline?.trim()) || DEFAULT_HERO_TAGLINE;
  const heroSubText = (settings.data?.heroSubText?.trim()) || DEFAULT_HERO_SUBTEXT;
  const heroImg = resolveImage(settings.data, 'hero');

  return (
    <div className="bg-white text-slate-900">
      {/* ───────── Top nav ───────── */}
      <header className="sticky top-0 z-40 backdrop-blur bg-white/90 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-extrabold tracking-tight text-brand-700">Fleex</div>
            <span className="hidden sm:inline text-xs text-slate-400 border-l border-slate-200 pl-3">
              by <a href="https://mediapro.mn" target="_blank" rel="noreferrer" className="hover:text-brand-600">MediaPRO ХХК</a>
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="hover:text-brand-700">{n.label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a href="#contact" className="hidden sm:inline text-sm text-slate-600 hover:text-brand-700">Захиалга</a>
            <Link to="/login" className="rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2">
              Нэвтрэх
            </Link>
          </div>
        </div>
      </header>

      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-brand-900 to-brand-700 text-white">
        <div className="absolute inset-0 opacity-20"
             style={{ backgroundImage: `url('${heroImg}')`,
                      backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <div className="relative max-w-7xl mx-auto px-6 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="uppercase tracking-widest text-brand-200 text-sm">Enterprise Fleet Management</p>
            <h1 className="mt-3 text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight">
              {heroTagline}
            </h1>
            <p className="mt-5 text-lg text-brand-100/90 max-w-xl leading-relaxed whitespace-pre-line">
              {heroSubText}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#contact" className="rounded-md bg-white text-brand-900 px-5 py-3 font-semibold hover:bg-brand-50 transition shadow-lg">
                Үнэгүй демо турших
              </a>
              <a href="#contact" className="rounded-md bg-brand-600 hover:bg-brand-500 text-white px-5 py-3 font-semibold transition shadow-lg">
                Захиалга өгөх
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-brand-100/80">
              <span>✓ Lone-worker автомат сэрэмжлүүлэг</span>
              <span>✓ PANIC ⇒ 5km дотор тусламж</span>
              <span>✓ Dispatcher live kanban</span>
              <span>✓ Shift KPI · Idle billing Excel</span>
              <span>✓ Засварын урьдчилсан тооцоо</span>
              <span>✓ Teltonika FMC650 / Garmin dezl</span>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur shadow-2xl">
            <img
              src={heroImg}
              alt="Fleet hero"
              className="rounded-xl object-cover w-full h-72"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Badge title="AI Аналитик" sub="Жолоочийн зан төлөв" />
              <Badge title="⛽ 10–15%" sub="Шатахуун хэмнэлт" />
              <Badge title="🎥 Видео" sub="Осол бичлэг" />
              <Badge title="🔑 Алсаас" sub="Engine block" />
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Key numbers ───────── */}
      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
          {KEY_NUMBERS.map((b) => (
            <div key={b.label} className="text-center">
              <div className="text-3xl md:text-4xl font-extrabold text-brand-700">{b.value}</div>
              <div className="text-xs uppercase text-slate-500 mt-1 tracking-widest">{b.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Why Fleex? ───────── */}
      <section id="why" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto">
            <p className="uppercase tracking-widest text-brand-700 text-sm">Яагаад Fleex?</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Тоон үзүүлэлтээр баталсан давуу талууд</h2>
            <p className="mt-4 text-slate-600">
              Зөвхөн "GPS" биш — танай бизнест шууд нөлөөлдөг 6 чиглэлээр үр дүнг өгдөг ухаалаг систем.
            </p>
          </div>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {WHY_FLEEX.map((w) => (
              <div key={w.title} className="rounded-2xl border border-slate-200 p-6 hover:border-brand-300 hover:shadow-lg transition bg-white">
                <div className="text-3xl">{w.icon}</div>
                <div className="mt-3 font-bold text-lg leading-tight">{w.title}</div>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{w.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <a href="#contact" className="inline-block rounded-md bg-brand-600 hover:bg-brand-500 text-white px-6 py-3 font-semibold transition shadow">
              Үнэгүй демо турших →
            </a>
          </div>
        </div>
      </section>

      {/* ───────── About MediaPRO ───────── */}
      <section className="max-w-7xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12 items-center bg-slate-50 rounded-3xl my-8">
        <div>
          <p className="uppercase tracking-widest text-brand-700 text-sm">Бид хэн бэ?</p>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold">MediaPRO ХХК-ийн флот менежментийн шийдэл</h2>
          <p className="mt-5 text-slate-600 leading-relaxed">
            <strong>Fleex</strong>-ийг <a className="text-brand-700 hover:underline" href="https://mediapro.mn" target="_blank" rel="noreferrer">mediapro.mn</a>-ний баг
            бүтээж байна. Монголын уул уурхай, тээвэр, хүргэлтийн компаниуд олон жил
            гадаадын flotын систем хэрэглээд монгол хэл, монгол дэмжлэг, орон нутгийн
            нөхцөл байдалд тааруулсан шийдэлд хүрэхгүй байсан тул бид өөрсдөө хийхийг
            шийдсэн.
          </p>
          <p className="mt-3 text-slate-600 leading-relaxed">
            Үр дүн нь — <strong>Монгол хэлтэй, Монголд hosting хийсэн</strong>, тоосжилт,
            -40°C, зам зайны нөхцөлд тэсвэртэй платформ. Гэр бүлийн жижиг автопаркаас
            мянган нэгжтэй уурхайн флот хүртэл нэг л системээр удирдана.
          </p>
          <ul className="mt-6 space-y-3 text-slate-700">
            <li className="flex gap-3"><span className="text-emerald-600">✓</span> Дата нь Монголд хадгалагдана — гадаад руу гардаггүй</li>
            <li className="flex gap-3"><span className="text-emerald-600">✓</span> 24/7 Монгол хэлээр техникийн тусламж</li>
            <li className="flex gap-3"><span className="text-emerald-600">✓</span> Teltonika, Garmin GPS, OBD-II, CAN-bus, fuel sensor, dash-cam холбогддог</li>
            <li className="flex gap-3"><span className="text-emerald-600">✓</span> Танай ERP, 1С, нягтлан бодох системтэй API-аар уялдана</li>
          </ul>
        </div>
        <div className="relative">
          <img
            src={resolveImage(settings.data, 'about')}
            alt="Fleet operations"
            className="rounded-2xl shadow-xl"
          />
          <div className="absolute -bottom-6 -left-6 bg-white border border-slate-200 shadow-lg rounded-xl p-4 max-w-xs">
            <div className="text-xs text-slate-500 uppercase tracking-widest">Хэрэглэгчийн сэтгэгдэл</div>
            <div className="mt-1 text-sm text-slate-700">
              «Fleex-ийг суулгасан 3 сард шатхууны зарцуулалт 12%-аар буурч, машин зогсолтын цаг 35%-аар буурсан.»
            </div>
            <div className="mt-2 text-xs text-slate-400">— Уурхайн тээврийн менежер</div>
          </div>
        </div>
      </section>

      {/* ───────── Use cases ───────── */}
      <section id="use-cases" className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto">
            <p className="uppercase tracking-widest text-brand-700 text-sm">Хэрэглээний салбар</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Олон төрлийн флотод тохиромжтой</h2>
            <p className="mt-4 text-slate-600">Уул уурхайн БелАЗ-аас хотын фургон, автобус хүртэл — салбар бүрд оновчилсон шийдэл.</p>
          </div>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {USE_CASES.map((u) => (
              <article key={u.title} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition group">
                <div className="h-44 w-full overflow-hidden">
                  <img src={resolveImage(settings.data, u.imgKey)} alt={u.title} className="h-full w-full object-cover group-hover:scale-105 transition" />
                </div>
                <div className="p-5">
                  <h3 className="font-bold text-lg">{u.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{u.body}</p>
                  <ul className="mt-3 space-y-1 text-sm text-slate-700">
                    {u.bullets.map((b) => (
                      <li key={b} className="flex gap-2"><span className="text-emerald-600">•</span> {b}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── 2026 highlights ───────── */}
      <section id="highlights-2026" className="relative py-20 bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-[0.08]"
             style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #fff 0, transparent 50%), radial-gradient(circle at 80% 70%, #fff 0, transparent 40%)' }} />
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="max-w-3xl">
            <p className="uppercase tracking-widest text-brand-300 text-sm font-semibold">2026 — Mining-grade шинэчлэлт</p>
            <h2 className="mt-2 text-3xl md:text-4xl lg:text-5xl font-extrabold leading-tight">
              Уурхайн нэгэн жил <span className="text-brand-300">аюулгүй ажиллах</span> 10 шинэ боломж
            </h2>
            <p className="mt-5 text-lg text-brand-100/90 leading-relaxed">
              Оюу Толгойн тендерийн дараах хөгжүүлэлтийн үр дүн —
              HSE policy-уудыг код-гүй биелүүлж, диспетчерийн гар ажиллагааг автоматжуулсан.
              Эдгээр бүгд production-д аль хэдийн ажиллаж байна.
            </p>
          </div>

          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {HIGHLIGHTS_2026.map((h) => (
              <article
                key={h.title}
                className="rounded-xl border border-white/10 bg-white/5 backdrop-blur p-5 hover:bg-white/10 hover:border-brand-300/40 transition"
              >
                <span className="inline-block rounded-full bg-brand-500/20 text-brand-200 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1">
                  {h.badge}
                </span>
                <div className="mt-3 font-semibold text-lg leading-snug">{h.title}</div>
                <p className="mt-2 text-sm text-brand-100/80 leading-relaxed">{h.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-12 rounded-2xl border border-brand-300/30 bg-brand-500/10 backdrop-blur p-6 md:p-8 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
            <div>
              <div className="text-brand-200 text-sm font-semibold uppercase tracking-widest">OT HSE compliance</div>
              <h3 className="mt-1 text-xl md:text-2xl font-bold">
                HSE-S-001 · S-002 · S-010 · OPS-D-007 · OPS-M-012 шаардлагуудтай нийцлэг
              </h3>
              <p className="mt-2 text-sm text-brand-100/85 max-w-2xl">
                Lone-worker, speed management, emergency response, dispatch monitoring, preventive maintenance —
                бүгд нэг систем дотор гар бичигтгүйгээр автоматжуулсан.
              </p>
            </div>
            <a
              href="#contact"
              className="rounded-md bg-white text-brand-900 px-5 py-3 font-semibold hover:bg-brand-50 transition shadow-lg whitespace-nowrap"
            >
              Демо захиалах →
            </a>
          </div>
        </div>
      </section>

      {/* ───────── Features ───────── */}
      <section id="features" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto">
            <p className="uppercase tracking-widest text-brand-700 text-sm">Боломжууд</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Зөвхөн GPS биш — иж бүрэн флот удирдлага</h2>
            <p className="mt-4 text-slate-600">
              Зөвхөн машины байршил харахаас илүү — AI аналитик, видео бичлэг, түлхүүргүй удирдлага,
              шатхуун, хөдөлгүүр, жолоочийн зан төлөв, аюулгүй байдлыг хамт хянана.
            </p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-200 p-6 bg-white hover:border-brand-300 hover:shadow-md transition">
                <div className="text-3xl">{f.icon}</div>
                <div className="mt-3 font-semibold text-lg">{f.title}</div>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── Why us (technical credibility) ───────── */}
      <section className="bg-gradient-to-br from-brand-900 to-slate-900 text-white py-20">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="uppercase tracking-widest text-brand-300 text-sm">Техникийн давуу тал</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Хүнд үйлдвэрлэлийн ачаалалд тэсвэртэй</h2>
            <p className="mt-4 text-brand-100/90 leading-relaxed">
              Уул уурхайн их флот гэдэг нь секундэд хэдэн зуун GPS пакет, өдөрт сая
              сая мөр гэсэн үг. Fleex-ийн архитектур ийм ачаалалд зориулагдсан.
              TimescaleDB-ийн hypertable + Go хэлээр бичсэн ingestor + WebSocket fanout-аар
              1000+ машин секунд тутамд дата илгээж байсан ч систем тогтвортой
              ажилладаг. 12 сарын маршрут / зүсэлт цэг нэг секундэд уншигдана.
            </p>
            <ul className="mt-6 space-y-3">
              <Reason title="Үндэсний дэмжлэг" body="Монгол хэлтэй, монгол хүний хийсэн, Монголд hosting." />
              <Reason title="Нээлттэй стандарт" body="REST + WebSocket API, ERP, 1C, BI системтэй холбогддог." />
              <Reason title="Дэлхийн зэрэглэлийн архитектур" body="Postgres + TimescaleDB hypertable, Redis Pub/Sub, hash-chained audit." />
              <Reason title="Тасралтгүй ажиллагаа" body="Auto-failover, healthcheck, automatic rollback." />
            </ul>
          </div>
          <div className="space-y-4">
            <img src={resolveImage(settings.data, 'why-us')} alt="Operations" className="rounded-2xl shadow-2xl" />
            <div className="grid grid-cols-2 gap-4">
              <Metric label="P95 latency" value="<200ms" />
              <Metric label="Дата алдалт" value="0%" />
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Pricing ───────── */}
      <section id="pricing" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto">
            <p className="uppercase tracking-widest text-brand-700 text-sm">Үнэ</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Машины тоонд тохирсон энгийн үнийн тариф</h2>
            <p className="mt-4 text-slate-600">Бүх тарифт суурилуулалт, сургалт, 24/7 дэмжлэг багтсан. НӨАТ-гүй үнэ.</p>
          </div>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {PRICING.map((p) => (
              <div
                key={p.name}
                className={`rounded-2xl border p-6 flex flex-col ${
                  p.highlight ? 'border-brand-600 ring-2 ring-brand-600 shadow-xl relative bg-white scale-105' : 'border-slate-200 bg-white'
                }`}
              >
                {p.highlight && (
                  <div className="absolute -top-3 right-6 bg-brand-600 text-white text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow">
                    Алдартай
                  </div>
                )}
                <div className="text-sm uppercase text-slate-500 tracking-widest">{p.name}</div>
                <div className="mt-2 text-lg text-slate-600">{p.devices}</div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold">{p.price}</span>
                  <span className="text-sm text-slate-500">/ {p.period}</span>
                </div>
                <ul className="mt-6 space-y-2 text-sm text-slate-700 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-emerald-600">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <a
                  href="#contact"
                  className={`mt-6 block text-center rounded-md py-2.5 font-semibold transition ${
                    p.highlight ? 'bg-brand-600 hover:bg-brand-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
                  }`}
                >
                  Захиалга өгөх
                </a>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-slate-500">
            Төхөөрөмжийн үнийг тусад нь — Teltonika FMC150 / FMC650 / FMM650, RFID reader, dash-cam.
            <a href="#contact" className="text-brand-700 hover:underline ml-1">Нарийвчилсан тооцоо хүсэх →</a>
          </p>
        </div>
      </section>

      {/* ───────── Contact / CTA ───────── */}
      <section id="contact" className="bg-slate-900 text-white py-20">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="uppercase tracking-widest text-brand-300 text-sm">Холбоо барих</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Демо турших? Танай флотод үнэлгээ хийлгэх үү?</h2>
            <p className="mt-4 text-slate-300 leading-relaxed">
              Манай борлуулалтын мэргэжилтнүүд тантай уулзаж, танай флотын өвөрмөц шаардлагад нийцсэн
              шийдлийг санал болгоно. Ажлын өдөр 24 цагийн дотор холбогдоно.
            </p>
            <div className="mt-8 space-y-4">
              <a href="tel:+97688881018" className="flex items-center gap-4 group">
                <span className="h-12 w-12 rounded-full bg-brand-600 flex items-center justify-center text-xl">📞</span>
                <div>
                  <div className="text-xs uppercase text-slate-400 tracking-widest">Утас</div>
                  <div className="text-xl font-bold group-hover:text-brand-300">8888-1018</div>
                </div>
              </a>
              <a href="mailto:fleex@mediapro.mn" className="flex items-center gap-4 group">
                <span className="h-12 w-12 rounded-full bg-brand-600 flex items-center justify-center text-xl">✉️</span>
                <div>
                  <div className="text-xs uppercase text-slate-400 tracking-widest">Имэйл</div>
                  <div className="text-xl font-bold group-hover:text-brand-300">fleex@mediapro.mn</div>
                </div>
              </a>
              <a href="https://mediapro.mn" target="_blank" rel="noreferrer" className="flex items-center gap-4 group">
                <span className="h-12 w-12 rounded-full bg-brand-600 flex items-center justify-center text-xl">🌐</span>
                <div>
                  <div className="text-xs uppercase text-slate-400 tracking-widest">Веб</div>
                  <div className="text-xl font-bold group-hover:text-brand-300">mediapro.mn</div>
                </div>
              </a>
            </div>
          </div>
          <ContactForm />
        </div>
      </section>

      {/* ───────── Footer ───────── */}
      <footer className="bg-slate-950 text-slate-400 py-10 text-sm">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-3 gap-8">
          <div>
            <div className="text-2xl font-extrabold text-white">Fleex</div>
            <p className="mt-2 max-w-xs">
              MediaPRO ХХК-ийн Fleet Management шийдэл. Уул уурхай, тээвэр, түрээсийн флотод зориулж Монголд хийсэн.
            </p>
          </div>
          <div>
            <div className="text-white font-semibold mb-3">Линкүүд</div>
            <ul className="space-y-2">
              <li><a href="#why" className="hover:text-white">Яагаад Fleex?</a></li>
              <li><a href="#use-cases" className="hover:text-white">Хэрэглээний салбар</a></li>
              <li><a href="#features" className="hover:text-white">Боломжууд</a></li>
              <li><a href="#pricing" className="hover:text-white">Үнэ</a></li>
              <li><Link to="/login" className="hover:text-white">Нэвтрэх</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-white font-semibold mb-3">Холбоо барих</div>
            <ul className="space-y-2">
              <li>Утас: <a href="tel:+97688881018" className="hover:text-white">8888-1018</a></li>
              <li>Имэйл: <a href="mailto:fleex@mediapro.mn" className="hover:text-white">fleex@mediapro.mn</a></li>
              <li>Веб: <a href="https://mediapro.mn" target="_blank" rel="noreferrer" className="hover:text-white">mediapro.mn</a></li>
            </ul>
            <a href="#contact" className="mt-4 inline-block rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2">
              Демо турших
            </a>
          </div>
        </div>
        <div className="border-t border-slate-800 mt-10 pt-6 max-w-7xl mx-auto px-6 flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} MediaPRO ХХК. Бүх эрх хуулиар хамгаалагдсан.</span>
          <span>fleex.mn · Made in Mongolia 🇲🇳</span>
        </div>
      </footer>
    </div>
  );
}

function Badge({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-lg bg-white/10 border border-white/10 p-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-brand-100/80 mt-0.5">{sub}</div>
    </div>
  );
}

function Reason({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1 h-2 w-2 rounded-full bg-brand-300 shrink-0" />
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-brand-100/80 text-sm">{body}</div>
      </div>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-xs text-brand-200 uppercase tracking-widest mt-1">{label}</div>
    </div>
  );
}

function ContactForm() {
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const subject = encodeURIComponent(`Захиалга: ${f.get('company') ?? ''}`);
    const body = encodeURIComponent(
      `Нэр: ${f.get('name')}\nКомпани: ${f.get('company')}\nУтас: ${f.get('phone')}\nМашины тоо: ${f.get('vehicles')}\n\nЗаавар:\n${f.get('message')}`,
    );
    window.location.href = `mailto:fleex@mediapro.mn?subject=${subject}&body=${body}`;
  };
  return (
    <form onSubmit={onSubmit} className="bg-white text-slate-900 rounded-2xl p-6 shadow-xl space-y-4">
      <div className="text-lg font-bold">Демо хүсэлт илгээх</div>
      <div className="grid grid-cols-2 gap-3">
        <Input name="name" label="Нэр" required />
        <Input name="company" label="Компани" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input name="phone" label="Утас" type="tel" required />
        <Input name="vehicles" label="Машины тоо" type="number" />
      </div>
      <div>
        <label className="block text-xs uppercase text-slate-500 mb-1 tracking-widest">Тэмдэглэл</label>
        <textarea name="message" rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>
      <button type="submit" className="w-full rounded-md bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 shadow">
        Демо хүсэх →
      </button>
      <p className="text-xs text-slate-500 text-center">Илгээснээр fleex@mediapro.mn хаягт имэйл нээгдэнэ.</p>
    </form>
  );
}

function Input(props: { name: string; label: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs uppercase text-slate-500 mb-1 tracking-widest">{props.label}</label>
      <input
        name={props.name}
        type={props.type ?? 'text'}
        required={props.required}
        className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );
}
