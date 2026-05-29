# Fleex — дараагийн үе шат + хариултууд (2026-06)

`docs/AUDIT-2026-05.md`-аас үлдсэн, олон долоо хоног / тоног төхөөрөмж / асуулт
шаардсан зүйлс. Хэрэгжүүлэх дараалал + хариулт.

---

## A-16 — Telegram-аас өөр дохиоллын суваг

**Чухал нэг зүйл:** одоо байгаа **WEBHOOK суваг нь Slack, Microsoft Teams,
Discord, n8n, Zapier, Make-г шинэ код бичихгүйгээр аль хэдийн дэмждэг** —
тэдгээрийн "incoming webhook URL"-ийг NotificationRule-д буулгахад л болно.

Шинэ суваг нэмэх сонголтууд (эрэмбээр):

| Суваг | Тайлбар | Хүч |
|---|---|---|
| **Viber** (санал болгож буй) | МН-д хамгийн өргөн (Telegram-аас илүү). Bot/Business API, token + ID | ~2-3 өдөр |
| **Web Push / FCM** | Browser + гар утсанд push, гуравдагч апп шаардахгүй | ~1 дх |
| **Telegram** | Bot API `sendMessage`, chat_id | ~1-2 өдөр |
| **Voice call** (PANIC) | HSE escalation; Twilio/дотоод провайдер | ~2-3 өдөр |

Архитектур: `notification-dispatcher`-т суваг бүр нэг адаптер
(`EmailService`/`SmsService`/`WebhookService` загвар). `NotificationChannel`
enum + rule UI-д сонголт нэмнэ. **Зөвлөмж: эхлээд Viber.** Slack/Teams ОДОО
webhook-оор ажиллана.

---

## B-2 — Token / session аюулгүй байдлыг хэрхэн турших

**Одоогийн hardening-ийг шалгах (https://www.fleex.mn дээр):**
1. **Access TTL (15м):** login → JWT-ийн `exp` шалга. 15 мин дараа хүсэлт 401 →
   автомат refresh (`lib/api.ts`).
2. **Refresh rotation + reuse:** нэг refresh token-оор 2 удаа
   `POST /api/auth/refresh` → 2 дахь нь **татгалзаж**, бүх session revoke.
3. **Logout:** дараа нь тэр refresh token ажиллахгүй.
4. **Нууц үг солих/reset:** дараа нь хуучин бүх refresh token хүчингүй.
5. **RBAC/tenant:** A компанийн token-оор B-ийн `/api/devices/:id` → 403.
6. **Command allowlist (M-1):** FLEET_MANAGER `{type:'custom',payload:{text}}`
   эсвэл бус-preset type → 403 (зөвхөн SUPER_ADMIN).

**httpOnly-cookie шилжилт (H-7, хийгдээгүй) дараа нэмж шалгах:**
7. refresh token `document.cookie`-оор уншигдахгүй (HttpOnly); DevTools →
   Application → Cookies: `Secure; HttpOnly; SameSite=Strict`.
8. CSRF token шаардагдах.
9. WS token нь URL query-д **байхгүй** (богино ticket).

> H-7 нь auth-flow өөрчилдөг тул deploy дээр алхам алхмаар. Одоо XSS-ийн гол
> митигаци болох **CSP идэвхтэй**.

---

## Vendor / тоног төхөөрөмж — Queclink (quote ирсэн)

Queclink GV350CEU бүх API түвшинд дэмжихээ илэрхийлсэн. Дараалал:

### 1. Multi-protocol суурь (`docs/MULTI-PROTOCOL-DESIGN.md`)
`protocol.Decoder` interface + per-port routing. Teltonika-г adapter болгож,
**Queclink GV350CEU** ASCII декодер (`+RESP:GTFRI` parse, IMEI мессежээс,
`+SACK` heartbeat). Шинэ port (5028). ~тест rig 1 дх; prod decoder 1-2 дх.

### 2. Periphery → дата модель
- **DR200 RFID (1-wire)** → одоо байгаа RFID/driver-card логик руу map.
- **ATP100/102/201 TPMS** → шинэ `TyrePressure` модель (deviceId, axle,
  position, pressureKpa, tempC, batteryPct, capturedAt) + threshold alert
  (`DeviceHealthRule`-д TPMS төрөл) + UI виджет. ~2-3 дх.
- **Trailer/Truck cordless repeater** → дамжуулагч, дата модель шаардахгүй.
- **WRL300 BLE relay / wired relay** → engine-block-ийг Queclink relay команд
  руу; `commands` allowlist-д `relay_on/off`. ~1 дх.
- **Receiver with Display (RS232)** → жолоочид мессеж (одоо `messages` модуль)
  Queclink дэлгэц рүү. ~1 дх.

Бодит төхөөрөмж дээр тест заавал.

### A-6 — Түлшний аналитик
Sensor calibration бий. Нэмэх: түвшингийн median filter,
**refuel/drain/theft** илрүүлэлт (огцом өсөлт/бууралт), түлш-vs-зам график,
Fuel report (одоо "Удахгүй"). ~2-3 дх.

### A-7 — Route / dispatch / ETA
Dispatcher board v1 → v2: route corridor geofence, дараагийн ачаа/буулгах,
ETA (зай/дундаж хурд), drag-drop хуваарилалт. OSRM/Valhalla self-host эсвэл
энгийн ETA. ~3-4 дх.

### A-12 — Засвар үйлчилгээний гүн
Parts/inventory, work-order урсгал, CAN-аас одометр/цаг автомат, засварын
зардлын тайлан. ~2-3 дх.

---

## Санал болгож буй дараалал
1. **Viber** (A-16) — хурдан, МН-д өндөр үнэ цэнэ.
2. **Queclink GV350CEU decoder + TPMS** (A-1/A-14) — quote ирсэн, #1 зөрүү.
3. **Түлшний аналитик** (A-6).
4. **Maintenance гүн** (A-12) → **Route/dispatch** (A-7).
5. **H-7 cookie + WS ticket** (B-2 гарын авлагаар).
6. **B-9 daily distance** — тестлэгдсэн CAGG migration-той хамт.
