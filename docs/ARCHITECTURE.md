# Fleex Architecture

This document is the deep-dive companion to the README. It explains why each
piece exists, how data flows through the system, and the operational
trade-offs we made.

## 1. Goals & non-goals

Goals — driven by the OT LLC technical spec:

- **Real-time tracking** of 1000+ Teltonika devices (Codec 8 / 8E) over GSM
  and hybrid Iridium links.
- **12 months** of GPS history retained, queryable for reports without
  blowing up the cluster.
- **Enterprise-grade reliability**: no silent data loss, graceful degradation
  under load, automatic rollback on broken deploys.
- **Multi-tenant SaaS**: companies are isolated end-to-end, with
  hierarchical RBAC and full audit trail.
- **Government-grade audit log**: tamper-evident, queryable, exportable.

Non-goals (for now):

- Multi-region active/active. We run a single, well-tuned host. The compose
  stack maps cleanly onto Kubernetes when that day arrives.
- Real-time video / camera streaming.
- Mobile native apps. The SPA is responsive; native apps are a separate
  workstream.

## 2. Components

### 2.1 GPS ingestor (Go)

- Speaks raw TCP on `:5027`, handshakes Teltonika IMEI, parses Codec 8 and
  Codec 8 Extended frames including the variable-length IO section.
- One goroutine per device connection; bounded `4096`-slot ingest channel.
- Single batcher goroutine drains the channel into `pgx CopyFrom` in chunks
  of 500 rows or 1s, whichever comes first. Throughput target: 50k+ rows/s.
- Live envelopes are published to Redis Pub/Sub on `fleex.positions`. The
  API gateway and the events engine both subscribe — the gateway forwards
  to WebSocket clients, the engine evaluates geofence and speed rules.
- Health on `:9090/healthz` + Prometheus-shape metrics on `/metrics`.

Why Go: lowest memory per concurrent TCP connection, simplest deployment,
and `pgx` is the fastest PostgreSQL driver in any ecosystem.

### 2.1a Events engine (Go)

A second small Go service, modelled on the ingestor:

- Subscribes to Redis Pub/Sub `fleex.positions` (the channel the ingestor
  publishes to). Reads the active geofence + device cache from Postgres on a
  30-second timer so admin changes propagate without a restart.
- For every position envelope:
  - Computes the set of geofences the device is inside *now* using
    `haversine` for circles and ray-casting point-in-polygon for shapes.
  - Diffs against the device's previous "inside" set (stored in Redis) to
    emit `GEOFENCE_ENTER` / `GEOFENCE_EXIT` rows.
  - Emits `OVERSPEED` rows when the position exceeds either the geofence's
    speed limit (while inside) or the device's own `speedLimit` override.
  - All OVERSPEED emissions are rate-limited via `SETNX` keys with a 60s
    cooldown per (device, scope) so a truck stuck at 80 km/h does not
    flood the events table.
- Each new row is inserted into the `events` table and republished on
  `fleex.events`. The API's WebSocket gateway subscribes to that channel
  and pushes alerts to the operator dashboards live.
- Stateless beyond the Redis-backed transition state, so it can be killed
  and restarted with no loss beyond a single GPS sample of accuracy.

Why a separate service: the ingestor's hot path is COPY-FROM throughput;
mixing event evaluation there would couple two very different SLAs. Keeping
it separate lets either service be scaled, restarted, or rewritten in
isolation.

### 2.2 API (NestJS)

- REST under `/api`, WebSocket at `/ws`.
- **Prisma** for relational tables; **raw SQL** (`$queryRaw`) for the
  hypertable so Prisma doesn't try to manage TimescaleDB DDL.
- JWT access token (15 minutes), opaque refresh token (7 days, SHA-256
  hashed at rest, rotated on each refresh).
- Argon2id password hashing; 5 failed logins → 15-minute account lock.
- Two-tier rate limiting: `@nestjs/throttler` per route + Nginx `limit_req`
  zones at the edge.
- Multi-tenant isolation enforced at the service layer for every resource;
  WebSocket fanout filters payloads by `companyId`.

### 2.3 Frontend (React + Vite)

- Landing page (marketing) + protected SPA under `/app`.
- TanStack Query for server state, Zustand (persisted) for auth state.
- Google Maps with one marker per device; updated in place over WebSocket.
- Tailwind for styling, Inter for typography, Mongolian copy throughout.

### 2.4 PostgreSQL + TimescaleDB

The single most important schema decision: `positions` is a TimescaleDB
**hypertable** partitioned monthly:

```sql
SELECT create_hypertable('positions', 'time',
  chunk_time_interval => INTERVAL '1 month');
ALTER TABLE positions SET (timescaledb.compress, ...);
SELECT add_compression_policy('positions', INTERVAL '7 days');
SELECT add_retention_policy('positions', INTERVAL '395 days');
```

- ~10× storage compression on chunks older than 7 days.
- Partition pruning makes 12-month-window reports fast (single chunk per
  month touched).
- `positions_daily` continuous aggregate keeps per-day summaries warm for
  dashboards and the trip-report endpoint.

### 2.5 Redis

- Device lookup cache for the ingestor (`ingestor:dev:<imei>`, 5 min TTL),
  including a short negative cache to absorb floods from misconfigured SIMs.
