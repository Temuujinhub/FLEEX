# Fleex — Multi-tenant мэдээлэл алдагдлын эрсдэлийн дүн шинжилгээ (2026-06)

Энэхүү баримт нь Fleex олон-тенант (multi-tenant) SaaS дахь **тенант хооронд
мэдээлэл алдагдах (cross-tenant data leak)** эрсдэлд төвлөрсөн зорилтот аудит юм.
Бүх дүгнэлтийг API кодоос (NestJS, `services/api/src`) биечлэн уншиж
баталгаажуулсан. Энэ нь `docs/AUDIT-2026-05.md`-ийн бүх системийн аудитыг
орлохгүй, харин tenant-isolation талыг гүнзгийрүүлж, "эрсдэлийг яаж бууруулах вэ"
гэсэн асуултад тодорхой зөвлөмж өгнө.

> Тэмдэглэгээ: ✅ Баталгаажсан зөв · 🟠 Эрсдэл (зөвлөмжтэй) · 🔴 Critical

---

## 0. Нэгдсэн дүгнэлт

**Tenant-isolation бат бөх, зөв хэрэгжсэн.** Бүх tenant-хамаарал бүхий нөөц
(`devices`, `positions`, `events`, `trips`, `sensors`, `geofences`, `drivers`,
`media`, `service-tasks`, `reports` гэх мэт) дээр `companyId`-аар хязгаарлалт
хийгдсэн бөгөөд `companyId` нь **үргэлж JWT-ээс** (`req.user.companyId`) авдаг —
client-ийн өгсөн утгаас биш. IDOR (нөөцийг ID-аар нь авах үед тенант шалгахгүй
байх) **олдсонгүй**, raw SQL бүгд параметержсэн ба тенантаар хязгаарласан,
WebSocket fanout тенантаар шүүгддэг.

**Цорын ганц бодит цоорхой:** `DRIVER` дүрэм нь баримтжуулсан "зөвхөн өөрийн
оноосон машин"-ы зарчмыг хэрэгжүүлээгүй — `DRIVER` хэрэглэгч **компанийн бүх
машиныг** хардаг. Энэ нь *тенант доторх* хэт өргөн хандалт (least-privilege
зөрчил) бөгөөд тенант хоорондын алдагдал **биш**.

Иймээс яаралтай засвар шаардсан critical алдагдал алга. Доорх зөвлөмжүүд нь
голдуу **гүнд хамгаалалт (defense-in-depth)** ба least-privilege-ийг
сайжруулахад чиглэнэ.

---

## 1. Tenant-isolation одоогийн загвар (баталгаажсан)

| Давхарга | Механизм | Файл (нотолгоо) |
|---|---|---|
| **Identity** | JWT-д `sub, email, role, companyId`. `validate()` эдгээрийг л буцаана — payload-аас нэмэлт талбар итгэдэггүй. | `auth/jwt.strategy.ts:18-25` |
| **RBAC** | Шаталсан ladder (SUPER_ADMIN 100 → VIEWER 10). `@Roles(min)` decorator + `RolesGuard`. | `auth/roles.guard.ts:10-44` |
| **Tenant scope (read)** | Service бүр `where.companyId = actor.companyId` (non-super). | `devices.service.ts:17`, `sensors.module.ts:47`, `positions.service.ts:56` |
| **Tenant scope (by-id)** | Нөөцийг авсны дараа `ensureSameTenant()` / `companyId !== actor.companyId → Forbidden`. | `devices.service.ts:72`, `trips.module.ts:40`, `media.service.ts:70` |
| **Raw SQL** | Hypertable query-д `device_id`-ийг урьдчилан tenant-validate хийсэн, эсвэл `company_id = ${companyId}` шүүлт. | `positions.service.ts:36-50`, `reports.service.ts` (proximity, fetchWindow) |
| **WebSocket** | Fanout бүрд `ctx.companyId !== payload.companyId → skip` (SUPER_ADMIN бусад). | `websocket/live.gateway.ts:146-164` |
| **Audit** | Cross-tenant зөрчил → `403` + `outcome:"denied"` hash-chain бичлэг (404 биш — оршихуйг задруулдаггүй). | `docs/ARCHITECTURE.md §4`, `audit/*` |

### 1.1 Client-ээс `companyId` авдаг цорын ганц цэг — ЗӨВ

`devices.controller.ts` дахь `CreateDeviceDto.companyId?` нь client-ээс ирдэг,
гэвч service түүнийг **зөвхөн SUPER_ADMIN** үед хэрэглэнэ:

