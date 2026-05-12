# Fleex Deployment Runbook

This is the operational guide for running Fleex on `178.128.27.70`
(DigitalOcean droplet) with auto-deploy from GitHub.

## 0. Prerequisites

- Domain `fleex.mn` (A record → `178.128.27.70`, plus `www.fleex.mn`)
- DigitalOcean droplet: 8 vCPU / 32 GB RAM / 1 TB NVMe, Ubuntu 22.04 LTS
- SSH access as `root` (initial) — you can disable root login after setup
- GitHub repo cloned somewhere you can push to (default:
  `temuujinhub/fleex`, branch `claude/saas-auto-deploy-Ap2l1`)

## 1. One-time server bootstrap

```bash
ssh root@178.128.27.70
curl -fsSL https://raw.githubusercontent.com/temuujinhub/fleex/claude/saas-auto-deploy-Ap2l1/infra/deploy/setup-server.sh \
  | bash -s -- https://github.com/temuujinhub/fleex.git claude/saas-auto-deploy-Ap2l1
```

`setup-server.sh` will:

1. `apt update && upgrade`, install Docker, UFW, fail2ban, certbot, jq, git.
2. Open ports 22, 80, 443, 5027 (Teltonika) via UFW.
3. Create the `deploy` user, add it to the `docker` group.
4. Drop a `sudoers.d/fleex-deploy` that lets `deploy` run *only* the deploy
   scripts and docker commands with NOPASSWD.
5. `git clone` the repo into `/opt/fleex` as `deploy`.
6. Copy `.env.example` → `.env` if not present.

### Customize `.env`

```bash
sudo -u deploy nano /opt/fleex/.env
```

Set at minimum:

- `JWT_SECRET` — a long random string (64+ chars)
- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`
- `GOOGLE_MAPS_API_KEY`
- `SMTP_*` and `SMS_*` if alerts are required

`chmod 0600 /opt/fleex/.env` — `setup-server.sh` does this for you.

## 2. First deploy

```bash
sudo -u deploy /opt/fleex/infra/deploy/deploy.sh
```

This will `git fetch + reset`, build all images, bring the stack up, and
block until `postgres`, `redis`, `api`, `ingestor` report `healthy`. On any
failure it rolls back to the previous commit automatically.

Open `http://178.128.27.70` and log in with the bootstrap admin credentials
from `.env`. **Change that password immediately.**

## 3. Enable HTTPS (once DNS resolves)

```bash
sudo /opt/fleex/infra/deploy/enable-tls.sh fleex.mn admin@fleex.mn
```

- Obtains a Let's Encrypt cert for `fleex.mn` and `www.fleex.mn` via the
  HTTP-01 challenge (served by the running nginx).
- Renames `fleex-tls.conf.disabled` → `fleex-tls.conf` and disables the
  plain-HTTP server block.
- Reloads nginx.

### Auto-renew

Add a crontab on the host:

```cron
0 3 * * * cd /opt/fleex && docker run --rm \
    -v "$PWD/infra/nginx/certs:/etc/letsencrypt" \
    -v /var/www/certbot:/var/www/certbot \
    certbot/certbot renew --quiet && \
  docker compose exec nginx nginx -s reload
```

## 4. Wire GitHub Actions

Set these GitHub repo secrets:

| Secret               | Notes                                           |
| -------------------- | ----------------------------------------------- |
| `DEPLOY_HOST`        | `178.128.27.70`                                 |
| `DEPLOY_USER`        | `deploy`                                        |
| `DEPLOY_SSH_KEY`     | Private OpenSSH key (matching deploy user)      |
| `DEPLOY_SSH_PORT`    | `22` (skip if default)                          |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -H 178.128.27.70` output           |

On the host, append the corresponding public key to
`/home/deploy/.ssh/authorized_keys`:

```bash
sudo -u deploy mkdir -p /home/deploy/.ssh
sudo -u deploy chmod 700 /home/deploy/.ssh
sudo -u deploy nano /home/deploy/.ssh/authorized_keys
sudo -u deploy chmod 600 /home/deploy/.ssh/authorized_keys
```

After that, every push to `main` or `claude/saas-auto-**` triggers
`.github/workflows/deploy.yml`:

1. Build sanity (Go vet/build, Nest build, Vite build).
2. SSH into the host, run `/opt/fleex/infra/deploy/deploy.sh`.
3. Heartbeats on `https://fleex.mn/api/health` once it's live.

## 5. Operations

### Logs

```bash
docker compose logs -f api
docker compose logs -f ingestor --tail=200
```

### Restart a single service

```bash
docker compose restart api
```

### Backups

PostgreSQL data lives in the `postgres-data` named volume. Recommended:
nightly `pg_dump` to a remote object store. Example unit:

```bash
docker exec fleex-postgres pg_dump -U "$POSTGRES_USER" -Fc -f /tmp/fleex-$(date -I).dump "$POSTGRES_DB"
docker cp fleex-postgres:/tmp/fleex-$(date -I).dump /var/backups/fleex/
# then push to Spaces / S3
```

`audit_logs` and the latest `positions_daily` rows should be replicated
**off-host** for compliance — the hash chain only proves nothing was
mutated, not that the table wasn't dropped wholesale.

### Verify audit chain

UI: log in as SUPER_ADMIN → **Аудит лог** → "Гинжийг шалгах" button.
API: `GET /api/audit/verify` (super-admin only).

Recommended: cron a daily call and alert on `ok: false`.

### Scaling notes

- More devices: increase `INGESTOR_BATCH_SIZE` (rows/batch) and Postgres
  `shared_buffers`. The single ingestor handles ~50k rows/s by itself.
- More API throughput: scale `api` horizontally and put it behind nginx's
  `upstream` block. Sessions are stateless thanks to JWT.
- Hot reports: `positions_daily` is already a materialized continuous
  aggregate; expand it with weekly/monthly views as needed.

## 6. Troubleshooting

| Symptom                                          | Where to look                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| Login returns 429                                | Nginx `login_zone` (5 r/m/IP) or Throttler. Wait or relax in `nginx.conf`. |
| Devices online in DB but no markers move         | Redis: `redis-cli -a … pubsub numsub fleex.positions`. Check WS in browser.|
| Positions table growing fast                     | Compression policy stuck? `SELECT * FROM timescaledb_information.jobs;`    |
| Deploy script rolled back                        | Read its tail output. Then `docker compose logs -f` on the failing service.|
| API healthcheck red after migration              | `docker compose logs api`. Most often a Prisma migration drift.            |
| Certbot HTTP-01 fails                            | DNS isn't pointing to the host yet, or port 80 blocked. Run from inside host. |

## 7. Decommission / takedown

```bash
docker compose down -v   # WARNING: -v wipes the database volume
```

Only do this if you've already exported what you need.