- Online presence (`ingestor:online:<imei>`, 90s TTL).
- Pub/Sub channel `fleex.positions` for live fanout.
- Command queue `fleex.commands:<imei>` (Redis list popped by the ingestor's
  command worker — TODO when device-side commands ship).

### 2.6 Nginx

- TLS termination (TLS 1.2/1.3, modern ciphers, HSTS preload).
- WebSocket upgrade with 1h read/send timeouts.
- Per-route rate limits: `/api/auth/login` is locked to ~5 req/min/IP.
- Strong CSP, X-Frame-Options, Referrer-Policy.
- ACME http-01 challenge directory mounted from the host.

## 3. Data flow

1. **Device** opens TCP to `:5027`. Sends `len(2)+IMEI`.
2. **Ingestor** validates IMEI (numeric, length sanity), sends `0x01`.
3. Device sends AVL packet (preamble + dataLen + codec + N records + N + CRC).
4. Ingestor parses, looks up `device_id` & `company_id` (Redis cache, then
   Postgres), enqueues records on the batcher channel.
5. Batcher accumulates up to 500 rows / 1s and `COPY`-s them into
   `positions`. The same flush updates the `devices.last_*` snapshot columns
   in a single `pgx.Batch`. Then publishes one envelope per record to Redis
   `fleex.positions`.
6. **API**'s `LiveGateway` subscribes to that channel, filters by
   tenant/device-subscription, and forwards JSON over WebSocket.
7. **Browser** receives the envelope, moves the matching marker on the map.

## 4. Multi-tenancy & RBAC

- `companyId` is a first-class column on `users`, `devices`, `groups`,
  `geofences`, `events`, `commands`, `audit_logs`.
- All non-super-admin queries are scoped by `companyId = req.user.companyId`.
- The roles guard enforces a strict ladder; you can only manage users at or
  below your own rank.
- Cross-tenant violations always raise `403 Forbidden` and an `outcome:
  "denied"` audit entry — never a 404 that would leak existence.

| Role            | Can do                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| SUPER_ADMIN     | Everything across all tenants, manage companies, verify audit chain.     |
| COMPANY_ADMIN   | Manage users/devices/geofences/audit in their company.                   |
| FLEET_MANAGER   | CRUD devices, groups, geofences, issue device commands.                  |
| DISPATCHER      | Read everything, acknowledge events.                                     |
| DRIVER          | Read their own assignment(s) only (route-level filter).                  |
| VIEWER          | Read-only dashboard.                                                     |

## 5. Audit log

Every controller method annotated with `@Audit('action')` records:

- `actorId`, `actorEmail`, `companyId`, `ipAddress`, `userAgent`
- `action`, `resourceType`, `resourceId`
- `before` / `after` snapshots (sensitive fields redacted automatically)
- `outcome`: `success` | `failure` | `denied`
- `prevHash`, `hash`: SHA-256 hash chain

`hash = sha256(prevHash || canonical(payload))`. Genesis is 64 zeros. If
anyone edits or deletes a row, the chain breaks at that point;
`/api/audit/verify` will report the broken id. Operators are expected to
schedule a daily verification job (and to back the table up to immutable
storage).

## 6. Failure modes & mitigations

| Failure                          | Mitigation                                                                |
| -------------------------------- | ------------------------------------------------------------------------- |
| Postgres briefly unavailable     | Ingestor queue absorbs ≤4096 batches; devices reconnect with their buffer |
| Redis down                       | API still serves REST; live updates pause, no data loss                   |
| Unknown IMEI flood               | Negative cache (30s) so we don't hammer Postgres                          |
| Bad device firmware sends garbage| Per-record `isPlausible` check + counter; bad records dropped, not raised |
| Deploy crashes                   | Healthcheck gate + auto-rollback in `infra/deploy/deploy.sh`             |
| Disk fills with positions        | 13-month retention + 7-day compression cap blast radius                   |
| Auth replay after password reset | Reset endpoint revokes every active refresh token                         |
| Credential stuffing              | Argon2id + 5-fail lock + nginx & throttler rate limits on `/auth/login`   |
| Audit tampering                  | Hash chain + verifier endpoint + recommended offsite backup of the table  |

## 7. Capacity numbers (1000 devices @ 10s)

- 100 records/s on ingest → 6k INSERTS/min by COPY → trivial for Postgres on
  the recommended 8-core / 32 GB host.
- Uncompressed chunk size ≈ 800 MB / month → compressed ≈ 80 MB / month →
  12 months ≈ 1 GB. (The OT spec budgets 300–500 GB for safety margin and
  WAL/backups.)
- WebSocket: 100 events/s ÷ N tenants. With keep-alive and 1 KB envelopes,
  any modern browser handles this easily.

## 8. Where to go next

- Move command dispatch from a Redis list to a per-device durable stream
  (Redis Streams or NATS JetStream) when device control becomes routine.
- Add Prometheus + Grafana sidecars; the ingestor already exposes counters
  and the API has structured logs ready for Loki/Tempo.
- Add MFA (TOTP) on the user model — the schema already has the columns.
- Promote `iridium-bridge` as a separate ingest service for satellite
  payloads (different framing).