```ts
// devices.service.ts:84
const companyId = actor.role === 'SUPER_ADMIN'
  ? dto.companyId ?? actor.companyId
  : actor.companyId;          // non-super → client утгыг бүрэн үл харгалзана
```

Энэ нь зөв загвар: эрх багатай хэрэглэгч өөр тенантад машин үүсгэх боломжгүй.

---

## 2. Баталгаажуулсан ЗӨВ цэгүүд (✅)

| # | Шалгасан зүйл | Файл:мөр | Төлөв |
|---|---|---|---|
| S-1 | Device by-id — авсны дараа tenant шалгана | `devices.service.ts:72` | ✅ |
| S-2 | Trip by-id — `trip.companyId !== actor.companyId → 403` | `trips.module.ts:40` | ✅ |
| S-3 | Media/зураг by-id — `ensureTenant(img.companyId)` | `media.service.ts:70` | ✅ |
| S-4 | Driver scorecard by-id — tenant шалгалт | `reports.service.ts` (~398) | ✅ |
| S-5 | Positions history — raw query-ийн өмнө device ownership | `positions.service.ts:36-50` | ✅ |
| S-6 | Proximity raw SQL — `(${isSuper} OR p.company_id = ${companyId})` | `reports.service.ts` | ✅ |
| S-7 | WS fanout — per-client `companyId` шүүлт | `live.gateway.ts:154` | ✅ |
| S-8 | Device transfer — зөвхөн SUPER_ADMIN, бүх child мөрийг atomic шилжүүлнэ | `devices.service.ts:127-210` | ✅ |
| S-9 | Sensor create/update/delete — `sensor.companyId !== actor.companyId → 403` | `sensors.module.ts:55,77,84` | ✅ |
| S-10 | `ensureChildOwnership` — group/garage нь тухайн тенантынх эсэхийг шалгана | `devices.service.ts:388-402` | ✅ |

> SQL injection: бүх query tagged-template / Prisma параметртэй — string concat
> алга (AUDIT-2026-05 §1-тэй нийцэв).

---

## 3. Илэрсэн эрсдэл ба цоорхой

### R-1 🟠 (HIGH, тенант доторх) — `DRIVER` least-privilege хэрэгжээгүй

**Баримт (`ARCHITECTURE.md:161`):** «DRIVER — Read their own assignment(s) only
(route-level filter)».

**Бодит байдал:** Кодод `DRIVER`-т зориулсан нэг ч тусгай шүүлт алга
(`grep "role === 'DRIVER'"` → 0 үр дүн). `positions`, `devices`, `trips`,
`events` controller-ууд `@Roles(VIEWER)` тул `DRIVER` хэрэглэгч **компанийн бүх
машин, бүх байршил, бүх trip**-ийг хардаг.

**Үндсэн шалтгаан:** Schema-д **User↔Driver холбоос байхгүй** — `User`-д
`driverId` талбар, `Driver`-т `userId` талбар алга (`schema.prisma:65, 528`).
Тиймээс login хийсэн `DRIVER`-ийг тодорхой жолооч/машинд холбох боломжгүй.

**Нөлөө:** Тенант *доторх* хэт өргөн хандалт. Жишээ нь нэг жолооч бусад
жолоочдын маршрут, цаг, eco-оноог хардаг — нууцлал/HR-ийн асуудал. Тенант
**хооронд** алдагдахгүй (companyId шүүлт хэвээр).

### R-2 🟠 (Систем дэх) — Tenant-scope нь "конвенц"-д тулгуурладаг

Одоогийн хамгаалалт нь service method **бүр** `where: { companyId }`-ийг
санаж бичсэнд найддаг. Шинэ endpoint нэмэхэд нэг л мартвал → шууд cross-tenant
алдагдал. Энэ нь structural single-point-of-failure. (Одоогоор бүх method зөв
хийсэн ч, ирээдүйд эрсдэлтэй.)

### R-3 🟠 — WebSocket токен query-string-ээр дамждаг

`live.gateway.ts:116` — `?token=<jwt>`. JWT нь nginx access log, proxy,
browser history-д бичигдэж болзошгүй (AUDIT-2026-05 H-7-тэй ижил, зориуд
хойшлуулсан). Токен задарвал тухайн тенантын live урсгал задрах эрсдэл.

### R-4 🟠 — IMEI spoofing (протоколын хязгаар)

