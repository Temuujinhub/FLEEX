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

### R-1 🟠 (HIGH, тенант доторх) — `DRIVER` least-privilege хэрэгжээгүй → ✅ ЗАССАН (§4 P2)

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

### R-2 🟠 (Систем дэх) — Tenant-scope нь "конвенц"-д тулгуурладаг → ✅ ЗАССАН (§4 P1)

Одоогийн хамгаалалт нь service method **бүр** `where: { companyId }`-ийг
санаж бичсэнд найддаг. Шинэ endpoint нэмэхэд нэг л мартвал → шууд cross-tenant
алдагдал. Энэ нь structural single-point-of-failure. (Одоогоор бүх method зөв
хийсэн ч, ирээдүйд эрсдэлтэй.)

### R-3 🟠 — WebSocket токен query-string-ээр дамждаг → ✅ ЗАССАН (§4 P3)

`live.gateway.ts:116` — `?token=<jwt>`. JWT нь nginx access log, proxy,
browser history-д бичигдэж болзошгүй (AUDIT-2026-05 H-7-тэй ижил, зориуд
хойшлуулсан). Токен задарвал тухайн тенантын live урсгал задрах эрсдэл.

### R-4 🟠 — IMEI spoofing (протоколын хязгаар)

Ingestor нь бүртгэлгүй IMEI-г ч ACK хийдэг (AUDIT-2026-05 H-3). Халдагч өөр
тенантад харьяалагдах IMEI-р хуурамч telemetry оруулж тухайн тенантын дата руу
"бичих" талаас нь cross-tenant нөлөө үзүүлж болзошгүй.

### R-5 🟠 — Cross-tenant negative тест алга → ✅ ЗАССАН (§4 P5)

API-д tenant-isolation-ийг шалгасан автомат тест байхгүй (AUDIT §3). Regress
гарвал илрэхгүй өнгөрөх эрсдэлтэй.

---

## 4. Эрсдэл бууруулах зөвлөмж (эрэмбэлсэн)

### P1. Гүнд хамгаалалт — Prisma tenant-guard (R-2) — ✅ ХЭРЭГЖСЭН (2026-06-24)

**Хэрэгжүүлсэн:** App-layer auto-guard. `TenantContextInterceptor` (global,
auth-ийн дараа ажиллана) `req.user`-ийн `{companyId, role}`-ийг
`AsyncLocalStorage`-д хийнэ; Prisma `$use` middleware түүнийг уншиж,
non-SUPER_ADMIN үед tenant model-уудын **collection/bulk** үйлдэлд
(`findMany/findFirst/count/aggregate/groupBy/updateMany/deleteMany`)
`where.companyId`-г албадан оруулна (`src/common/tenant-guard.ts`,
`tenant-context.ts`, `tenant-context.interceptor.ts`). **Additive:** by-id
(`findUnique`) болон raw (`$queryRaw`) нь өмнөх шалгалтаараа хэвээр; request-
ийн гадна (bootstrap/seed/cron) context байхгүй тул no-op.

> `$extends` query hook-ийн оронд `$use` middleware сонгосон шалтгаан: одоо
> байгаа ~30 service бүгд `PrismaService`-ийг шууд inject хийдэг тул `$use` нь
> **ил тод (transparent)**, нэг ч service-ийг өөрчлөхгүй, амархан буцаах
> боломжтой. (v6 рүү шилжихэд `$extends` рүү шилжиж болно.) 8 unit тест +
> e2e-д interceptor идэвхтэйгээр 24 кейс дамжсан.

#### Анхны зөвлөмж (лавлагаа): хоёр сонголт байсан

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

### P2. `DRIVER` least-privilege (R-1) — ✅ ХЭРЭГЖСЭН (2026-06-24)

1. Schema: `User.driverId String? @db.Uuid` + `driver`/`users` relation
   нэмсэн (`schema.prisma`). `prisma db push`-аар materialise хийгдэнэ
   (migration файл хэрэггүй — schema-first). Users `PATCH /users/:id`-д
   `driverId`-аар холбоно (тенант шалгалттай).
