import { Link } from 'react-router-dom';

export function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-brand-700 text-white">
      <header className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="text-2xl font-extrabold">Fleex</div>
        <Link
          to="/login"
          className="rounded-md bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-medium transition"
        >
          Нэвтрэх
        </Link>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-16 pb-24 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <p className="uppercase tracking-widest text-brand-200 text-sm">Enterprise GPS Tracking</p>
          <h1 className="mt-3 text-4xl md:text-5xl font-extrabold leading-tight">
            Уурхайн флотын <span className="text-brand-200">бодит цагийн</span> хяналт
          </h1>
          <p className="mt-5 text-lg text-brand-100/90 max-w-xl">
            Teltonika төхөөрөмжүүдийг шууд холбож, 1000+ машин, 12 сарын тэрбум бичлэгийн хэмжээний
            датаг саадгүй боловсруулна. Тасралтгүй ажиллагаа, аудит лог, RBAC, geofence, real-time
            дохиолол — нэг платформ дээр.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/login"
              className="rounded-md bg-white text-brand-900 px-5 py-3 font-semibold hover:bg-brand-50 transition"
            >
              Систем рүү нэвтрэх
            </Link>
            <a
              href="#features"
              className="rounded-md border border-white/30 px-5 py-3 font-semibold hover:bg-white/10 transition"
            >
              Дэлгэрэнгүй
            </a>
          </div>
          <div className="mt-10 grid grid-cols-3 gap-4 max-w-md">
            <Stat label="Төхөөрөмж" value="1000+" />
            <Stat label="Бичлэг / өдөр" value="8.6M" />
            <Stat label="Uptime" value="99.9%" />
          </div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur shadow-2xl">
          <div className="h-72 rounded-xl bg-[url('https://images.unsplash.com/photo-1604608672516-f1b9b1cd9be1?w=1200&auto=format&fit=crop')] bg-cover bg-center" />
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Badge title="Teltonika Codec 8/8E" sub="TCP listener (Go)" />
            <Badge title="TimescaleDB" sub="Time-series scale" />
            <Badge title="Real-time WebSocket" sub="Pub/Sub fanout" />
            <Badge title="Audit log" sub="Tamper-evident" />
          </div>
        </div>
      </section>

      <section id="features" className="bg-slate-50 text-slate-900 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center">Үндсэн боломжууд</h2>
          <p className="text-center text-slate-500 mt-3">
            Хүнд үйлдвэрлэлийн (mining-grade) шаардлагад нийцсэн архитектур.
          </p>
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            <Feature title="Real-time tracking" body="WebSocket + Redis Pub/Sub ашиглан секунд тутмын байршил." />
            <Feature title="Geofence & alerts" body="Polygon/Circle хашаа, хурд хэтрэлт, panic button, SMS/email." />
            <Feature title="12 сарын тайлан" body="TimescaleDB hypertable, continuous aggregate, Excel/PDF export." />
            <Feature title="RBAC + Audit log" body="6 түвшинт эрх, hash-chained tamper-evident лог." />
            <Feature title="High availability" body="Healthcheck, auto-restart, graceful shutdown, batched ingest." />
            <Feature title="Тасралтгүй deploy" body="Github push → 178.128.27.70 серверт автомат deploy (Docker Compose)." />
          </div>
        </div>
      </section>

      <footer className="bg-slate-900 text-slate-400 py-8 text-sm">
        <div className="max-w-6xl mx-auto px-6 flex flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} Fleex. All rights reserved.</span>
          <span>fleex.mn — Enterprise GPS SaaS</span>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-extrabold text-white">{value}</div>
      <div className="text-xs uppercase text-brand-200/80 mt-1">{label}</div>
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

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 p-6 shadow-sm">
      <div className="text-lg font-semibold">{title}</div>
      <p className="text-slate-600 mt-2 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
