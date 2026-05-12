import { Link } from 'react-router-dom';

// Marketing landing page for fleex.mn — a MediaPRO LLC product.
// Sections (top → bottom): nav, hero, trust strip, about MediaPRO,
// use cases, capabilities, why-us, pricing, FAQ, contact, footer.

const NAV = [
  { href: '#use-cases', label: 'Хэрэглээний салбар' },
  { href: '#features', label: 'Боломжууд' },
  { href: '#pricing', label: 'Үнэ' },
  { href: '#contact', label: 'Холбоо барих' },
];

const USE_CASES = [
  {
    title: 'Уул уурхай · Хүнд тоног төхөөрөмж',
    img: 'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=1200&q=80&auto=format&fit=crop',
    body:
      'Нүүрс, зэс, төмрийн хүдэр тээвэрлэгч самосвал (БелАЗ, CAT 793), экскаватор, бульдозер, өргөгч кран зэрэг уурхайн машин механизмын онлайн хяналт. Хатуу нөхцөлд (тоосжилттой, -40°C) тогтвортой ажиллах Teltonika FMC650/FMM650 төхөөрөмжүүдийг дэмжинэ.',
    bullets: ['Хязгаар бүс (geofence) зөрчлийг шууд илрүүлэх', 'Хурдны хязгаар, panic button', 'Хөдөлгүүрийн цаг, түлшний зарцуулалт'],
  },
  {
    title: 'Дэлгүүрийн хүргэлт',
    img: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1200&q=80&auto=format&fit=crop',
    body:
      'Хүргэлтийн жижиг машин, фургоны хяналт. Жолоочийн чиглэлийн нягтлал, цаг хугацааны баримтжуулалт, хүлээн авагч хүн бүрийн хүргэлтийн түүх. Тайлан болон KPI-г Excel/PDF-ээр экспортлоно.',
    bullets: ['Хүргэлтийн цаг хугацааны баталгаажуулалт', 'Тойм маршрут, idle time тайлан', 'Хэрэглэгчдэд тааруулсан SLA dashboard'],
  },
  {
    title: 'Хот хоорондын тээвэр',
    img: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1200&q=80&auto=format&fit=crop',
    body:
      'Хол замын ачаа, контейнер, түлшний цистерн тээвэрлэгч машинуудад. Зам тутамд GPS+GSM хослолоор битгий гээгдэх, түр устсан хэсэгт дотоод цэнэг хадгалж сэргэхдээ серверт илгээнэ.',
    bullets: ['Маршрут оновчлол, fuel theft эсэргүүцэл', 'Жолоочийн ажилласан цаг, шууд унтлагын анхааруулга', 'Шилжилт болон ачааны баримт'],
  },
  {
    title: 'Нийтийн тээвэр · Автобус',
    img: 'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=1200&q=80&auto=format&fit=crop',
    body:
      'Хот доторх автобус, маршрутын такси, корпорат шатлын машинуудад зориулсан. Зорчигчдод чиглэсэн ETA, маршрутын зөрчил, давтамжийн тайлан.',
    bullets: ['Маршрутын дагуу үлдсэн зайн ETA', 'Зогсоол алгассан тохиолдол бүртгэх', 'Diff-shift жолоочийн RFID identification'],
  },
  {
    title: 'Машин түрээс · Каршэринг',
    img: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=1200&q=80&auto=format&fit=crop',
    body:
      'Түрээсийн машин, share-car флотын алсын хяналт. Машин гээгдэх эрсдэлийг бууруулна — алсаас хөдөлгүүр унтраах, гарч буй бүс эсэргүүцэх.',
    bullets: ['Engine block / unblock алсаас', 'Geofence үндэслэсэн billing', 'Хэрэглэгч/жолоочийн RFID түүх'],
  },
];

