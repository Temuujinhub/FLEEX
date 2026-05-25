# Queclink (GV350CEU + DR102) холболтын төлөвлөгөө

Энэ баримт нь Fleex (fleex.mn) системд **Queclink** брэндийн төхөөрөмж нэмэх
боломж, шаардагдах **нэмэлт зардал ба бэлтгэл ажил**, хэрэгжүүлэх **фазаар
ангилсан төлөвлөгөө**-г тодорхойлно. Аудит нь одоогийн кодын бүхэл бүтэн
шалгалт дээр үндэслэв.

> Хамрах хүрээ: Queclink **GV350CEU** (4G LTE GPS tracker) + **DR102** RFID
> reader-ийг үйлдвэрлэлийн системд холбох. Teltonika-гийн одоо ажиллаж буй
> урсгалд (1000+ төхөөрөмж, :5027) **регресс эрсдэлгүй** нэгтгэх.

---

## 0. Гүйцэтгэх хураангуй

- Fleex-ийн дата урсгал **протоколоос үл хамаарах** загвартай: parser →
  TimescaleDB `positions` → Redis `fleex.positions` → events-engine + API WS.
- **Гол давуу тал:** өгөгдлийн модель аль хэдийн multi-protocol-д бэлтгэгдсэн
  (`Device.protocol`, `Position.attributes`/`rfid`, `Sensor.sourceParam`,
  free-form `Command.type`). Хамгийн их хугацаа авдаг schema/RBAC/tenant ажил
  **хийгдсэн**.
- Teltonika-гийн хатуу холбоос зөвхөн **ingest давхаргад** (binary codec,
  IMEI handshake, Codec 12 команд, IO ID-ууд) төвлөрсөн.
- Queclink **@Track** протокол нь Teltonika-аас үндсэндээ ялгаатай (ASCII
  текст, handshake байхгүй, `AT+GT…` команд) тул **шинэ parser + командын
  кодлогч** бичих шаардлагатай.
- **Дэд бүтцийн зардал маш бага:** 1 шинэ TCP порт + firewall дүрэм. Шинэ
  сервер хэрэггүй, байгаа droplet дээр ажиллана.
- **Инженерийн нийт ажил:** нэг хөгжүүлэгчээр ~**5-7 долоо хоног** (hardware-ийн
  хүргэлтийн хугацааг эс тооцвол).

---

## 1. Одоогийн архитектур ба Teltonika холбоос

Дата урсгал:

```
Төхөөрөмж ──TCP:5027──► gps-ingestor (Go) ──COPY──► TimescaleDB (positions)
                              │
                              └──pub──► Redis "fleex.positions" ──► events-engine + API WS
        commands ◄──Codec12── gps-ingestor ◄──BLPOP── Redis "fleex.commands:{imei}" ◄── API
```

Teltonika-тай **хатуу холбогдсон** цэгүүд (зөвхөн эдгээр):

| Давхарга | Файл:мөр | Юу хатуу бичигдсэн |
|---|---|---|
| Parser | `services/gps-ingestor/internal/teltonika/codec.go:149` | Codec 8/8E **binary**; 8/8E биш бол татгалздаг |
| Handshake | `internal/teltonika/codec.go:80` | IMEI len+bytes → `0x01` (Teltonika-specific) |
| Команд | `internal/teltonika/codec12.go`, `internal/store/commands.go:99` | Codec 12 framing + `setdigout`/`getinfo` текст |
| Телеметр pick | `internal/teltonika/io_map.go:5-30` | IO ID хатуу (ignition=239, RFID=78, voltage=66, odo=16…) |
| Store | `internal/store/store.go:286` | `Protocol: "teltonika"` хатуу бичсэн |
| Events | `services/events-engine/internal/engine/engine.go:275-284` | IO тогтмол (253/255/257/247/252/239/66) |
| Web sensor | `services/web/src/pages/devices/SensorsTab.tsx:29` | dropdown зөвхөн Teltonika IO |
| Web команд | `services/web/src/pages/devices/CommandsTab.tsx:11` | preset зөвхөн Codec 12 |
| Порт/firewall | `docker-compose.yml:147`, `infra/deploy/setup-server.sh:56` | `5027/tcp` зөвхөн Teltonika |

---

## 2. Гол давуу тал — модель аль хэдийн бэлэн

Шинэ брэнд нэмэхэд ихэвчлэн хамгийн их хугацаа авдаг хэсэг (schema migration,
multi-tenant isolation, RBAC, attributes хадгалалт) **аль хэдийн хийгдсэн**:

- `services/api/prisma/schema.prisma:401` — `protocol String? @default("teltonika")`
  багана **байна** (зөвхөн `CreateDeviceDto`-д ил гаргаагүй).