Ingestor нь бүртгэлгүй IMEI-г ч ACK хийдэг (AUDIT-2026-05 H-3). Халдагч өөр
тенантад харьяалагдах IMEI-р хуурамч telemetry оруулж тухайн тенантын дата руу
"бичих" талаас нь cross-tenant нөлөө үзүүлж болзошгүй.

### R-5 🟠 — Cross-tenant negative тест алга

API-д tenant-isolation-ийг шалгасан автомат тест байхгүй (AUDIT §3). Regress
гарвал илрэхгүй өнгөрөх эрсдэлтэй.

---

## 4. Эрсдэл бууруулах зөвлөмж (эрэмбэлсэн)

### P1. Гүнд хамгаалалт — Prisma tenant-guard extension (R-2)

`where: { companyId }`-ийг **автоматаар** оруулдаг давхарга нэмж, "мартах"
эрсдэлийг устгана. Хоёр сонголт:

- **Prisma Client Extension (`$extends` `query` hook):** tenant-хамаарал бүхий
  model жагсаалтад `findMany/findFirst/update/delete`-д `args.where.companyId`-г
  AsyncLocalStorage-аас авсан `actor.companyId`-аар автоматаар нэмнэ;
  SUPER_ADMIN үед алгасна. Raw query (`$queryRaw`) энэ hook-д ороогүй тул
  тэдгээрийг гар шүүлттэй хэвээр үлдээнэ.
- **Postgres Row-Level Security (RLS):** `ALTER TABLE … ENABLE ROW LEVEL
  SECURITY` + `current_setting('app.company_id')` policy. App холболт бүрт
  `SET app.company_id`. Хамгийн бат бөх (DB-түвшний баталгаа), гэвч migration
  ба connection-pool тохиргоо шаардлагатай.

> Анхааруулга: хоёуланг нь super_admin global унших, `positions` raw query,
> бүх одоо байгаа flow дээр **тестээр баталгаажуулж** нэвтрүүлэх ёстой —
> сохроор нэвтрүүлбэл уншилт тасрах эрсдэлтэй. Тиймээс энэ нь зориудаар код
> биш зөвлөмж хэлбэрээр энд орсон.

### P2. `DRIVER` least-privilege (R-1)

1. Schema: `User.driverId String? @db.Uuid` (эсвэл `Driver.userId`) нэмж,
   login-ийг жолоочид холбоно. Migration + Users UI-д "холбох" талбар.
2. Helper: `scopeForActor(actor)` — `DRIVER` бол `{ companyId, driverId:
   actor.driverId }` эсвэл оноосон `deviceId`-уудаар хязгаарлана.
3. `positions/devices/trips/events` service-үүдэд энэ helper-ийг хэрэглэнэ.

### P3. WebSocket ticket auth (R-3)

Query-string токены оронд: REST `POST /auth/ws-ticket` → богино настай (≤30с)
нэг удаагийн ticket (Redis). WS upgrade дээр ticket-ийг шалгаж устгана. JWT
log-д орохгүй болно.

### P4. Ingestor IMEI allowlist (R-4)

Handshake дээр бүртгэлгүй IMEI-г ACK хийхгүй (negative cache-тай). Нэмж carrier
IP firewall. Протоколын түвшний spoofing-ийг бууруулна.

### P5. Cross-tenant negative тест (R-5)

Хамгийн бага зардлаар хамгийн их үнэ цэнэ: tenant A-ийн токеноор tenant B-ийн
`device/:id`, `trip/:id`, `positions/:id/history`, `/media/:id`-д хандаж
**403** буцаахыг шалгасан Vitest/e2e багц. CI gate болгоно.

---

## 5. Хэрэгжүүлэх дараалал (санал)

1. **P5 negative тестүүд** — хамгийн бага эрсдэл, regress-аас хамгаална. (эхэлэх)
2. **P2 DRIVER least-privilege** — баримтжуулсан зан үйлийг нөхнө.
3. **P3 WS ticket** — H-7-г бүрэн хаах.
4. **P1 defense-in-depth (RLS/extension)** — тестийн дараа, үе шаттай.
5. **P4 IMEI allowlist** — ingestor дээр.

> **Тэмдэглэл:** Энэ branch-д tenant-isolation-ийн ажиллаж буй кодыг
> өөрчлөөгүй — учир нь шинжилгээ түүнийг бат бөх гэдгийг баталсан бөгөөд
> auth/тенант урсгалыг тестгүйгээр өөрчлөх нь өндөр эрсдэлтэй. Дээрх
> зөвлөмжүүд нь дараагийн үе шатны ажил.
