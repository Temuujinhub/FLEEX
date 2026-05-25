# Fleex CamTest — isolated FMC125 + DualCam rig

A throwaway, **fully isolated** test rig for demoing a Teltonika FMC125 +
DualCam to NOMIN MOTOR — with **zero contact** with the production Fleex
stack. No shared database, Redis, containers, network or ports.

- `:5028` — FMC125 AVL telemetry (Codec 8/8E) → live position on the map
- `:5029` — DualCam camera server → captures images
- `:8090` — demo web page (map + image gallery)

Prod keeps running on its own containers and port `5027`, untouched. When the
demo is done, `down -v` removes everything including captured images.

---

## 1. Device configuration (what's set in the Configurator)

**GPRS → Server Settings (telemetry):**
| Field | Value |
|-------|-------|
| Domain | `fleex.mn` (→ 178.128.27.70) |
| Port | **5028** |
| Protocol | TCP · TLS None |
| ACK type | AVL |
| APN | `internet` (or the SIM operator's APN) |

**RS232 \ RS485 → Camera (DualCam):**
| Field | Value |
|-------|-------|
| Mode | RS232 → **DualCam** |
| Baudrate | 115200 · Parity None |
| Camera server Domain / Port | `fleex.mn` / **5029** |
| Picture resolution | 1280×720 (compression 50) |
| Scenario mode | On ignition |
| Periodic image sending | Front, interval **600 s** |
| Image triggers | DIN1/DIN2/Crash/Towing/Idling/Geofence/Unplug/Green Driving |
| Metadata version | 3 |

> **Demo tip:** 600 s = one picture every 10 min. For a live demo, lower
> *Image settings → Sending interval* to e.g. **60 s**, or trigger a shot via
> *Idling/Geofence/DIN*, then **Save to device**.

> **Note:** telemetry now points at **:5028** (this rig), so the device leaves
> the prod ingestor (:5027) during the test — that's intended. To keep it in
> prod too, use *GPRS → Second Server → Duplicate* (the camera always uses the
> primary/camera server).

---

## 2. Deploy on the droplet — SEPARATE from prod

Run it from its **own directory**, never `/opt/fleex` (so a prod `git reset`
can't touch it and vice-versa):

```bash
# as root on 178.128.27.70
mkdir -p /opt/fleex-camtest && cd /opt/fleex-camtest
git clone --depth 1 -b claude/nice-turing-cZst4 <repo-url> _src
cp -r _src/camera-test/* .

# open the test ports (prod's 5027/80/443 are already allowed)
ufw allow 5028/tcp && ufw allow 5029/tcp && ufw allow 8090/tcp

docker compose -f docker-compose.cam.yml up -d --build
docker compose -f docker-compose.cam.yml logs -f
```

Open the demo page: **http://178.128.27.70:8090**

Watch the logs for `[avl] connected`, `[avl] records=…`, and
`[cam] image saved …`.

### Tear down (nothing left behind)
```bash
docker compose -f docker-compose.cam.yml down -v
ufw delete allow 5028/tcp && ufw delete allow 5029/tcp && ufw delete allow 8090/tcp
```

---

## 3. Photos, on-demand video & retention

The rig speaks the real DualCam file-transfer protocol
(`FILE REQ → START → RESUME → SYNC → DATA → reassembled file`):

- **Photos** are pulled automatically on every camera connection
  (identifier `%photof`) and shown in the **gallery** (newest first; click to
  enlarge). On disk: `/app/data/images/<imei>_<ms>.jpg`.
- **Video on-demand:** click **📹 Видео татах** on the page; on the camera's
  next connection the rig requests `%videof` and stores it. The DualCam only
  has a video to give if one was captured by a trigger (Video sending trigger
  = DIN1/DIN2/Crash in the device config), so trigger a clip first. Video is
  saved raw (`.h264`) and offered as a **download** — in-browser playback
  (mp4 via ffmpeg) is a follow-up that needs the wiki's video-conversion bytes.
- **Retention:** only the newest `CAMTEST_MAX_FILES` media files are kept
  (default 200); older are auto-deleted so the box never fills up. Raw stream
  capture is **off** by default. Expand to object storage at fleet rollout.

### Env knobs
`CAMTEST_MAX_FILES` (default 200) · `CAMTEST_RAW` (0/1, default 0 — raw stream
dump for protocol diagnostics) · `CAMTEST_AVL_PORT` 5028 · `CAMTEST_CAM_PORT`
5029 · `CAMTEST_HTTP_PORT` 8090.

---

## 4. After NOMIN signs — integration into prod

This rig is deliberately throwaway. To productionise:
- Move the camera protocol into the main ingestor (or a dedicated
  `media-service`), reusing the proven `teltonika` codec already shared here.
- Add a `DeviceImage` model + object storage (DO Spaces / MinIO — **not**
  Postgres bytea at fleet scale) + tenant-scoped API + gallery in the React
  app + a retention policy.