- `schema.prisma:402` — `attributes Json` протоколоос үл хамаарна.
- `positions.rfid`, `positions.attributes` — Queclink-ийн RFID/IO-г шууд
  хадгална.
- `RawMessage.protocol` багана байна (ingestor `"teltonika"` гэж бичдэг —
  Queclink дээр `"queclink"` бичихэд л хангалттай).
- `Sensor.sourceParam` — `schema.prisma:753-758` тайлбар: *"Teltonika AVL IDs,
  **Queclink parameter codes**, etc."* гэж урьдчилан тооцсон.
- `Command.type` free-form; `internal/store/commands.go:95` нь `payload.text`-ийг
  шууд дамжуулдаг, тодорхойгүй type-ийг literal болгон унагадаг.
- `web/src/pages/Devices.tsx` (≈699-709) tooltip аль хэдийн *"Дэмжигдсэн
  загварууд: Teltonika, **Queclink**, Concox, Ruptela"* гэж бичсэн.

**Дүгнэлт:** ажил ~70% нь ingest давхаргад (шинэ parser + командын кодлогч +
нормализаци), ~30% нь API/UI/events дээрх жижиг өргөтгөл.

---

## 3. Queclink @Track протоколын ялгаа

GV350CEU нь **@Track Air Interface** протокол ашигладаг — Teltonika-гийн
binary codec-ээс үндсэндээ өөр:

| Шинж | Teltonika (одоо) | Queclink GV350CEU |
|---|---|---|
| Формат | Binary (Codec 8/8E) | **ASCII текст** (`+RESP:GTFRI,…,$`) эсвэл Fixed (binary) |
| Handshake | IMEI len+bytes → `0x01` | **Байхгүй** — IMEI мессеж бүрд (≈3-р талбар) |
| ACK | "records accepted" 4 byte | `+SACK:` (зөвхөн `+BUFF`/heartbeat-д шаардлагатай) |
| Buffered | Нэг урсгал | `+BUFF:` тусдаа толгойтой |
| Команд | Codec 12 (`setdigout 1?? 1 0 0`) | **`AT+GTxxx=password,…,serial$`** ASCII (output = `AT+GTOUT`) |
| RFID | IO #78 / #195 | DR102 → тусдаа report (магадгүй `GTIDA`/`GTRFID` — **doc-оор баталгаажуулна**) |
| Transport | TCP | TCP эсвэл UDP (TCP сонгоно) |

> **Чухал:** report талбаруудын яг байрлал/нэр модель, firmware-ээр ялгаатай.
> Parser-ийг **албан ёсны "@Track Air Interface Protocol — GV350CEU" doc дээр
> үндэслэн** бичиж, **бодит төхөөрөмж дээр** баталгаажуулна. DR102-ийн RFID
> report-ийн яг нэр/талбарыг doc-оос лавлах ёстой (санах ойноос таамаглахгүй).

---

## 4. Архитектурын шийдэл

`docs/ARCHITECTURE.md` §8 өөрөө загвар зааж өгсөн:
*"Promote iridium-bridge as a separate ingest service for satellite payloads
(different framing)."* Үүнтэй адил + `camera-test/` rig-ийн "тусгаарласан →
батлах → нэгтгэх" зарчмаар:

**Зөвлөмж (Option A):**
1. Эхлээд **тусдаа `queclink-test` rig** (camera-test шиг, prod-д огт хүрэхгүй,
   тусдаа порт, тусдаа compose).
2. Дараа нь production-д **тусдаа `queclink-ingestor` сервис** — 5027-г хэвээр
   үлдээж, шинэ порт дээр сонсож, **ижил** Postgres `positions` + Redis
   `fleex.positions`/`fleex.commands`-д бичнэ.

Давуу тал: ажиллаж буй Teltonika hot path-д **регресс эрсдэлгүй**, тус тусдаа
scale/restart хийнэ, `iridium-bridge` загвартай нийцнэ.

**Option B (multi-protocol нэг ingestor дотор):** `Protocol` interface
гаргаж, олон порт/auto-detect хийх. Бага код, гэхдээ hot path-д өөрчлөлт ороод
эрсдэл арай өндөр.

> 3 дахь брэнд гарвал хоёр ingestor-ыг `Protocol` interface + хуваалцсан
> `store` болгон refactor хийнэ — **одоо биш**, шаардлага гарахад.

**Порт:** prod Teltonika = `5027`. camera-test (түр зуурын) = `5028/5029/8090`.
Queclink production-д **`5028`** (camera rig буулгасны дараа) эсвэл мөргөлдөөнөөс
сэргийлж **`5030`**-г санал болгоно.

---

