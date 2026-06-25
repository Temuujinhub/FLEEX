# Fleex — Зориудын халдлагаас сэргийлэх аюулгүй байдлын аудит (2026-06)

Энэ баримт нь Fleex GPS-SaaS-ийн **зориудын халдлагач (adversarial threat
model)**-д төвлөрсөн өргөн хүрээний аудит юм. Өмнөх `AUDIT-2026-05.md`
(бүх системийн) ба `SECURITY-MULTI-TENANT-2026-06.md` (тенант-тусгаарлалт,
P1–P5 бүгд хэрэгжсэн)-ийг **орлохгүй**, харин «халдагч юу хийж чадах вэ, түүнээс
яаж сэргийлэх вэ» гэдгийг тодорхойлно.

**Аргачлал:** халдах гадаргуу (attack surface) тус бүрээр 4 зэрэгцээ adversarial
шинжилгээ — (1) auth/authz/session (API), (2) injection/untrusted-input
(API+web), (3) сүлжээнд ил Go үйлчилгээ (ingestor/media/events), (4)
infra/secrets/supply-chain/DoS. Бүх High дүгнэлтийг кодоос биечлэн
баталгаажуулсан.

> Тэмдэглэгээ: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low · ✅ Баталгаажсан зөв

---

## 0. Нэгдсэн дүгнэлт

**Ерөнхий байдал бат бөх.** P1–P5 (cross-tenant тест, DRIVER least-privilege,
WS ticket, Prisma tenant-guard, IMEI allowlist) хэрэгжсэн; **SQL injection огт
алга** (бүх raw query параметржсэн tagged-template), **SSRF хамгаалалт хүчтэй**
(webhook нь DNS-rebinding-ийн эсрэг resolved-IP-г pin хийдэг, RFC1918/loopback/
metadata блоклодог), **XSS алга** (React auto-escape, `dangerouslySetInnerHTML`
байхгүй), **command injection алга**, RBAC escalation хаалттай.

**Гэвч зориудын халдлагын өнцгөөс шинэ цоорхой олдлоо.** Critical (яаралтай
бүрэн эвдрэл) алга, гэхдээ **7 High** байгаа бөгөөд гол эрсдэл нь:
1. **media-service** — холболтын хязгааргүй + халдагчийн зарласан тоонд тулгуурлан
   64MB урьдчилан зарцуулдаг → **нэвтрэлтгүй алсын OOM (DoS)**; бас root-аар
   ажилладаг.
2. **Контейнерийн хатуужил** — resource limit огт алга → host-wide OOM cascade;
   бүрэн capability.
3. **WebSocket** — DRIVER scope хэрэгжээгүй (P2-ийн real-time цоорхой) + legacy
   `?token=` зам идэвхтэй (H-7 буцаан нээх).
4. **`prisma db push --accept-data-loss`** boot бүрт автоматаар.

Дүн: **7 High · 9 Medium · 9 Low**.

---

## 0.1 Хэрэгжүүлэлтийн төлөв — ✅ БҮГД ЗАССАН (2026-06-24)

Доорх **бүх 25 олдворыг** хэрэгжүүлсэн (A1–A7), тест/build-аар баталгаажуулсан:

| Багц | Commit сэдэв | Хамрах олдвор |
|---|---|---|
| **A1** | media-service DoS хатуужил | H1, H2, M1, H6(non-root) |
| **A2** | контейнерийн limit + cap_drop | H5, H6 |
| **A3** | WS driver-scope + legacy token хаалт | H3, H4 |
| **A4** | db push gating + автомат backup | H7, L6 |
| **A5** | export formula-guard + import cap | M2, M3 |
| **A6** | timing-safe login, throttle, health, MFA | M5, L2, L3, M4 |
| **A7** | supply-chain + ops + low items | M6, M7, M8, M9, L1, L4, L5, L8, L9 |

Шалгалт: API 47 тест ✅, Go 3 service build/vet/test ✅, web tsc/build ✅,
`docker compose config` ✅, бүх shell `bash -n` ✅. Шинэ тестүүд: WS
`shouldDeliver` driver-scope матриц, ticket-д driver deviceId, export
`hardenWorkbook`. PR #52.

