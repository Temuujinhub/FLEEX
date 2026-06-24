#!/usr/bin/env bash
# Fleex off-host backup (audit L6). Dumps Postgres — the source of truth,
# including the tamper-evident audit hash-chain — to a compressed custom-format
# archive, rotates local copies, and optionally ships them off-host.
#
# Run from the deploy host (/opt/fleex) via the fleex-backup systemd timer
# (see infra/deploy/systemd/) or cron. The audit hash-chain proves rows weren't
# mutated; it does NOT protect against a dropped table/volume — this does.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root (e.g. /opt/fleex)

BACKUP_DIR="${BACKUP_DIR:-/opt/fleex/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

# Read DB creds from .env without sourcing the whole file into the shell.
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true)"
: "${POSTGRES_USER:?POSTGRES_USER missing from .env}"
: "${POSTGRES_DB:?POSTGRES_DB missing from .env}"

OUT="$BACKUP_DIR/fleex-${POSTGRES_DB}-${TS}.dump.gz"
echo "[backup] pg_dump ${POSTGRES_DB} -> ${OUT}"
# -Fc = custom format (compressed, supports parallel/selective restore).
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc | gzip -c > "$OUT"

# Optional off-host upload. BACKUP_REMOTE_CMD receives the file path as $1, e.g.
#   BACKUP_REMOTE_CMD='rclone copy "$1" spaces:fleex-backups/'
#   BACKUP_REMOTE_CMD='aws s3 cp "$1" s3://fleex-backups/'
if [ -n "${BACKUP_REMOTE_CMD:-}" ]; then
  echo "[backup] shipping off-host"
  sh -c "$BACKUP_REMOTE_CMD" _ "$OUT"
fi

# Rotate local copies.
find "$BACKUP_DIR" -name 'fleex-*.dump.gz' -mtime +"$KEEP_DAYS" -delete || true

# Best-effort audit-chain integrity check (alert if it ever fails). Needs a
# SUPER_ADMIN token in AUDIT_VERIFY_TOKEN to be enabled.
if [ -n "${AUDIT_VERIFY_TOKEN:-}" ]; then
  if ! curl -fsS -H "Authorization: Bearer ${AUDIT_VERIFY_TOKEN}" \
       http://127.0.0.1/api/audit/verify >/dev/null; then
    echo "[backup] WARNING: audit-chain verify failed" >&2
  fi
fi

echo "[backup] done; kept last ${KEEP_DAYS}d in ${BACKUP_DIR}"