## 5. Хэрэгжүүлэх төлөвлөгөө (фазаар)

| Фаз | Ажил | Хэмжээ |
|---|---|---|
| **0. Бэлтгэл** | Hardware худалдан авах (1-2× GV350CEU + DR102 + SIM), @Track + DR102 protocol doc авах | Худалдан авалтын lead time |
| **1. Тест rig** | `queclink-test/` (camera-test загвараар): шинэ порт дээр @Track ASCII parser, газрын зураг дээр live position, RFID swipe лог. Prod-д хүрэхгүй | дунд (~1 долоо хоног) |
| **2. Production ingest** | `queclink-ingestor` сервис: parser + телеметр нормализаци + `AT+GT…` командын кодлогч + SACK/heartbeat. `positions`/Redis-д Teltonika-тай ижил бичнэ | том (~2-3 долоо хоног) |
| **3. API + UI** | `CreateDeviceDto`-д `protocol`; web дээр брэнд/протокол сонголт; `SensorsTab` Queclink param preset; `CommandsTab` Queclink команд | бага-дунд (~3-5 өдөр) |
| **4. Events-engine** | IO тогтмолуудыг протоколоос үл хамааруулах (эсвэл Queclink mapping нэмэх) | бага (~2-3 өдөр) |
| **5. Тест + pilot** | Бодит GV350CEU+DR102+SIM bench тест, талбарын pilot, docs шинэчлэх | дунд (~1 долоо хоног) |

**Нийт:** нэг хөгжүүлэгчээр ~5-7 долоо хоног (hardware lead time-аас гадна).

### Фаз 1 — Тест rig (дэлгэрэнгүй)
- `camera-test/`-ийн бүтцийг хуулбарлана: in-memory store, embed хийсэн web
  хуудас (газрын зураг + RFID swipe лог), өөрийн `docker-compose`, өөрийн порт.
- `queclink/` дотоод пакет: `+RESP`/`+BUFF`/`+ACK` мөрийг таних, `GTFRI` болон
  үндсэн report-уудыг талбараар нь задлах, IMEI + GPS + speed + IO гаргах.
- `+SACK` heartbeat хариу (шаардлагатай бол).
- Зорилго: **бодит хувьд** өгөгдлийг шалгах, prod-д ямар ч эрсдэлгүй.

### Фаз 2 — Production ingest (дэлгэрэнгүй)
- `services/queclink-ingestor/` шинэ Go сервис (gps-ingestor-ийн `store`,
  `config` загвараар).
- **Нормализаци:** Queclink-ийн талбар/param-ийг Teltonika `PickIgnition`,
  `PickOdometerKm`, `PickRFID` гэх мэт **стандарт талбар** руу буулгана. Ингэснээр
  `positions` + `fleex.positions` envelope нь ижил хэлбэртэй болж events-engine,
  API, web **өөрчлөлтгүйгээр** ажиллана.
- **Команд:** `CommandToText`-ийн адил Queclink командын кодлогч (`AT+GTOUT`
  output control = engine block, `AT+GTRTO` request, гэх мэт). Энэ нь Codec 12
  биш тул тусдаа framing.
- **RawMessage.protocol = "queclink"**, attributes-д `ql_*` (эсвэл нэгдсэн `io_*`)
  түлхүүрээр param хадгална.

### Фаз 3 — API + UI (дэлгэрэнгүй)
- `services/api/src/devices/devices.controller.ts` → `CreateDeviceDto`-д
  `@IsOptional() @IsIn(['teltonika','queclink']) protocol?: string` нэмэх.
- `web/src/pages/Devices.tsx` → free-text "Модель"-ийн хажууд протоколын dropdown.
- `web/src/pages/devices/SensorsTab.tsx` → device.protocol-аас хамаарч Queclink
  param preset харуулах.
- `web/src/pages/devices/CommandsTab.tsx` → Queclink командын preset.

### Фаз 4 — Events-engine (дэлгэрэнгүй)
- `engine.go:275-284` IO тогтмолуудыг нормализаци хийсэн талбар дээр суурилуулах
  эсвэл Queclink param-ийн mapping нэмэх (нормализаци хийсэн бол өөрчлөлт бараг
  үгүй).

### Фаз 5 — Тест + pilot
- Bench: GV350CEU + DR102 + SIM-ээр live position, ignition, RFID swipe, engine
  block командыг шалгах.
- Field pilot: 1-2 машинд суурилуулж 1-2 долоо хоног ажиглах.
- `README.md`, `docs/ARCHITECTURE.md`-д Queclink-ийг бичих.

---

## 6. Нэмэлт зардал ба бэлтгэл ажил