> Үлдсэн зөвхөн **гадаад/ops-аас хамаарах** алхмууд (код биш): backup timer,
> certbot renew timer, carrier CIDR-ийг **host дээр enable** хийх (DEPLOYMENT.md),
> media volume-ийн нэг удаагийн chown, шаардвал `WS_ALLOW_TOKEN_QUERY` /
> `PRISMA_DB_PUSH_ACCEPT_DATA_LOSS` флагууд.

---

## 1. Олдворын хүснэгт (severity-аар)

| ID | Зэрэг | Гадаргуу | Байршил | Товч |
|---|---|---|---|---|
| **H1** | 🟠 | media (Go) | `media-service/cmd/media/main.go` accept loop | Холболтын хязгаар алга → FD/goroutine/санах ой шавхах DoS |
| **H2** | 🟠 | media (Go) | `internal/camera/camera.go:121` | START дахь packet тоонд тулгуурлан 64MB урьдчилан зарцуулна → алсын OOM |
| **H3** | 🟠 | WS (API) | `websocket/live.gateway.ts:173-191`, `auth.service.ts:createWsTicket` | DRIVER fanout-д scope-гүй → жолооч компанийн бүх машины real-time урсгал хардаг |
| **H4** | 🟠 | WS (API) | `websocket/live.gateway.ts` (legacy token зам) | `?token=<JWT>` зам идэвхтэй → JWT log/history-д алдагдах (H-7 regress) |
| **H5** | 🟠 | infra | `docker-compose.yml` (бүх 7 service) | mem/cpu/pids limit алга → нэг service бүх host-ыг OOM болгоно |
| **H6** | 🟠 | infra | `docker-compose.yml`, `media-service/Dockerfile:14` | Бүрэн capability, `no-new-privileges` алга; media-service **root**-аар |
| **H7** | 🟠 | infra | `services/api/Dockerfile:51` | `prisma db push --accept-data-loss` boot бүрт автоматаар → өгөгдөл устгах |
| **M1** | 🟡 | media (Go) | `camera.go:85`, `store.go` retention | Сокет зөвхөн хуурамчилж болох IMEI-р баталгааждаг; retention global → тенант хоорондын медиа injection/eviction |
| **M2** | 🟡 | injection | `reports/report-exporters.ts`, `reports.service.ts` | Excel/CSV **formula injection** (=cmd/WEBSERVICE) нэр→event→export |
| **M3** | 🟡 | injection | `devices.service.ts:238-312` import | Excel import мөр хязгааргүй + zip-bomb → DB/санах ой DoS |
| **M4** | 🟡 | auth | `schema.prisma:84`, `auth.service.ts` | MFA dead-code: `mfaEnabled/mfaSecret` байгаа ч хаана ч шалгадаггүй |
| **M5** | 🟡 | auth | `auth.service.ts:64-77` | Login timing oracle → хэрэглэгч enumeration |
| **M6** | 🟡 | supply | `*/Dockerfile`, `.github/workflows/*`, `.gitignore` | `npm install` (ci биш) + lockfile `.gitignore`-д → reproducible биш, supply-chain |
| **M7** | 🟡 | infra | `.env.example:171`, bootstrap | `BOOTSTRAP_ADMIN_PASSWORD` committed default, fail-fast guard-гүй |
| **M8** | 🟡 | ci/cd | `admin-task.yml:95`, `deploy.yml:147` | REF/SHA-г SSH shell string-д quote-hardening-гүй оруулна (defense-in-depth) |
| **M9** | 🟡 | ops | `admin-task.sh` ↔ `docker-compose.yml` | Service нэр зөрүү (`ingestor` vs `gps-ingestor`) → incident-response эвдрэх |
| **L1** | ⚪ | media/ingestor | `docker-compose.yml` 5027/5029 | Cleartext TCP 0.0.0.0 дээр source-IP хязгааргүй → carrier IP firewall хэрэгтэй |
| **L2** | ⚪ | auth | `app.module.ts`, `auth.controller.ts` | Throttler зөвхөн per-IP; `/auth/refresh`-д тусгай throttle алга |
| **L3** | ⚪ | auth | `health/health.controller.ts` | Public `/health` дотоод алдааны мессеж задруулна |
| **L4** | ⚪ | injection | `media/media.service.ts:78` | Content-Disposition filename injection (needs-verification) |
| **L5** | ⚪ | injection | `notifications/sms.service.ts:210` | SMS хүлээн авагч+body log-д бичигдэнэ (PII) |
| **L6** | ⚪ | infra | `infra/` (байхгүй) | Off-host backup автоматжуулалт алга → өгөгдөл алдагдлын SPOF |
| **L7** | ⚪ | infra | `infra/deploy/enable-tls.sh` | TLS гэрчилгээ сунгалт автоматгүй → чимээгүй expire = self-DoS |
| **L8** | ⚪ | ingestor (Go) | `store/commands.go:35` | Redis байхгүй үед command loop 100% CPU busy-spin |
| **L9** | ⚪ | supply | `*/go.mod` | `golang.org/x/crypto v0.17.0` хуучирсан (needs-verification) |

