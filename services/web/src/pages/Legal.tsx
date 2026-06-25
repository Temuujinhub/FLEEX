import { useParams, Link } from 'react-router-dom';

// Public legal pages: Terms of Service, Privacy Policy, Data Processing
// Agreement. Content is a Mongolian template covering the essentials a B2B SaaS
// contract needs — it MUST be reviewed by legal counsel before go-live (banner
// below). Served at /legal/:doc.

type Doc = 'terms' | 'privacy' | 'dpa';
const DOCS: { key: Doc; title: string }[] = [
  { key: 'terms', title: 'Үйлчилгээний нөхцөл' },
  { key: 'privacy', title: 'Нууцлалын бодлого' },
  { key: 'dpa', title: 'Дата боловсруулалтын гэрээ (DPA)' },
];

export function Legal() {
  const { doc } = useParams<{ doc: string }>();
  const active: Doc = (DOCS.find((d) => d.key === doc)?.key ?? 'terms') as Doc;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold">Fleex</Link>
          <Link to="/login" className="text-sm text-brand-700 font-semibold hover:text-brand-600">Нэвтрэх</Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <nav className="flex flex-wrap gap-2 mb-6">
          {DOCS.map((d) => (
            <Link key={d.key} to={`/legal/${d.key}`}
              className={`text-sm rounded-full px-3 py-1.5 border ${active === d.key ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300'}`}>
              {d.title}
            </Link>
          ))}
        </nav>

        <div className="rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs px-4 py-2.5 mb-6">
          ⚠ Энэ баримт нь <strong>загвар</strong> бөгөөд хуулийн зөвлөхөөр баталгаажуулсны дараа хүчин төгөлдөр болно.
        </div>

        <article className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 space-y-4">
          {active === 'terms' && <Terms />}
          {active === 'privacy' && <Privacy />}
          {active === 'dpa' && <Dpa />}
        </article>

        <p className="mt-6 text-xs text-slate-500">© {new Date().getFullYear()} MediaPRO ХХК · fleex.mn · fleex@mediapro.mn</p>
      </div>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold mt-5 first:mt-0">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-700 leading-relaxed">{children}</p>;
}

