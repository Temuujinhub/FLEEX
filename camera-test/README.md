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

## 3. Viewing test images

- Images arrive **on their own** per the device config (periodic Front every
  600 s, or on a trigger). No server request needed.
- They appear in the **gallery** on the page (newest first); click to enlarge.
- On disk inside the container: `/app/data/images/<imei>_<ms>.jpg`
  (`docker compose -f docker-compose.cam.yml exec camtest ls /app/data/images`).

### How image capture works here
The rig ACKs the camera handshake, dumps the **raw stream** to
`/app/data/raw/<imei>_<ms>.bin`, and recovers any complete **JPEG**
(`FF D8 FF … FF D9`) from the stream. That's enough to show pictures for the
demo regardless of the exact DualCam metadata framing.

If images don't appear but `[cam] connected` shows in the logs, grab a raw
capture (`/app/data/raw/*.bin`) — the DualCam metadata-v3 framing /
per-chunk ACK can then be implemented precisely from real bytes.

---

## 4. After NOMIN signs — integration into prod

This rig is deliberately throwaway. To productionise:
- Move the camera protocol into the main ingestor (or a dedicated
  `media-service`), reusing the proven `teltonika` codec already shared here.
- Add a `DeviceImage` model + object storage (DO Spaces / MinIO — **not**
  Postgres bytea at fleet scale) + tenant-scoped API + gallery in the React
  app + a retention policy.
