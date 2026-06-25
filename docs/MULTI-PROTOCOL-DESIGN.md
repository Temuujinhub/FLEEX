# Fleex — Multi-protocol ingest дизайн (гүн нэвтрэх)

> **Зорилго:** ingestor-ийг зөвхөн Teltonika Codec 8/8E-ээс гарган, олон
> үйлдвэрлэгчийн (Queclink, Concox/Jimi, Ruptela, Suntech …) төхөөрөмж дэмждэг
> болгох. Энэ нь Fleex-ийн **#1 стратегийн зөрүү**: Wialon/Traccar нь 200+
> протокол дэмждэг бол Fleex одоо нэг л үйлдвэрлэгчид түгжигдсэн.

Энэ баримт нь одоо байгаа Go ingestor-ийн архитектурт **хамгийн бага
өөрчлөлтөөр** decoder abstraction нэмэх замыг тодорхойлж, эхний нэмэлт
протокол болгон Queclink GV350CEU-г (`docs/QUECLINK-INTEGRATION-PLAN.md`-тэй
уялдуулан) авч үзнэ.

---

## ✅ Хэрэгжүүлэлтийн төлөв (R3)

§6-ын migration алхмууд **хэрэгжсэн** (per-port abstraction, Queclink decoder):

| Алхам | Файл | Төлөв |
|---|---|---|
| `internal/protocol` (Decoder/Record/Command/registry) | `services/gps-ingestor/internal/protocol/protocol.go` | ✅ |
| Teltonika adapter (Session-ийг дахин ашиглав) | `internal/teltonika/adapter.go` + `adapter_test.go` | ✅ |
| `store` batch → `protocol.Record` (vendor-neutral) | `internal/store/store.go`, `commands.go` | ✅ |
| Per-port routing + `INGESTOR_PROTOCOL_PORTS` | `cmd/ingestor/main.go`, `internal/config` (+test) | ✅ |
| Queclink @Track decoder + тест | `internal/queclink/queclink.go` + `_test.go` | ✅ |
| docker-compose + UFW (:5028) | `docker-compose.yml`, `infra/deploy/setup-server.sh` | ✅ |
| Device `protocol` талбар (API + UI) | `devices.controller.ts`, `web/.../Devices.tsx` | ✅ |

**P4 IMEI allowlist хадгалагдсан:** `Decoder.Handshake(ctx, accept)` callback нь
протокол бүрд бүртгэлгүй төхөөрөмжийг татгалздаг (Teltonika 0x00, Queclink
холболт таслах). Teltonika hot path регрессгүй — adapter нь хуучин codec parser-
ийг дуудаж, шинэ end-to-end тест баталсан.

> **Үлдсэн (bench, phase 5):** Queclink-ийн талбарын яг байрлал, DR102 RFID
> report layout, `AT+GT…` командын password/serial-ийг **бодит GV350CEU дээр**
> баталгаажуулна (decoder нь stable invariant дээр anchor хийдэг тул firmware-
> ийн талбар нэмэгдэлд тэсвэртэй, гэхдээ hardware баталгаа хэвээр шаардлагатай).

---

## 1. Одоогийн төлөв ба холболтын цэг

Холболт боловсруулалт `services/gps-ingestor/cmd/ingestor/main.go`
(`server.handle`) дотор Teltonika-д **хатуу холбогдсон**:

```
handle() → teltonika.NewSession → Handshake() → for { ReadAVL() → store.Enqueue() → AckRecords() } + runCommandLoop(Codec12)
```

Гэхдээ **доод урсгал нь аль хэдийн протокол-агностик**:
- `store.Enqueue(imei, []teltonika.Record, frameLen)` → batcher → `positions`.
- `store.Row` ба live envelope нь зөвхөн lat/lng/speed/ignition/IO зэрэг
  ерөнхий талбартай.

Тиймээс өөрчлөлт нь голчлон **(a) `teltonika` package-ийг `protocol`
interface-ийн ард нуух**, **(b) `handle()`-ийг decoder-аар ажиллуулах** хоёрт
төвлөрнө. Batcher/store бараг хөндөгдөхгүй.

---

