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

if [[ ! -f .env ]]; then
  fail ".env missing. Copy .env.example and set production secrets first."
fi

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

build_and_up() {
  log "docker compose build"
  docker compose -f "$COMPOSE_FILE" build --pull

  log "docker compose up -d (with deps & healthchecks)"
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
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
for svc in postgres redis api ingestor; do
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