function Terms() {
  return (
    <>
      <h1 className="text-2xl font-extrabold">Үйлчилгээний нөхцөл</h1>
      <P>Сүүлд шинэчилсэн: {new Date().getFullYear()} он. Энэхүү нөхцөл нь fleex.mn (цаашид "Үйлчилгээ") -г ашиглах журмыг тодорхойлно. Үйлчилгээг ашигласнаар та доорх нөхцлийг хүлээн зөвшөөрсөнд тооцно.</P>
      <H>1. Үйлчилгээний тодорхойлолт</H>
      <P>Fleex нь GPS-д суурилсан флот хяналтын SaaS үйлчилгээ — байршил хяналт, тайлан, дохиолол, жолоочийн удирдлага зэрэг боломжийг багцын дагуу үзүүлнэ.</P>
      <H>2. Бүртгэл ба багц</H>
      <P>Хэрэглэгч үнэн зөв мэдээллээр бүртгүүлнэ. Багц бүр машины тоо, тайлан, мэдэгдлийн суваг, дата хадгалалтын хязгаартай. Туршилтын хугацаа дуусахад үргэлжлүүлэхийн тулд төлбөрт багц сонгоно.</P>
      <H>3. Төлбөр</H>
      <P>Төлбөрийг урьдчилан нэхэмжлэхийн дагуу төлнө. Нэхэмжлэх төлөгдөөгүй тохиолдолд хүлээлгийн (grace) хугацааны дараа үйлчилгээ түр хязгаарлагдаж болно. Төлсөн төлбөр буцаан олгогдохгүй (хуульд өөрөөр заагаагүй бол).</P>
      <H>4. Хэрэглэгчийн үүрэг</H>
      <P>Хэрэглэгч нэвтрэх мэдээллээ хариуцна; хууль бус, бусдын эрх ашгийг зөрчсөн зорилгоор Үйлчилгээг ашиглахыг хориглоно.</P>
      <H>5. Хязгаарлалт ба хариуцлага</H>
      <P>Үйлчилгээг "байгаагаар нь" үзүүлэх бөгөөд GPS төхөөрөмж/сүлжээний доголдлоос үүдэх шууд бус хохиролд хариуцлага хүлээхгүй. Бид 99.9% ажиллагааг зорьдог.</P>
      <H>6. Цуцлалт</H>
      <P>Аль ч тал нөхцөл зөрчигдсөн тохиолдолд үйлчилгээг түдгэлзүүлэх/цуцлах эрхтэй. Цуцалсны дараа дата экспортлох боломжийг тодорхой хугацаанд олгоно.</P>
      <H>7. Холбоо барих</H>
      <P>Асуудал, гомдлыг fleex@mediapro.mn хаягаар хүлээн авна.</P>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h1 className="text-2xl font-extrabold">Нууцлалын бодлого</h1>
      <P>Сүүлд шинэчилсэн: {new Date().getFullYear()} он. Бид таны болон таны флотын мэдээллийг хэрхэн цуглуулж, ашиглаж, хамгаалдгийг энд тайлбарлав.</P>
      <H>1. Цуглуулдаг мэдээлэл</H>
      <P>Бүртгэлийн мэдээлэл (нэр, имэйл, утас, байгууллага); GPS телеметр (байршил, хурд, мэдрэгчийн утга); ашиглалтын лог. Эдгээр нь үйлчилгээ үзүүлэх зайлшгүй шаардлагатай мэдээлэл юм.</P>
      <H>2. Ашиглах зорилго</H>
      <P>Флот хяналт, тайлан, дохиолол үзүүлэх; үйлчилгээг сайжруулах; төлбөр тооцоо; хууль ёсны шаардлага биелүүлэх.</P>
      <H>3. Хадгалалт ба байршил</H>
      <P>Дата нь Монгол улсад hosting хийгдсэн сервер дээр хадгалагдана. Байршлын түүхийг таны багцын хадгалалтын хугацааны дагуу хадгалж, дараа нь автоматаар устгана.</P>
      <H>4. Хуваалцах</H>
      <P>Бид таны мэдээллийг гуравдагч этгээдэд зарж борлуулахгүй. Зөвхөн үйлчилгээ үзүүлэхэд шаардлагатай боловсруулагчид (имэйл/SMS gateway гэх мэт) -д хязгаарлагдмал хүрээнд дамжуулна.</P>
      <H>5. Аюулгүй байдал</H>
      <P>Multi-tenant тусгаарлалт, эрхийн хяналт (RBAC), нэвтрэлтийн аудит, шифрлэлт зэрэг арга хэмжээгээр хамгаална. Гэвч интернэтэд 100% аюулгүй гэх баталгаа байхгүй.</P>
      <H>6. Таны эрх</H>
      <P>Та өөрийн мэдээлэлдээ хандах, засах, устгуулах, экспортлох хүсэлт гаргах эрхтэй. fleex@mediapro.mn хаягаар хандана уу.</P>
    </>
  );
}

function Dpa() {
  return (
    <>
      <h1 className="text-2xl font-extrabold">Дата боловсруулалтын гэрээ (DPA)</h1>
      <P>Энэхүү DPA нь Хэрэглэгч ("Дата хянагч") болон MediaPRO ХХК ("Дата боловсруулагч") хооронд хувийн өгөгдөл боловсруулахтай холбоотой үүргийг тодорхойлно.</P>
      <H>1. Боловсруулалтын зорилго ба хугацаа</H>
      <P>Боловсруулагч нь зөвхөн Хянагчийн зааварчилгааны дагуу, флот хяналтын үйлчилгээ үзүүлэх зорилгоор, гэрээ хүчинтэй хугацаанд өгөгдөл боловсруулна.</P>
      <H>2. Өгөгдлийн төрөл ба субьект</H>
      <P>Жолооч/ажилтны байршил, контакт мэдээлэл, тээврийн хэрэгслийн телеметр. Субьект нь Хянагчийн ажилтан/жолооч нар.</P>
      <H>3. Нууцлал ба аюулгүй байдал</H>
      <P>Боловсруулагч нь техникийн болон зохион байгуулалтын зохистой арга хэмжээ (шифрлэлт, хандалтын хяналт, аудит) авна; ажилтнууддаа нууцлалын үүрэг хүлээлгэнэ.</P>
      <H>4. Дэд боловсруулагч</H>
      <P>Имэйл (Brevo), SMS (CallPro) зэрэг дэд боловсруулагчийг ашиглаж болох бөгөөд тэдгээрт ижил түвшний хамгаалалт шаардана.</P>
      <H>5. Зөрчлийн мэдэгдэл</H>
      <P>Өгөгдлийн зөрчил илэрвэл Боловсруулагч нь Хянагчид зохистой хугацаанд мэдэгдэнэ.</P>
      <H>6. Дуусгавар</H>
      <P>Гэрээ дуусахад Хянагчийн сонголтоор өгөгдлийг буцаах эсвэл устгана (хуулиар хадгалах шаардлагатайг эс тооцвол).</P>
    </>
  );
}
