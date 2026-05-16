#!/usr/bin/env bash
# Whitelisted admin operations for production host. Invoked over SSH by
# the `admin-task` GitHub Actions workflow; can also be run manually as
# the `deploy` user. Every command is enumerated below — unknown names
# are rejected, so the workflow can never run an arbitrary shell line.
#
#   ./infra/deploy/admin-task.sh <command> [tail-lines]
#
# See .github/workflows/admin-task.yml for the UI-facing list.

set -euo pipefail

cd "$(dirname "$0")/../.."

CMD="${1:?command name required}"
TAIL="${2:-200}"
[[ "$TAIL" =~ ^[0-9]+$ ]] || TAIL=200

COMPOSE="docker compose -f docker-compose.yml"

log()  { echo -e "\033[1;32m[admin]\033[0m $*"; }
warn() { echo -e "\033[1;33m[admin]\033[0m $*"; }

case "$CMD" in
  status)
    log "Container status"
    $COMPOSE ps
    log "Disk"
    df -h /
    log "Memory"
    free -h
    log "Uptime"
    uptime
    ;;

  logs-api)
    $COMPOSE logs --tail="$TAIL" --no-color api
    ;;

  logs-ingestor)
    $COMPOSE logs --tail="$TAIL" --no-color gps-ingestor
    ;;

  logs-engine)
    $COMPOSE logs --tail="$TAIL" --no-color events-engine
    ;;

  logs-web)
    $COMPOSE logs --tail="$TAIL" --no-color web
    ;;

  logs-db)
    $COMPOSE logs --tail="$TAIL" --no-color postgres
    ;;

  restart-api)
    log "Restarting api"
    $COMPOSE restart api
    sleep 3
    $COMPOSE ps api
    ;;

  restart-ingestor)
    log "Restarting gps-ingestor"
    $COMPOSE restart gps-ingestor
    sleep 3
    $COMPOSE ps gps-ingestor
    ;;

  restart-engine)
    log "Restarting events-engine"
    $COMPOSE restart events-engine
    sleep 3
    $COMPOSE ps events-engine
    ;;

  restart-web)
    log "Restarting web"
    $COMPOSE restart web
    sleep 3
    $COMPOSE ps web
    ;;

  restart-all)
    log "Restarting all services"
    $COMPOSE restart
    sleep 5
    $COMPOSE ps
    ;;

  seed-demo-companies)
    # Идемпотент: .env-д flag тавьж API restart хийнэ. DemoSeedService
    # bootstrap дээр upsert-ээр компани/admin үүсгэнэ.
    if [[ ! -f .env ]]; then
      warn ".env missing — cannot enable demo seed"
      exit 1
    fi
    if grep -q '^SEED_DEMO_COMPANIES=' .env; then
      sed -i 's/^SEED_DEMO_COMPANIES=.*/SEED_DEMO_COMPANIES=true/' .env
    else
      echo 'SEED_DEMO_COMPANIES=true' >> .env
    fi
    if ! grep -q '^SEED_DEMO_PASSWORD=' .env; then
      echo 'SEED_DEMO_PASSWORD=Fleex@2026' >> .env
    fi
    log "Flag set, restarting api"
    $COMPOSE restart api
    log "Waiting for bootstrap (30s)"
    sleep 30
    log "Recent bootstrap output"
    $COMPOSE logs --tail=120 --no-color api | grep -iE 'demo tenant|bootstrap|seed' || warn "No seed output found — check full logs"
    ;;

  prune-images)
    log "Pruning dangling images"
    docker image prune -f
    log "Disk after prune"
    df -h /
    ;;

  *)
    echo "Unknown command: $CMD" >&2
    echo "Allowed: status, logs-api, logs-ingestor, logs-engine, logs-web, logs-db, restart-api, restart-ingestor, restart-engine, restart-web, restart-all, seed-demo-companies, prune-images" >&2
    exit 2
    ;;
esac