## 2. Санал болгож буй abstraction

Шинэ `internal/protocol` package:

```go
package protocol

// Record — бүх протоколд нийтлэг нэг AVL цэг (teltonika.Record-ийн
// нейтрал хувилбар). store.Row үүнээс үүснэ.
type Record struct {
    Timestamp  time.Time
    Lat, Lng   float64
    SpeedKmh   float64
    Course     float64
    Altitude   float64
    Satellites int
    Ignition   *bool
    IO         map[uint16]int64
    IOStrings  map[uint16]string
}

// Command — нейтрал команд (engine block, output toggle, request photo …).
// Decoder бүр өөрийн wire-формат руу хөрвүүлнэ.
type Command struct {
    Type    string            // "engine_block", "output", "getinfo", ...
    Params  map[string]string
    RawText string            // зөвхөн SUPER_ADMIN-ийн escape hatch (allowlist-тэй)
}

var ErrUnsupported = errors.New("command not supported by protocol")

// Decoder нэг холболтын амьдралын мөчлөгийг эзэмдэнэ.
type Decoder interface {
    Name() string                                  // "teltonika", "queclink"
    // Handshake нь login/танилт уншиж IMEI буцаана. ACK шаардвал энд илгээнэ.
    Handshake(ctx context.Context) (imei string, err error)
    // ReadBatch дараагийн мессежийг уншина. ok=false бол энэ мессеж ACK
    // шаардахгүй (heartbeat гэх мэт хариуг decoder дотроо илгээсэн).
    ReadBatch(ctx context.Context) (recs []Record, frameLen int, ackable bool, err error)
    // Ack нь хүлээн авсан N бичлэгийн протокол-тусгай хариуг илгээнэ.
    Ack(n int) error
    // EncodeAndSend нь команд бичих (эсвэл ErrUnsupported).
    EncodeAndSend(cmd Command) error
}

// Factory нь шинэ холболтод decoder үүсгэнэ.
type Factory func(conn net.Conn, rTO, wTO time.Duration) Decoder
```

Registry (per-port → factory):

```go
var registry = map[string]Factory{}     // name → factory
func Register(name string, f Factory)    // init() дотор decoder бүр өөрийгөө бүртгэнэ
func ByName(name string) (Factory, bool)
```

`teltonika` package нь одоо байгаа `Session`-оо `Decoder`-ийн адаптероор
ороож, `protocol.Register("teltonika", …)` хийнэ — **одоо байгаа кодыг
дахин ашиглана, дахин бичихгүй**.

---

## 3. Протокол сонголт: per-port (зөвлөмж)

Хоёр сонголт:

| Арга | Давуу | Сул |
|---|---|---|
| **Per-port** (зөвлөмж) | Энгийн, найдвартай; төхөөрөмжийг ямар ч байсан port руу тохируулдаг | Шинэ протоколд шинэ port + firewall дүрэм |
| Sniffing (эхний байт) | Нэг port | Эмзэг (Teltonika=00 00 00 00 preamble, Queclink=ASCII `+`); алдаа гарвал нийлмэл |

**Зөвлөмж: per-port.** `config`-д map нэмнэ:

```
INGESTOR_PROTOCOL_PORTS=teltonika:5027,queclink:5028
```

`runTCP` нь port бүрд listener нээж, тухайн port-ийн factory-г `handle`-д дамжуулна.
UFW-д шинэ port нэмнэ (`setup-server.sh`). `docker-compose.yml`-д port mapping.

---

## 4. `handle()` протокол-агностик болох нь

```go
func (s *server) handle(parent context.Context, conn net.Conn, factory protocol.Factory) {
    defer s.activeConns.Add(-1)
    defer conn.Close()
    defer recover()                          // (аль хэдийн нэмсэн)

    dec := factory(conn, s.cfg.ReadTimeout, s.cfg.WriteTimeout)
    imei, err := dec.Handshake(ctx)
    if err != nil { return }

    // (ирээдүйд) бүртгэлгүй IMEI-г энд татгалзана — H-3 IMEI-spoof митигаци.
    go s.runCommandLoop(ctx, imei, dec)      // dec.EncodeAndSend ашиглана

    for {
        recs, frameLen, ackable, err := dec.ReadBatch(ctx)
        if err != nil { return }
        if len(recs) == 0 { continue }
        if err := s.store.Enqueue(ctx, imei, recs, frameLen); err != nil { return }
        if ackable { dec.Ack(len(recs)) }
    }
}
```