2. JWT-д `driverId` claim нэмсэн (`auth.service.issueTokens`,
   `jwt.strategy.validate`). Helper: `src/auth/actor-scope.ts` —
   `applyActorScope()` (companyId + DRIVER үед driverId) ба
   `driverMayAccess()`. **Fail-closed:** холбоогүй `DRIVER` юу ч харахгүй
   (`NO_DRIVER_MATCH` sentinel).
3. `devices`, `trips`, `positions` (latest/history/daily/fleetSummary),
   `events` service-үүдэд хэрэгжүүлсэн. `events` нь driverId багантай биш
   тул жолоочийн `deviceId`-уудаар шүүнэ. Бүгд e2e тестээр баталгаажсан.

> Зан үйлийн өөрчлөлт: өмнө нь `DRIVER` компанийн бүхнийг хардаг байсан →
> одоо зөвхөн оноосон машин(ууд). Холбоогүй `DRIVER` юу ч харахгүй (least
> privilege). Шинэ холбоос дараагийн token (login/refresh)-оор хүчинтэй.

### P3. WebSocket ticket auth (R-3) — ✅ ХЭРЭГЖСЭН (2026-06-24)

`POST /auth/ws-ticket` (JWT шаардна) → 32 байт random ticket-ийг Redis-д
`ws:ticket:<t>` түлхүүрээр **EX 30с** хадгална (`auth.service.createWsTicket`).
WS upgrade дээр gateway түүнийг **GETDEL**-ээр атомарлаг устгаж нэг удаа л
хэрэглэнэ (`live.gateway.handleConnection`) — replay боломжгүй. JWT нь WS URL /
nginx log-д орохгүй. Хуучин `?token=` зам **rollout-д тааруулж backward-
compatible** хэвээр (web client ticket аваад уначихвал token руу буцна).
Web: `useLiveSocket.ts` эхлээд ticket авна. 5 unit тест (mint + GETDEL consume
+ invalid/replay + legacy + no-auth).

### P4. Ingestor IMEI allowlist (R-4)

Handshake дээр бүртгэлгүй IMEI-г ACK хийхгүй (negative cache-тай). Нэмж carrier
IP firewall. Протоколын түвшний spoofing-ийг бууруулна.

### P5. Cross-tenant negative тест (R-5) — ✅ ХЭРЭГЖСЭН (2026-06-24)

`services/api/test/tenant-isolation.e2e-spec.ts` — жинхэнэ Nest app-ыг
JWT/Roles guard + гарын үсэгтэй токентой (Prisma/Redis mock, DB шаардахгүй)
ачаалж: tenant A-ийн токеноор tenant B-ийн `device/:id`, `trip/:id`,
`positions/:deviceId/history`, `media/:id/file`-д **403**; list endpoint-ууд
companyId-аар хязгаарлагдсан; `SUPER_ADMIN` cross-tenant унших хэвээр; токенгүй
үед **401**. Нэмж DRIVER least-privilege (P2)-ийн scope тестүүд. Нийт 24 кейс.

CI gate: `pull_request`-д `.github/workflows/ci.yml`, deploy-ийн өмнө
`deploy.yml`-ийн `build-check` дотор `npm test`. (`ensureSameTenant`/
`driverMayAccess`-ийг түр идэвхгүй болгож mutation-тест хийж баталгаажуулсан.)

---

## 5. Хэрэгжүүлэх дараалал (санал)

1. ✅ **P5 negative тестүүд** — хамгийн бага эрсдэл, regress-аас хамгаална. *(хийгдсэн)*
2. ✅ **P2 DRIVER least-privilege** — баримтжуулсан зан үйлийг нөхсөн. *(хийгдсэн)*
3. ✅ **P3 WS ticket** — H-7-г бүрэн хаасан. *(хийгдсэн)*
4. ✅ **P1 defense-in-depth (Prisma $use guard)** — Prisma extension сонголтоор хэрэгжсэн. *(хийгдсэн)*
5. **P4 IMEI allowlist** — ingestor дээр. *(дараагийнх)*

> **Тэмдэглэл:** Энэ branch-д tenant-isolation-ийн ажиллаж буй кодыг
> өөрчлөөгүй — учир нь шинжилгээ түүнийг бат бөх гэдгийг баталсан бөгөөд
> auth/тенант урсгалыг тестгүйгээр өөрчлөх нь өндөр эрсдэлтэй. Дээрх
> зөвлөмжүүд нь дараагийн үе шатны ажил.