| Төрөл | Зардал/ажил | Тайлбар |
|---|---|---|
| **Hardware** | GV350CEU × тоо + DR102 RFID reader + кабель/суурилуулалт | Queclink-ийн үнийн саналыг авах. Тест-д 1-2 ширхэг хангалттай |
| **Холболт (SIM)** | M2M/IoT SIM + дата багц + APN тохиргоо | Teltonika-тай ижил — нэмэлт онцлог зардал багатай |
| **Protocol doc** | @Track Air Interface (GV350CEU) + DR102 integration doc | Үнэгүй, гэхдээ **заавал**. Datasheet тэд илгээсэн ✅ |
| **Инженер** | §5-ын фазууд (~5-7 долоо хоног) | Үндсэн зардал энд |
| **Дэд бүтэц** | 1 шинэ TCP порт + `ufw allow` + compose port | **Маш бага** — байгаа droplet, шинэ сервер хэрэггүй. Төхөөрөмж олшрох үед RAM-аа л харна |
| **Тест/лаб** | Bench + field pilot цаг | — |

---

## 7. Datasheet-аас заавал шалгах зүйлс

- **LTE band-ууд** — Монголын Unitel / Mobicom / Gmobile-ийн band-тай тохирох эсэх.
- **Протокол горим** — ASCII (зөвлөж буй) vs Fixed Report Format.
- **RS232/RS485** — DR102 RFID reader-ийг холбох интерфейс.
- **Digital output** — хөдөлгүүр блоклох релений гаралт байгаа эсэх.
- **Ажлын температур** — уурхайн нөхцөлд −40 °C хүртэл.
- **IP хамгаалалт** — тоос/чийгний зэрэглэл.
- **Тэжээл** — машины 12/24 V-тай тохирох эсэх.

---

## 8. Хиймэл дагуул / NTN / Iridium (ярилцах асуудал)

Queclink-ийн имэйлд *"Satellite-based GPS — NTN satellite communication гэж
байна уу?"* гэж асуусан. GV350CEU бол **4G LTE** төхөөрөмж (хиймэл дагуул биш).
Сонголтууд:

| Сонголт | Тайлбар | Өртөг/боловсролт |
|---|---|---|
| **Зөвхөн cellular** | 4G GV350CEU; coverage цоорхойг хүлээн зөвшөөрнө | Хамгийн хямд, одоо бэлэн |
| **NTN (3GPP сансрын IoT)** | Шинэ стандарт (Release 17). Шууд-сансрын IoT | Хязгаарлагдмал хүртээмж, тусдаа загвар/үнэ, шинэ |
| **Iridium** | Боловсорсон, дэлхий даяар. SBD богино мессеж | Өндөр өртөг (per-byte). ARCHITECTURE.md-д "iridium-bridge" гэж дурдсан |

Уурхайн (OT-төрлийн) сүлжээгүй бүсэд **fallback** хэрэгтэй бол NTN/Iridium
яригдана. Эхний фазад **cellular-only**-оор эхлээд, сансрын backhaul-ийг тусдаа
workstream болгох нь оновчтой (architecture нь "iridium-bridge"-ийг тусдаа ingest
сервис болгохыг аль хэдийн төлөвлөсөн).

> **Шийдвэр шаардсан:** OT/хэрэглэгчийн талбарт жинхэнэ сүлжээгүй бүс байгаа эсэх,
> хэрэв байвал NTN vs Iridium-ийн алийг сонгох. Энэ нь Queclink-д буцаах хариуг
> тодорхойлно.

---

## 9. Эрсдэл ба бууруулах арга

| Эрсдэл | Бууруулах арга |
|---|---|
| Teltonika prod урсгалд регресс | Тусдаа сервис/порт (Option A) — hot path хөндөхгүй |
| Protocol doc-гүйгээр буруу parse | Фаз 1 rig-ийг бодит hardware дээр баталгаажуулж байж production |
| DR102 RFID report тодорхойгүй | Doc + bench дээр swipe тест хийж талбарыг батлах |
| LTE band тохирохгүй | Datasheet шалгалт (§7) худалдан авахаас өмнө |
| Команд буруу framing | Фаз 2-т `AT+GT…` кодлогчийг bench дээр баталгаажуулах |

---

## 10. Нээлттэй асуултууд (шийдвэр шаардсан)

1. **Сансрын холболт** — §8-ын дагуу cellular-only / NTN / Iridium алийг сонгох?
2. **Архитектур** — Option A (тусдаа `queclink-ingestor`, зөвлөж буй) эсэх?
3. **Худалдан авах тоо** — тест-д хэдэн GV350CEU + DR102?
4. **Production порт** — `5028` (camera rig буулгасны дараа) эсвэл `5030`?