`store.Enqueue` нь `[]teltonika.Record` биш `[]protocol.Record` авдаг болно
(жижиг refactor: `deviceBatch.records`-ийн төрлийг солих + `consume`-д
`teltonika.Pick*` оронд `protocol.Record`-ийн талбарыг шууд унших). Teltonika
adapter нь `teltonika.Record`-оо `protocol.Record` руу map хийнэ.

---

## 5. Queclink GV350CEU-ийн онцлог (эхний нэмэлт протокол)

Queclink GV нь **ASCII GPRS** протоколтой (`docs/QUECLINK-INTEGRATION-PLAN.md`):

- Мессеж: `+RESP:GTFRI,...,$` (тогтмол байрлал), `+BUFF:...` (буфержсэн).
- **IMEI** нь мессежийн талбараас (Unique ID) гарна — тусдаа handshake байхгүй,
  эхний мессежээс уншина.
- **Heartbeat** `+ACK:GTHBD,…` → `+SACK,…$` хариу шаардана (`ackable` логик энд).
- Команд: ASCII `AT+GTxxx=…` (Codec 12 биш) — `EncodeAndSend` нь Queclink AT
  командыг бүтээнэ; дэмжихгүй командад `ErrUnsupported`.
- Position талбарууд (lat/lng/speed/course/altitude/satellites/HDOP/ignition)
  бүгд `protocol.Record` руу map хийгдэнэ; Queclink-ийн нэмэлт талбарууд (тоолуур,
  гадаад хүчдэл) `IO` map-д тогтсон түлхүүрээр орно.

Queclink decoder нь `bufio.Scanner`-аар `$`-ээр тусгаарлан уншиж, талбар бүрийг
parse хийнэ. Teltonika-гийн бинар bounds-checking-ийн оронд ASCII parse — гэхдээ
**ижил хамгаалалт**: талбарын тоо/урт шалгах, panic-аас recover (аль хэдийн бий).

---

## 6. Migration алхмууд

1. `internal/protocol` package (interface + registry + neutral Record/Command).
2. `teltonika`-г adapter-аар ороож `Register("teltonika", …)`; `store`-ийн
   batch төрлийг `protocol.Record` болгох (поведени өөрчлөгдөхгүй).
3. `config`-д `PROTOCOL_PORTS`; `runTCP`-г олон-listener болгох.
4. **Regression:** одоо байгаа Teltonika урсгал өөрчлөгдөөгүйг батлах
   (codec_test + нэг end-to-end pipe тест).
5. `queclink` decoder + unit test (бодит `+RESP:GTFRI` мессежийн дээж дээр).
6. `docker-compose` + `setup-server.sh` UFW-д шинэ port.
7. Device модель/UI-д `protocol` талбар (одоо Teltonika гэж тооцдог) — заавал биш.

## 7. Эрсдэл ба сааруулалт

- **Teltonika регресс:** adapter + per-port тусгаарлалт нь хуучин урсгалыг
  хөндөхгүй; тест нэмж батална.
- **Команд path зөрүү:** `EncodeAndSend`/`ErrUnsupported`-аар протокол бүр
  өөрийн чадварыг илэрхийлнэ; UI дэмжихгүй командыг далдална.
- **Цар хүрээ:** эхлээд Queclink л нэмж, дараа нь protocol бүрийг ижил
  interface-ээр оруулна (Traccar-ийн загвартай төстэй).

> **Үр дүн:** нэг decoder interface + per-port routing нэмснээр Fleex нь
> vendor lock-in-ээс гарч, шинэ протокол бүрийг ~1 файл (decoder + тест)-ээр
> нэмдэг болно. Энэ нь зах зээлийн хүрээг (тендер бүрт өөр төхөөрөмж) эрс
> өргөжүүлнэ.