const FEATURES = [
  {
    icon: '📍',
    title: 'Real-time байршил',
    body: 'WebSocket + Redis Pub/Sub ашиглан секунд тутмын байршил. Газрын зураг гудамж, хиймэл дагуул, рельеф 3 layer.',
  },
  {
    icon: '⛽',
    title: 'Шатахуунны зарцуулалт',
    body: 'Нэмэлт fuel level sensor (CAN/J1939, fuel probe) холбоход тутмын зарцуулалт, гэнэтийн алдагдал, хулгайн алертыг бодит цагт илрүүлнэ.',
  },
  {
    icon: '🔧',
    title: 'Хөдөлгүүрийн ажиллагаа',
    body: 'Engine hours, RPM, температур, OBD-II/CAN bus уншилт, алдааны код (DTC). Засварын төлөвлөгөө автоматжуулсан.',
  },
  {
    icon: '🚦',
    title: 'Жолоочийн зан төлөв',
    body: 'Огцом хурдсах, ширүүн тоормослох, мушгилт, хурд хэтрэлт, унтаа жолоодлогын дохиолол. Eco-driving score.',
  },
  {
    icon: '🛑',
    title: 'Алсаас унтраах',
    body: 'Жолооч аюултай байдалд орсон, машин хулгайлагдсан, түрээсийн төлбөр төлөгдөөгүй тохиолдолд хөдөлгүүрийг алсаас унтраана.',
  },
  {
    icon: '🛡️',
    title: 'Хулгайн эсрэг систем',
    body: 'GSM jammer detection, движение без зажигания, panic button, RFID без validation, гэх мэт бүх tamper-event-ийг шууд илгээнэ.',
  },
  {
    icon: '🗺️',
    title: 'Geofence ба маршрут',
    body: 'Polygon ба circle хашаа, давхар бүс, маршрут хазайлт, түр оруулга/гарга мэдэгдэл. Бүс нутгийн хурдны хязгаарыг тус тусад нь тохируулна.',
  },
  {
    icon: '📊',
    title: 'Тайлан, экспорт',
    body: '12 сарын дата хадгалалт, TimescaleDB compression. Excel болон PDF-ээр трип, idle, fuel, driver, geofence тайлан гаргана.',
  },
  {
    icon: '🔐',
    title: 'Аудит, эрхийн түвшин',
    body: '6-түвшинт RBAC (SUPER_ADMIN → VIEWER), tamper-evident hash chain audit log, multi-tenant.',
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
    features: ['Starter-ийн бүх боломж', '12 сарын дата хадгалалт', 'Жолоочийн зан төлөв шинжилгээ', 'API хандалт', 'RFID/Driver ID', 'Утсан + чат дэмжлэг'],
  },
  {
    name: 'Pro',
    devices: '51–100 машин',
    price: '1,500,000₮',
    period: 'сард',
    highlight: false,
    features: ['Business-ийн бүх боломж', 'CAN/OBD-II дэмжлэг', 'Custom dashboard', 'Алсаас унтраах', 'SLA 99.9%', '24/7 яаралтай тусламж'],
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

const BENEFITS = [
  { stat: '1000+', label: 'Зэрэгцээ төхөөрөмж' },
  { stat: '8.6M', label: 'Бичлэг / өдөр' },
  { stat: '12', label: 'Сарын дата хадгалалт' },
  { stat: '99.9%', label: 'Uptime SLA' },
];

export function Landing() {
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
            <a href="#contact" className="hidden sm:inline text-sm text-slate-600 hover:text-brand-700">Холбоо барих</a>
            <Link to="/login" className="rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2">
              Нэвтрэх
            </Link>
          </div>
        </div>
      </header>

      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-brand-900 to-brand-700 text-white">
        <div className="absolute inset-0 opacity-20"
             style={{ backgroundImage: "url('https://images.unsplash.com/photo-1602407151310-c34a96ccd99c?w=2000&q=80&auto=format&fit=crop')",
                      backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <div className="relative max-w-7xl mx-auto px-6 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="uppercase tracking-widest text-brand-200 text-sm">Enterprise Fleet Management</p>
            <h1 className="mt-3 text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight">
              Танай флотын <span className="text-brand-200">бодит цагийн</span> ухаалаг хяналт
            </h1>
            <p className="mt-5 text-lg text-brand-100/90 max-w-xl">
              Уул уурхай, хүргэлт, тээвэр, нийтийн үйлчилгээ — Монгол улсын бүхий л төрлийн флотод
              зориулсан GPS дээр суурилсан, шатхуун, хөдөлгүүр, жолоочийн зан төлвийг хамтад нь хянадаг
              нэгдсэн платформ. Fleex нь <strong>MediaPRO ХХК</strong>-ийн бүтээгдэхүүн.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="rounded-md bg-white text-brand-900 px-5 py-3 font-semibold hover:bg-brand-50 transition">
                Үнэгүй демо нэвтрэх
              </Link>
              <a href="#contact" className="rounded-md border border-white/30 px-5 py-3 font-semibold hover:bg-white/10 transition">
                Захиалга өгөх
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-brand-100/80">
              <span>✓ Teltonika FMC150 / FMC650 / FMM650 нийцтэй</span>
              <span>✓ Garmin dezl OTR610</span>
              <span>✓ 1-wire RFID</span>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur shadow-2xl">
            <img
              src="https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=1200&q=80&auto=format&fit=crop"
              alt="Нүүрс тээвэрлэгч самосвал"
              className="rounded-xl object-cover w-full h-72"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Badge title="Teltonika Codec 8/8E" sub="TCP listener (Go)" />
              <Badge title="TimescaleDB" sub="Time-series scale" />
              <Badge title="Real-time WebSocket" sub="Pub/Sub fanout" />
              <Badge title="Tamper-evident audit" sub="Hash-chained log" />
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Trust strip ───────── */}
      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
          {BENEFITS.map((b) => (
            <div key={b.label} className="text-center">
              <div className="text-3xl md:text-4xl font-extrabold text-brand-700">{b.stat}</div>
              <div className="text-xs uppercase text-slate-500 mt-1 tracking-widest">{b.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── About MediaPRO ───────── */}
      <section className="max-w-7xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <p className="uppercase tracking-widest text-brand-700 text-sm">Бид хэн бэ?</p>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold">MediaPRO ХХК-ийн флот менежментийн шинэ бүтээгдэхүүн</h2>
          <p className="mt-5 text-slate-600 leading-relaxed">
            <strong>Fleex</strong> нь <a className="text-brand-700 hover:underline" href="https://mediapro.mn" target="_blank" rel="noreferrer">mediapro.mn</a>-ний хүчин зүтгэлээр Монгол улсын
            үйлдвэрлэл, тээвэр, үйлчилгээний компаниудад зориулан хөгжүүлж буй бие даасан Fleet Management
            System юм. Олон жилийн B2B SaaS туршлагатай инженерүүд GPSWOX, Wialon, Geotab зэрэг
            дэлхийн жишиг системүүдтэй ижил түвшний боловч <strong>монгол хэлтэй, монгол дахь дэмжлэгтэй</strong>,
            Оюу Толгой шиг хүнд үйлдвэрлэлийн ачаалал тэсвэрлэх архитектураар бүтээсэн.
          </p>
          <ul className="mt-6 space-y-3 text-slate-700">
            <li className="flex gap-3"><span className="text-emerald-600">✓</span> Дотоодын дата төв (Монгол), GDPR-нийцтэй шифрлэлт</li>
            <li className="flex gap-3"><span className="text-emerald-600">✓</span> 24/7 Монгол хэлээр техникийн дэмжлэг</li>
            <li className="flex gap-3"><span className="text-emerald-600">✓</span> Teltonika, Garmin, OBD-II, CAN-bus, fuel sensor зэргийг holboltsuulna</li>
            <li className="flex gap-3"><span className="text-emerald-600">✓</span> Танай ERP, 1C, нягтлан бодох системтэй API-аар интеграцилна</li>
          </ul>
        </div>
        <div className="relative">
          <img
            src="https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1200&q=80&auto=format&fit=crop"
            alt="Fleet operations"
            className="rounded-2xl shadow-xl"
          />
          <div className="absolute -bottom-6 -left-6 bg-white border border-slate-200 shadow-lg rounded-xl p-4 max-w-xs">
            <div className="text-xs text-slate-500 uppercase tracking-widest">Сэтгэгдэл</div>
            <div className="mt-1 text-sm text-slate-700">
              «Fleex-ийг суулгасан 3 сард шатхууны зарцуулалт 12%-аар буурч, машин зогсолтын цаг 35%-аар буурсан.»
            </div>
            <div className="mt-2 text-xs text-slate-400">— тээврийн компанийн менежер</div>
          </div>
        </div>
      </section>

      {/* ───────── Use cases ───────── */}
      <section id="use-cases" className="bg-slate-50 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto">
            <p className="uppercase tracking-widest text-brand-700 text-sm">Хэрэглээний салбар</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Хэн манай системийг хэрэглэж болох вэ?</h2>
            <p className="mt-4 text-slate-600">Олон төрлийн машин механизм бүхий бүх төрлийн флотод нийцсэн уян хатан platform.</p>
          </div>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {USE_CASES.map((u) => (
              <article key={u.title} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition">
                <div className="h-44 w-full overflow-hidden">
                  <img src={u.img} alt={u.title} className="h-full w-full object-cover group-hover:scale-105 transition" />
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

      {/* ───────── Features ───────── */}
      <section id="features" className="py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto">
            <p className="uppercase tracking-widest text-brand-700 text-sm">Боломжууд</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Зөвхөн GPS биш — иж бүрэн флот удирдлага</h2>
            <p className="mt-4 text-slate-600">
              Зөвхөн машины байршил харахаас илүү — нэмэлт мэдрэгч, OBD-II/CAN адаптер суулгаснаар
              шатхуун, хөдөлгүүр, жолоочийн зан төлөв, аюулгүй байдлыг хамт хянаж болно.
            </p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-200 p-6 hover:border-brand-300 hover:shadow-md transition">
                <div className="text-3xl">{f.icon}</div>
                <div className="mt-3 font-semibold text-lg">{f.title}</div>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── Why us ───────── */}
      <section className="bg-gradient-to-br from-brand-900 to-slate-900 text-white py-20">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="uppercase tracking-widest text-brand-300 text-sm">Яагаад Fleex гэж?</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Хүнд үйлдвэрлэлийн ачаалалд тэсвэртэй</h2>
            <p className="mt-4 text-brand-100/90 leading-relaxed">
              Бид GPSWOX, Wialon-ийг зүгээр л clone хийгээгүй. TimescaleDB + Go ingestor + WebSocket fanout-ийг
              ашигласнаар 1000+ машин секунд тутамд дата илгээж байсан ч систем нь саадгүй ажиллана. 12 сарын
              түүх 1 секундээр уншигдана.
            </p>
            <ul className="mt-6 space-y-3">
              <Reason title="Үндэсний дэмжлэг" body="Монгол хэлтэй, монгол хүний хийсэн, Монголд hosting." />
              <Reason title="Нээлттэй стандарт" body="REST + WebSocket API, ERP, 1C, BI системтэй холбогддог." />
              <Reason title="Дэлхийн зэрэглэлийн архитектур" body="Postgres + TimescaleDB hypertable, Redis Pub/Sub, hash-chained audit." />
              <Reason title="Tasралтгүй ажиллагаа" body="Auto-failover, healthcheck, automatic rollback." />
            </ul>
          </div>
          <div className="space-y-4">
            <img src="https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80&auto=format&fit=crop" alt="Operations" className="rounded-2xl shadow-2xl" />
            <div className="grid grid-cols-2 gap-4">
              <Metric label="P95 latency" value="<200ms" />
              <Metric label="Дата алдалт" value="0%" />
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Pricing ───────── */}
      <section id="pricing" className="py-20">
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
                  p.highlight ? 'border-brand-600 ring-2 ring-brand-600 shadow-lg relative bg-white' : 'border-slate-200 bg-white'
                }`}
              >
                {p.highlight && (
                  <div className="absolute -top-3 right-6 bg-brand-600 text-white text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full">
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
                  className={`mt-6 block text-center rounded-md py-2.5 font-semibold ${
                    p.highlight ? 'bg-brand-600 hover:bg-brand-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
                  }`}
                >
                  Захиалга өгөх
                </a>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-slate-500">
            Төхөөрөмжийн үнийг тусад нь — Teltonika FMC150 (туршилт), FMC650, FMM650, RFID reader зэрэг.
            Заавал ҮНДЭСЛЭСЭН тооцоо хүсэх бол доорх формыг бөглөнө үү.
          </p>
        </div>
      </section>

      {/* ───────── Contact ───────── */}
      <section id="contact" className="bg-slate-900 text-white py-20">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="uppercase tracking-widest text-brand-300 text-sm">Холбоо барих</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold">Демо туршлах? Танай флотод үнэлгээ хийлгэх үү?</h2>
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
              MediaPRO ХХК-ийн Enterprise Fleet Management System — Монголд хийсэн, дэлхийн жишигт нийцсэн.
            </p>
          </div>
          <div>
            <div className="text-white font-semibold mb-3">Линкүүд</div>
            <ul className="space-y-2">
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
  // The form just opens a pre-populated mailto: link. It's intentionally
  // static — we don't expose a public-write endpoint from the API to avoid
  // spam risk before we wire up captcha/throttling.
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
      <button type="submit" className="w-full rounded-md bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3">
        Илгээх
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