---

## 2. High олдворууд (нарийвчилсан)

### H1 🟠 media-service — холболтын хязгаар алга (алсын DoS)
**Байршил:** `services/media-service/cmd/media/main.go` accept loop. Харьцуул:
ingestor нь `INGESTOR_MAX_CONNECTIONS`-ийг `Accept()` дээр албаждаг (баталгаажсан),
media-service-д ийм config **байхгүй**.
**Халдлага:** `:5029` нь `0.0.0.0`-д нээлттэй. Халдагч хязгааргүй TCP холболт
нээнэ; тус бүр `handle` goroutine үүсгэж init read дээр 60с, дараа frame бүрд 120с
блоклоно. H2-той хосолбол холболт тус бүр 64MB бариад FD/goroutine/санах ой
шавхаж процессыг OOM болгоно.
**Засвар:** ingestor шиг `MEDIA_MAX_CONNECTIONS` нэмж accept loop дээр шалгах.

### H2 🟠 media-service — packet тоонд тулгуурласан 64MB урьдчилсан зарцуулалт
**Байршил:** `camera.go:121` — `fileBuf := make([]byte, 0, int(packets)*1024)`,
`packets` нь wire-ээс ирэх uint32, зөвхөн `maxPackets=1<<16` (64MB)-аар хязгаарлагдсан.
**Халдлага:** төхөөрөмж valid 16-байт init + START илгээж `packets=65535` зарлана.
Сервер DATA ирэхээс **өмнө** ~64MB багтаамж нөөцлөөд, халдагч холболтыг чимээгүй
бариад зогсоно (slowloris). H1-тэй (хязгааргүй холболт) хосолбол шууд санах ой
шавхалт.
**Засвар:** `packets`-аас бүү урьдчил; DATA ирэх тусам `append`-ээр өсгөж, хатуу
байт дээд хязгаар (`MEDIA_MAX_FILE_BYTES`) тавих; `maxPackets`/timeout багасгах.

### H3 🟠 WebSocket fanout-д DRIVER least-privilege хэрэгжээгүй
**Байршил:** `live.gateway.ts:173-191` (fanout зөвхөн `companyId`+client-ийн
`deviceFilter`-ээр шүүдэг), `auth.service.ts createWsTicket` (ticket payload-д
`driverId` алга).
**Халдлага:** DRIVER нэвтэрч `POST /auth/ws-ticket` → `/ws?ticket=…` холбогдоод
`subscribe`-д хоосон `deviceIds` илгээнэ. `fanout()` driver scope хийдэггүй тул
жолооч **компанийн бүх машины** live байршил+event хүлээн авна. REST талд (P2)
зассан ч real-time урсгал нь tracking бүтээгдэхүүний гол гадаргуу тул энэ нь P2-г
жолоочдын хувьд үндсэндээ хүчингүй болгоно. `deviceFilter` нь халдагчийн
мэдэлд — аюулгүйн хил **биш**.
**Засвар:** ws-ticket payload-д `driverId`/role нэмж, `fanout()`-д
`ctx.role==='DRIVER'` үед жолоочид оноосон deviceId-д үл орох envelope-ийг
хаях (connect үед deviceId-уудыг resolve хийж `ClientCtx`-д кэшлэх,
`subscribe`-д шинэчлэх). Холбоогүй жолоочид fail-closed (`NO_DRIVER_MATCH`-тэй
ижил).

