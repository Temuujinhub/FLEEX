#!/usr/bin/env bash
# Fleex deploy script. Invoked by GitHub Actions over SSH; can also be run
# manually as the `deploy` user (or via sudo) on the host.
#
# Steps:
#   1. Capture current commit (rollback target)
#   2. git fetch + checkout requested ref / SHA
#   3. docker compose build (cached) + up -d
#   4. Wait for healthchecks (API + ingestor + web) to pass
#   5. On failure, roll back to the previous commit and rebuild
#
# Environment variables (optional):
#   REF          Branch or tag to deploy (default: current branch)
#   SHA          Commit SHA (informational; logged but not checked out)
#   COMPOSE_FILE Override compose file (default: docker-compose.yml)

set -euo pipefail

cd "$(dirname "$0")/../.."

REF="${REF:-$(git rev-parse --abbrev-ref HEAD)}"
SHA="${SHA:-unknown}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

log() { echo -e "\033[1;32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy]\033[0m $*"; }
fail() { echo -e "\033[1;31m[deploy]\033[0m $*"; exit 1; }

# Preflight: refuse to deploy if JWT_SECRET is missing/weak. The API fails
# fast at boot on a weak secret (services/api/src/auth/jwt-secret.util.ts), so
# without this gate a bad .env would crash-loop the freshly built container
# and 502 the whole site. Validated BEFORE git checkout / container changes so
# the currently-running deploy is left untouched when it fails.
require_strong_jwt_secret() {
  local secret
  secret="$(grep -E '^JWT_SECRET=' .env | tail -n1 | cut -d= -f2-)"
  secret="${secret%$'\r'}"               # tolerate CRLF .env files
  secret="${secret%\"}"; secret="${secret#\"}"
  secret="${secret%\'}"; secret="${secret#\'}"
  case "$secret" in
    "")
      fail "JWT_SECRET is not set in .env — the API will refuse to start. Generate one: openssl rand -hex 32" ;;
    dev-secret-do-not-use|change-me-to-a-long-random-string-min-64-chars)
      fail "JWT_SECRET is still a known placeholder — the API will refuse to start. Generate one: openssl rand -hex 32" ;;
  esac
  if (( ${#secret} < 32 )); then
    fail "JWT_SECRET is shorter than 32 characters — the API will refuse to start. Generate one: openssl rand -hex 32"
  fi
  log "Preflight OK: JWT_SECRET present (${#secret} chars)"
}

if [[ ! -f .env ]]; then
  fail ".env missing. Copy .env.example and set production secrets first."
fi
require_strong_jwt_secret

PREV_COMMIT="$(git rev-parse HEAD)"
log "Current commit: $PREV_COMMIT"
log "Deploying ref=$REF sha=$SHA"

log "Fetching latest from origin"
git fetch --prune origin

log "Checking out $REF"
git checkout "$REF"
git reset --hard "origin/$REF"

NEW_COMMIT="$(git rev-parse HEAD)"
log "New commit: $NEW_COMMIT"

sync_csp_into_tls_conf() {
  # The TLS server block is renamed from fleex-tls.conf.disabled to
  # fleex-tls.conf the first time `enable-tls.sh` runs. After that point,
  # `git reset --hard` no longer touches it because the live file is
  # untracked. So when we tighten / extend the CSP in the .disabled
  # template we need to copy the new header into the live file
  # explicitly. Idempotent: safe to run on every deploy.
  local src="infra/nginx/conf.d/fleex-tls.conf.disabled"
  local dst="infra/nginx/conf.d/fleex-tls.conf"
  [[ -f "$dst" && -f "$src" ]] || return 0

  local new_csp
  new_csp="$(grep -E '^[[:space:]]*add_header Content-Security-Policy' "$src" || true)"
  [[ -n "$new_csp" ]] || return 0

  if ! grep -qF "$new_csp" "$dst"; then
    log "Syncing CSP header from .disabled template into live fleex-tls.conf"
    # Replace the existing CSP line in-place. Both template and live
    # file always have exactly one CSP line in the 443 server block.
    awk -v csp="$new_csp" '
      /add_header Content-Security-Policy/ { print csp; next }
      { print }
    ' "$dst" > "$dst.tmp" && mv "$dst.tmp" "$dst"
  fi
}

build_and_up() {
  sync_csp_into_tls_conf

  log "docker compose build"
  docker compose -f "$COMPOSE_FILE" build --pull

  log "docker compose up -d (with deps & healthchecks)"
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

  # nginx caches upstream container IPs via the docker DNS resolver — when
  # `api` / `web` get rebuilt (new container ID, new IP), nginx keeps the
  # stale entry and serves 502 until something nudges it. Force-recreate
  # nginx so it re-resolves both upstreams. Cheap (image isn't rebuilt)
  # and keeps the deploy self-healing.
  log "Re-creating nginx so it picks up fresh upstream IPs"
  docker compose -f "$COMPOSE_FILE" up -d --force-recreate --no-deps nginx
}

wait_healthy() {
  local svc="$1"
  # 180 × 2s = 360s. API cold-start (prisma db push + TimescaleDB hypertable
  # / continuous aggregate setup, all of which gate Nest's app.listen) can
  # exceed 2 minutes on a fresh database; budget accordingly.
  local tries=180
  local i=0
  while ((tries > 0)); do
    local state
    state="$(docker inspect --format='{{.State.Health.Status}}' "fleex-$svc" 2>/dev/null || echo "unknown")"
    if [[ "$state" == "healthy" ]]; then
      log "$svc is healthy"
      return 0
    fi
    # Heartbeat every ~30s so the SSH session sees output and the GitHub
    # Actions log shows that we're still waiting (rather than appearing
    # hung). Also surfaces lingering "starting" or "unhealthy" status.
    if (( i % 15 == 0 )); then
      log "waiting for $svc (state=$state, $((tries * 2))s remaining)"
    fi
    sleep 2
    tries=$((tries - 1))
    i=$((i + 1))
  done
  warn "$svc never became healthy. Dumping container state and last 200 log lines:"
  docker inspect --format='  status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} err={{.State.Error}}' "fleex-$svc" 2>&1 || true
  echo "---- docker logs fleex-$svc (tail 200) ----"
  docker logs --tail 200 "fleex-$svc" 2>&1 || true
  echo "---- end logs ----"
  return 1
}

rollback() {
  warn "Rolling back to $PREV_COMMIT"
  git reset --hard "$PREV_COMMIT" || true
  docker compose -f "$COMPOSE_FILE" build --pull || true
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans || true
  fail "Deploy failed; rolled back."
}

trap 'rollback' ERR

build_and_up

OK=true
for svc in postgres redis api ingestor events-engine web nginx; do
  wait_healthy "$svc" || OK=false
done

if ! $OK; then
  fail "One or more services failed healthchecks."
fi

log "Pruning dangling images"
docker image prune -f >/dev/null || true

log "Deploy succeeded: $REF @ $NEW_COMMIT"
echo "$NEW_COMMIT" > .last-deploy.sha
date -u +%FT%TZ >> .last-deploy.sha
