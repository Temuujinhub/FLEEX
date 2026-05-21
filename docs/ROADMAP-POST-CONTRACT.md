# Fleex дараагийн алхамын төлөвлөгөө (гэрээ байгуулагдсаны дараа)

Энэхүү баримт нь Оюу Толгойн (OT) тендер-ийн үе шатанд хийсэн аудитын үр дүн
дээр үндэслэсэн **дараагийн хөгжүүлэлтийн нэн тэргүүний жагсаалт** юм.
Тэргүүлэх шалгуур: (1) OT шаардлагад нэн чухал, (2) одоо байгаа дотоод бүтэц
дээр тулгуурлан хэрэгжүүлж бэлэн, (3) ROI өндөр.

> Хэрэгжүүлэх товлогдсон огноо: **гэрээ байгуулагдсаны дараа**. Үе шат тус
> бүрд ажлын тооцоолол хийгдсэн (бага = 1-3 өдөр, дунд = 1-2 долоо хоног,
> том = 2-4 долоо хоног).

## Явц (live)

| Эрэмбэ | Нэр | Төлөв | Commit |
|---|---|---|---|
| 1 | Place ↔ Geofence sync | ✅ Хийгдсэн | `7494dc1` + `d0f382a` |
| 2 | Driver scorecard PDF (cron v2) | ✅ Хийгдсэн | сар бүрийн 1-ний 02:00 UTC, дедуплекс Redis |
| 3 | PANIC ойролцоо машин зарлуулах | ✅ Хийгдсэн | `7494dc1` |
| 4 | Geofence өдөр/шөнө хурд | ✅ Хийгдсэн | `7494dc1` + `d0f382a` |
| 5 | Driver shift hierarchy (v1) | ✅ Хийгдсэн | (энэ commit). Shift-aware reports v2 |
| 6 | Dispatcher board v1 | ✅ Хийгдсэн | `2069d93` + `33fb7aa` |
| 7 | Idle billing тайлан | ✅ Хийгдсэн | `f3c53e6` |
| 8 | Sensor calibration UI | ✅ Хийгдсэн | (энэ commit) |
| 9 | Lone-worker alert | ✅ Хийгдсэн | (энэ commit) |
| 10 | Service prediction (v1: linear) | ✅ Хийгдсэн | (энэ commit) |

---

## ⭐ Эрэмбэ 1 — Place ↔ Geofence sync + Place-based alert

**Хур:** Бага–Дунд (2–3 өдөр)
**Шалтгаан:** Email/SMS pipeline аль хэдийн бэлэн. Places feature
"static map" биш "operational anchor" болгож хувиргана.

**Хийгдэх ажил:**
- `Place` дээр `radiusM` тохируулсан тохиолдолд `Geofence` (CIRCLE) автоматаар
  үүсгэх/sync хийх Prisma hook эсвэл service layer
- `NotificationRule` schema-д `placeId`, `radiusM`, `dwellS` (зогссон хугацаа)
  талбарууд нэмэх
- Events engine-д Place enter/exit/dwell event төрөл нэмэх (`PLACE_ENTER`,
  `PLACE_EXIT`, `PLACE_DWELL`)
- UI: Notification rules form-д "Place сонгох" dropdown нэмэх

**Гаргах үр дүн:** "Жинлүүрт 30 минут ажилласан үед SMS", "REFUEL цэгээс
гарсан үед webhook" төрлийн дүрмүүд оператор-аас 2 минут хийгдэх боломж.

---

## ⭐ Эрэмбэ 2 — Driver scorecard PDF (сар бүр)

**Хур:** Дунд (1 долоо хоног)
**Шалтгаан:** `eco/` модуль дүн (harshAccel, harshBrake, idleS, speeding) аль
хэдийн цуглуулдаг. PDF render + cron явуулах ажил л үлдсэн.

**Хийгдэх ажил:**
- BullMQ scheduled job: сар бүрийн 1-нд, өмнөх сарын дүнгийн дагуу хэн нэгэн
  жолоочид
- PDF template (react-pdf эсвэл puppeteer)
- Жолоочид и-мэйлээр илгээх (EmailService аль хэдийн ажилладаг)
- Менежерт нэгдсэн ranked report илгээх
- UI: жолоочийн профайл дээр "Сүүлийн scorecard" татах товч

**Гаргах үр дүн:** Үргэлж ажилладаг safety culture loop. OT-ийн жолоочийн
гүйцэтгэл мониторинг шаардлагатай хэрэгцээ.

---

## Эрэмбэ 3 — PANIC автомат ойролцоо машин зарлуулах

**Хур:** Бага (1 өдөр)
**Шалтгаан:** `EventType.PANIC` бүртгэгддэг. `proximityReport` логик байна.
Дутаж буй холбоо: PANIC ⇒ dispatch service ⇒ ойр машин руу SMS.

**Хийгдэх ажил:**
- `notification-dispatcher.service.ts`-д PANIC event-ийн тусгай handler
- 5km дотор COMPANY-ын ACTIVE машинуудыг олох
- Жолоочийн утсанд SMS илгээх (PANIC утсаар + локацийн линктэй)
- Дуудлагын журналд бүртгэх

**Гаргах үр дүн:** Жолоочийн аюулгүй байдлын Mining HSE стандарт.

---