### H4 🟠 Legacy `?token=<JWT>` WS зам идэвхтэй (H-7 regress)
**Байршил:** `live.gateway.ts` legacy branch (ticket-ийн дараах fallback).
**Халдлага:** P3 нь JWT-г WS URL/nginx log/browser history-д орохгүй болгох
зорилготой ticket нэмсэн. Гэвч legacy branch query-string-д бүтэн JWT-г хүлээн
авсаар байна. Log унших эрхтэй хэн ч (ops, log-aggregation viewer, эсвэл log
хүрэх SSRF) 15 минутын bearer токеныг сэргээж REST дээр replay хийнэ.
**Засвар:** web client одоо ticket ашигладаг тул legacy замыг анхдагчаар
**off** env флаг (`WS_ALLOW_TOKEN_QUERY=false`)-аар хаах эсвэл бүр устгах; шаардвал
зөвхөн `Authorization` header-ийг үлдээх (query string-ийг үгүй).

### H5 🟠 Контейнерийн resource limit огт алга (host-wide OOM cascade)
**Байршил:** `docker-compose.yml` (7 service — `mem_limit`/`cpus`/`pids_limit`/
`deploy.resources` алга).
**Халдлага:** бүх service нэг 4GB droplet дээр cgroup cap-гүй. Ingestor-ийн queue
(16384), том Codec-12 reply, DualCam flood (H1/H2), эсвэл хүнд report нэг
контейнерийг бүх RAM идэхэд хүргэнэ → Linux OOM-killer дурын контейнер (ихэвчлэн
Postgres) алж бүх stack унана. Compose-ийн комментууд өмнө «OOM-driven 502»
гарч байсныг дурдсан = бодит эрсдэл.
**Засвар:** service бүрд `mem_limit`/`cpus`/`pids_limit` тавих (ж: postgres 1.5GB,
redis = REDIS_MAXMEMORY+overhead, api 768MB, Go service бүр 256–512MB).

### H6 🟠 Бүрэн capability; `no-new-privileges` алга; media-service root-аар
**Байршил:** `docker-compose.yml` (`security_opt`/`cap_drop` аль ч service-д
алга), `media-service/Dockerfile:14-24` (`USER` алга → root).
**Халдлага:** контейнер бүр Docker-ийн default capability-г хадгалж setuid-аар
эрх авч болно. media-service нь интернетэд ил 2 listener-ийн нэг (5029) бөгөөд
**root**-аар ажилладаг тул гар-бичсэн DualCam parser дахь санах ойн алдаа →
контейнер доторх root RCE (бусад Go service `USER fleex`-рүү буудаг). Root-аас
kernel/cap escape хийхэд хамаагүй амар.
**Засвар:** бүх service-д `security_opt: ["no-new-privileges:true"]`,
`cap_drop: ["ALL"]`; media-service-д non-root `USER` + volume-ийг `chown`;
stateless Go service-д `read_only: true` + `tmpfs`.

### H7 🟠 `prisma db push --accept-data-loss` boot бүрт автоматаар
**Байршил:** `services/api/Dockerfile:51` CMD.
**Халдлага:** Гадны халдлага гэхээс илүү deploy/`restart-api`/auto-deploy замаар
хүрэх **өөрийгөө устгах** эрсдэл. `--accept-data-loss` нь schema.prisma-д
тааруулахын тулд багана/хүснэгт review-гүйгээр устгаж болно. Deploy branch-д
буруу schema засвар merge хийгдвэл (эсвэл тийм branch-д commit хийж чадах
халдагч) production Postgres дээр контейнер асахад устгалттай хэрэгжинэ.
`|| echo WARNING` нь зөвхөн хатуу алдааг барина, чимээгүй устгалыг биш.
**Засвар:** production-д review хийсэн `prisma migrate deploy`-руу шилжих;
auto-CMD-д `--accept-data-loss` бүү тавь; ядаж анхдагчаар off env флагаар хаах;
schema apply-ийн өмнө off-host `pg_dump` (L6) гүйцэтгэх.

