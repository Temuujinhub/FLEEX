# Fleex — Enterprise GPS Fleet Tracking SaaS

Mining-grade GPS fleet tracking platform built for Oyu Tolgoi-class workloads:
1000+ devices, 8.6M positions/day, 12-month time-series retention, real-time
WebSocket fanout, tamper-evident audit log, hierarchical RBAC.

## Stack

| Layer        | Tech                                                                  |
| ------------ | --------------------------------------------------------------------- |
| Ingest       | **Go 1.22** TCP server (Teltonika Codec 8 / 8E), batched `COPY FROM`  |
| API          | **NestJS** (Node 20, TypeScript) — REST + WebSocket + auth + audit    |
| Frontend     | **React 18 + Vite + Tailwind**, Google Maps, TanStack Query           |
| Database     | **PostgreSQL 15 + TimescaleDB 2.16** (hypertable, compression 7d, retention 13mo, continuous aggregate) |
| Cache / Bus  | **Redis 7** — device cache, Pub/Sub, command queue, presence          |
| Edge         | **Nginx** — TLS, rate limit, security headers, WS upgrade             |
| Orchestration| **Docker Compose** with healthchecks + `restart: unless-stopped`      |
| CI/CD        | **GitHub Actions** → SSH deploy to `178.128.27.70`                    |

## Architecture overview

```
   ┌────────────────┐    TCP 5027 (Teltonika)    ┌───────────────────┐
   │ FMC/FMM devices├──────────────────────────►│ gps-ingestor (Go) │
   └────────────────┘                            └─────────┬─────────┘
                                                           │ COPY FROM
                                                           ▼
                                            ┌──────────────────────────┐
                                            │ PostgreSQL + TimescaleDB │
                                            └──────┬──────────┬────────┘
                                                   ▲          │
                                                   │          │ pubsub
                                       Prisma ORM  │          ▼
   ┌────────────────┐    HTTPS+WS     ┌────────────┴─────┐  ┌────────┐
   │   Browser SPA  │◄───────────────►│  api (NestJS)    │◄─┤ Redis  │
   └────────────────┘                 └──────────────────┘  └────────┘
              ▲                                ▲
              │ HTTPS                          │ HTTPS reverse proxy
              └────────────── nginx ───────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the deeper read.

## Local development

```bash
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, REDIS_PASSWORD, GOOGLE_MAPS_API_KEY ...
docker compose up --build
```

Then open <http://localhost> — the bootstrap super admin is whatever you set
in `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`.

Service ports (host):

- `80` / `443` — Nginx (SPA + API + WS)
- `5027/tcp` — Teltonika devices (ingestor)

## Production deploy

### One-time server setup

On a fresh DigitalOcean Ubuntu 22.04 droplet (the project's host is
`178.128.27.70`):

```bash
ssh root@178.128.27.70
curl -fsSL https://raw.githubusercontent.com/temuujinhub/fleex/claude/saas-auto-deploy-Ap2l1/infra/deploy/setup-server.sh \
  | bash -s -- https://github.com/temuujinhub/fleex.git claude/saas-auto-deploy-Ap2l1
# Edit /opt/fleex/.env (set all secrets!)
sudo -u deploy /opt/fleex/infra/deploy/deploy.sh
# Once DNS for fleex.mn points here:
sudo /opt/fleex/infra/deploy/enable-tls.sh fleex.mn admin@fleex.mn
```

### Configure GitHub Actions

Add the following **repository secrets** so `.github/workflows/deploy.yml`
can SSH into the host:

| Secret               | Value                                         |
| -------------------- | --------------------------------------------- |
| `DEPLOY_HOST`        | `178.128.27.70`                               |
| `DEPLOY_USER`        | `deploy`                                      |
| `DEPLOY_SSH_KEY`     | private OpenSSH key (matching the deploy user)|
| `DEPLOY_SSH_PORT`    | `22` (omit if default)                        |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -H 178.128.27.70` output         |

After that, every push to `main` or `claude/saas-auto-**` triggers:

1. Lint/build sanity for ingestor (Go), API (Nest), web (Vite)
2. SSH to host, `git pull`, `docker compose build && up -d`
3. Wait for `postgres`, `redis`, `api`, `ingestor` to report `healthy`
4. Auto-rollback to the previous commit on failure

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for full operational runbook.

## Security

- **Argon2id** password hashing, refresh-token rotation, 5-strike account lock.
- **JWT** (15m) + opaque refresh token (7d, SHA-256 in DB).
- **RBAC**: SUPER_ADMIN → COMPANY_ADMIN → FLEET_MANAGER → DISPATCHER → DRIVER → VIEWER. Hierarchical — higher ranks subsume lower-rank permissions automatically.
- **Multi-tenant isolation**: every query is scoped by `companyId` for non-super-admins, including WebSocket fanout.
- **Audit log** is append-only with a SHA-256 hash chain (`hash = sha256(prevHash || canonical(payload))`). The `/api/audit/verify` endpoint walks the chain to detect tampering.
- **Rate limiting** at two layers: NestJS `@Throttler` and Nginx `limit_req_zone`. Login is harshly capped to fight credential stuffing.
- **Firewall**: UFW open only on 22, 80, 443, 5027. Fail2ban on SSH.
- **TLS**: Let's Encrypt managed by certbot, HSTS preload, modern ciphers only.
- **CSP**: locked-down content-security-policy (see `infra/nginx/conf.d/fleex-tls.conf.disabled`).

## Reliability

- All services run with `restart: unless-stopped` and Docker healthchecks.
- API + ingestor expose `/health` and `/healthz` — the deploy script blocks until both are green.
- Ingestor uses a bounded queue + batched COPY (500 rows or 1s); slow Postgres exerts backpressure on devices via TCP rather than dropping data silently.
- Positions sit in a TimescaleDB hypertable with **monthly chunks**, compression after 7 days, and retention at 395 days.
- A continuous aggregate (`positions_daily`) keeps per-day summaries warm for reports.
- Audit chain is verified via the dashboard and can be cron-checked.

## Project layout

```
.
├── docker-compose.yml          # Compose stack (postgres, redis, api, ingestor, web, nginx)
├── infra/
│   ├── nginx/                  # Reverse proxy & TLS config
│   ├── postgres/               # Initial extensions
│   └── deploy/                 # setup-server.sh, deploy.sh, enable-tls.sh, systemd unit
├── services/
│   ├── gps-ingestor/           # Go service – TCP listener + batched ingest
│   ├── api/                    # NestJS REST + WebSocket
│   └── web/                    # React SPA (landing + dashboard)
├── docs/                       # ARCHITECTURE.md, DEPLOYMENT.md
└── .github/workflows/deploy.yml
```

## License

Proprietary © Fleex / OT LLC.