## Эрэмбэ 4 — Geofence schedule (өдөр/шөнө хурдны хязгаар)

**Хур:** Бага (1 өдөр)
**Шалтгаан:** OT-д "өдрийн / шөнийн хурд харилцан адилгүй" шаардлага.
`Geofence.speedLimit` одоо ганц integer.

**Хийгдэх ажил:**
- Schema migration: `speedLimit` -> `speedLimits: Json` (өдөр/шөнө/ажлын
  өдөр/амралтын өдөр)
- Events engine: одоогийн цаг + өдрийн өдөр гүйцэтгэх хязгаарыг сонгох
- UI: Geofence form-д хуваарь оруулах хэсэг

---

## Эрэмбэ 5 — Driver shift hierarchy

**Хур:** Том (1 долоо хоног)
**Шалтгаан:** Одоо `Driver` ↔ `Device` хатуу нэг-нэг. Олон жолооч 1 машинд
ээлжээр ажилладаг бодит OT нөхцөл schema-д байхгүй.

**Хийгдэх ажил:**
- `DriverShift` model: driverId, deviceId, startsAt, endsAt, shiftType
- Trip-д driverId-г shift-аас deriv хийх логик
- UI: жолоочийн өдрийн хуваарийн календарь
- Тайлан: жолооч тус ээлжийн дүнг ялгах

---

## Эрэмбэ 6 — Dispatcher board v1

**Хур:** Том (1.5 долоо хоног)
**Шалтгаан:** LiveMap зөвхөн маркер харуулна. Уурхайн dispatcher-т "дараагийн
ачаа", "ETA to dump", "idle alert" зэрэг ажлын самбар хэрэгтэй.

**Хийгдэх ажил:**
- React-grid-layout based панелд: машины жагсаалт + статус + дараагийн
  routing
- Машин дээр статус (LOADED / EMPTY / IDLE / OFFLINE) state machine
- Drag-drop "Хуваарь өгөх" UI
- LiveGateway-аас real-time update

---

## Эрэмбэ 7 — Idle time нэхэмжлэлийн тайлан

**Хур:** Бага (2-3 өдөр)
**Шалтгаан:** `eco/` дотор `idleS` цуглуулсан. Тариф × цаг → Excel экспорт
бэлэн болно.

**Хийгдэх ажил:**
- Reports module-д "Idle billing" тайлан
- Тариф (₮/цаг) тохиргоо UI
- Excel экспорт

---

## Эрэмбэ 8 — Sensor calibration UI

**Хур:** Бага (2 өдөр)
**Шалтгаан:** `Sensor.calibration: Json` piecewise lookup дэмждэг боловч
оператор raw JSON оруулах шаардлагатай.

**Хийгдэх ажил:**
- Калибрацийн оруулах хүснэгт UI (raw мВ → литр гэх мэт)
- Урьдчилан харах график (linear interpolation visualization)

---

## Эрэмбэ 9 — Lone-worker heuristic alert

**Хур:** Дунд (3-4 өдөр)

**Хийгдэх ажил:**
- Холбоо тасрах + 2 цагийн хөдөлгөөнгүй байх ⇒ автомат SOS escalation
- Эзэмшигч менежер рүү SMS+имэйл
- UI-д "Эрсдэлд буй машин" widget

---

## Эрэмбэ 10 — Тогтмол үйлчилгээний урьдчилан тооцоолол

**Хур:** Том (2 долоо хоног)
**Шалтгаан:** `ServiceTask` model байна. "Одометр + цаг + дундаж" дээр
тулгуурлан "дараагийн oil change 12 хоногийн дараа" предикт хийх.

**Хийгдэх ажил:**
- Цуглуулсан одометр трендээс predictive layer (linear extrapolation эхлээд,
  дараа нь ML)
- "Удахгүй хийгдэх засвар" жагсаалт
- 14 хоногийн өмнө mail alert

---

## Засвар-Шинэчилт хийгдэхгүй (Out of scope, OT-аас зөвшөөрөл шаардлагатай)

- **Video/Camera (MDVR) ingest** — нэмэлт microservice + S3 хадгалалт
  шаардлагатай. Системийн админтай холбогдож нээх ёстой.
- **Multi-region failover** — одоо single-region (DigitalOcean Singapore).
  Өсөлтийн дараагийн фаз.
- **Mobile native app** — одоо зөвхөн responsive web. Мобайл native шаардлага
  гарвал тусдаа төлөвлөгөө.

---

## Хэрэгжүүлэх дараалал

Гэрээ байгуулагдсаны дараа дараах дарааллаар хэрэгжүүлэхийг санал болгож байна:

1. Эрэмбэ 1 (Place + alert) + Эрэмбэ 3 (PANIC dispatch) — нэг sprint
2. Эрэмбэ 4 (Geofence schedule) + Эрэмбэ 7 (Idle billing) — нэг sprint
3. Эрэмбэ 2 (Driver scorecard PDF) — нэг sprint
4. Эрэмбэ 5 (Driver shift) — нэг sprint
5. Эрэмбэ 6 (Dispatcher board) — нэг sprint
6. Эрэмбэ 8–10 — багц байдлаар, шаардлагын дагуу

Нийт тооцоолол: **6–8 sprint** (12–16 долоо хоног), нэг хөгжүүлэгчээр.