---

## 3. Medium ба Low (товч засвар)

- **M1** media auth: ingestor-ийн registered-device gate-ийг media-д мөн хэрэглэх
  + API-аас олгох богино настай capture token; retention-ийг per-device/company
  болгох (global 5000 биш).
- **M2** export formula injection: бүх exporter-т `=`,`+`,`-`,`@`,tab,CR-ээр
  эхэлсэн нүдэнд `'` угтвар нэмэх `safeCell()` helper.
- **M3** import DoS: `ws.rowCount` дээд хязгаар (ж: 5000), `createMany` chunk,
  streaming reader.
- **M4** MFA: эсвэл TOTP-г бодитоор хэрэгжүүлэх (login дээр шалгах + enroll/verify
  endpoint), эсвэл `mfaEnabled/mfaSecret`-г UI-аас хасах (хуурамч хамгаалалт
  бүү харуул).
- **M5** timing oracle: хэрэглэгч олдоогүй үед тогтмол fake hash-аар Argon2id
  dummy verify ажиллуулж бүх замын хугацаа/статус-ыг жигдрүүлэх.
- **M6** supply chain: build+CI-г `npm ci`-руу шилжүүлэх; `.gitignore`-оос
  `package-lock.json` хасах; `govulncheck`-ийг Go CI-д нэмэх.
- **M7** bootstrap pw: `SEED_DEMO_PASSWORD`-тэй ижил fail-fast guard-ийг
  `BOOTSTRAP_ADMIN_PASSWORD`-д тавих + анхны нэвтрэлтэд солих албадлага.
- **M8** SSH injection: remote shell string-д хувьсагч бүү бүтээ — `ssh … bash -s`
  stdin эсвэл `printf %q`; `REF`-ийг `^[A-Za-z0-9._/-]+$`-ээр шалгах.
- **M9** ops mismatch: `admin-task.sh` ↔ `admin-task.yml` ↔ compose service нэрийг
  тааруулах; `events-engine`/`media-service`-д restart/logs нэмэх.
- **L1** carrier IP firewall: 5027/5029-г mobile carrier APN egress муж руу host
  firewall дээр хязгаарлах.
- **L2** `/auth/refresh`-д `@Throttle`; per-account (IP-ээс үл хамаарах) failed-
  login velocity counter + alert.
- **L3** `/health`-г unauth-д boolean/`degraded` болгож дотоод алдааг зөвхөн
  server log-д.
- **L4** media filename-ийг `[\w.\-]` allowlist-ээр цэвэрлэх / RFC5987
  `filename*=`; media-service бичих замын sanitization шалгах.
- **L5** SMS log-оос хүлээн авагч/body хасах эсвэл debug-д.
- **L6** шөнийн `pg_dump -Fc` (+ Redis RDB) off-host object storage руу
  cron/systemd-timer; restore-тест; WAL/PITR.
- **L7** `enable-tls.sh`-д renewal timer + `--deploy-hook` reload + webroot
  (port-80 outage-гүй); expire <14 хоногт alert.
- **L8** Redis nil үед command loop-ийг sleep-тэй болгох эсвэл бүү эхлүүл.
- **L9** `go get -u golang.org/x/crypto@latest && go mod tidy` 3 модульд.

---

## 4. Эрэмбэлсэн хариу арга хэмжээ (санал)

> Зориудын халдлагаас сэргийлэх дараалал — нөлөө/эрсдэл ÷ зардлаар.

1. **A1 — media-service хатуужил (H1+H2+M1+H6-ийн root):** холболтын хязгаар,
   урьдчилсан зарцуулалтыг арилгах + хатуу байт cap, non-root `USER`, per-device
   retention/capture token. *(Хамгийн өндөр: нэвтрэлтгүй алсын OOM-ийг хаана.)*
2. **A2 — Контейнерийн хатуужил (H5+H6):** бүх service-д resource limit +
   `cap_drop:ALL` + `no-new-privileges`. *(Blast-radius хязгаарлах, бага зардал.)*
3. **A3 — WS бүрэн хаалт (H3+H4):** fanout-д DRIVER scope + legacy token замыг
   off. *(P2/P3-ийн үлдэгдэл оёдлыг бүрэн хаана.)*
4. **A4 — Өгөгдлийн аюулгүй байдал (H7+L6):** `migrate deploy`-руу + автомат
   off-host backup/PITR.
5. **A5 — Injection полиш (M2+M3):** export formula sanitization + import row cap.
6. **A6 — Auth полиш (M5+M4+L2+L3):** timing-safe login, MFA шийдвэр, refresh
   throttle, health алдаа нуух.
7. **A7 — Supply chain + ops (M6+M7+M8+M9+L7+L1+L9):** npm ci/lockfile/govulncheck,
   bootstrap pw guard, SSH quoting, admin-task нэр, TLS renew, carrier firewall.

---

## 5. ✅ Баталгаажсан хүчтэй хамгаалалт

- **SQL injection алга** — бүх `$queryRaw`/`$executeRaw` нь Prisma tagged-template,
  `${}` бүгд bound параметр (`positions`, `reports` proximity/fetchWindow,
  `devices.transfer`, audit advisory-lock = static). Цорын ганц `Unsafe` нь
  user-input-гүй static DDL файл.
- **Command/OS injection алга** — `child_process`/`exec`/`eval`/`new Function`
  байхгүй; device command нь SUPER_ADMIN-only эсвэл 5-элемент allowlist.
- **SSRF хүчтэй** — webhook нь host resolve хийж loopback/RFC1918/link-local
  (169.254.169.254)/CGNAT/multicast (+IPv6) блоклож, **resolved IP-г connect
  дээр pin** хийж DNS-rebinding TOCTOU хаана, 3xx redirect дагахгүй. Geocoding
  base URL нь operator-config.
- **XSS алга** — `dangerouslySetInnerHTML`/`innerHTML`/`document.write` байхгүй;
  бүх server дата React text-ээр escape; email plaintext.
- **JWT/session** — HS256 sign+verify хоёуланд pin, `assertStrongJwtSecret`
  boot-fail-fast; refresh rotation + reuse-detection (atomic, family-revoke,
  SHA-256 hash хадгалалт); password солиход бүх refresh revoke; account lockout
  (atomic, time-based, permanent биш).
- **RBAC/mass-assignment** — hierarchical guard, role-ladder escalation хаалттай,
  global `ValidationPipe(whitelist+forbidNonWhitelisted)`, Prisma `$use` tenant-
  guard (P1).
- **Go ingestor** — AVL parser bounds-checked (short-dataLen DoS зассан, per-conn
  `recover()`, regression тест), read/write deadline, IMEI allowlist (P4),
  `INGESTOR_MAX_CONNECTIONS` албадагдсан. events-engine зөвхөн дотоод
  `fleex.positions`-ийг `recover`-тэй уншина.
- **nginx edge** — `client_max_body_size 25m`, slowloris timeout, `limit_req`
  (api 20r/s, login 5r/m) + `limit_conn 50`, `server_tokens off`, HSTS/CSP/
  X-Frame-Options, `X-Forwarded-For` overwrite (IP spoof хаана).
- **CI/secrets** — `pull_request_target` байхгүй (fork PR нь зөвхөн ci.yml,
  secret-гүй); SSH host-key pinning (`StrictHostKeyChecking=yes`, accept-new
  байхгүй); command allowlist; committed secret алга; Postgres/Redis host-д
  ил биш, Redis password шаардана; UFW default-deny + fail2ban.

---

> **Тэмдэглэл:** Энэ аудитад **код өөрчлөөгүй** — энэ нь халдлагаас сэргийлэх
> арга хэмжээг *тодорхойлсон* баримт. Эзэмшигч аль зүйлийг эхэлж хэрэгжүүлэхээ
> сонгож, өмнөх P1–P5-ийн адил тест/CI-тай хийнэ. Хамгийн яаралтай: **A1 (media
> DoS) ба A2 (контейнер хатуужил)**.
