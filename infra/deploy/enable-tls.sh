#!/usr/bin/env bash
# Provisions Let's Encrypt certificates for the public domain and enables
# the TLS server block in nginx. Run on the host AFTER:
#   - DNS for fleex.mn (and www.fleex.mn) resolves to this server
#   - The stack is up and the HTTP nginx is reachable on port 80
#
# Usage:
#   sudo ./infra/deploy/enable-tls.sh fleex.mn admin@fleex.mn

set -euo pipefail
DOMAIN="${1:-fleex.mn}"
EMAIL="${2:-}"
if [[ -z "$EMAIL" ]]; then
  echo "Email required (used by certbot for renewal warnings)." >&2
  echo "Usage: $0 <domain> <email>" >&2
  exit 1
fi

cd "$(dirname "$0")/../.."

mkdir -p infra/nginx/certs

# Build the -d arg list. We always include the apex; www is added only if
# its DNS A record actually resolves to this host. This avoids the
# Let's Encrypt NXDOMAIN failure we used to hit when www was never set up.
DOMAINS=( -d "$DOMAIN" )
if getent hosts "www.$DOMAIN" >/dev/null 2>&1; then
  DOMAINS+=( -d "www.$DOMAIN" )
  echo "[enable-tls] www.$DOMAIN resolves; including in the certificate"
else
  echo "[enable-tls] www.$DOMAIN does not resolve; requesting cert for $DOMAIN only"
fi

# Standalone mode beats webroot here: it does not need /var/www/certbot
# mounted into the nginx container, and it survives the brief window
# where nginx is stopped to free port 80.
echo "[enable-tls] Stopping nginx to free port 80 for certbot"
docker compose stop nginx

echo "[enable-tls] Requesting certificate from Let's Encrypt"
docker run --rm \
  -p 80:80 \
  -v "$PWD/infra/nginx/certs:/etc/letsencrypt" \
  certbot/certbot certonly \
    --standalone \
    --email "$EMAIL" --agree-tos --no-eff-email \
    "${DOMAINS[@]}" \
    --non-interactive

# Activate the TLS server block.
if [[ -f infra/nginx/conf.d/fleex-tls.conf.disabled ]]; then
  mv infra/nginx/conf.d/fleex-tls.conf.disabled infra/nginx/conf.d/fleex-tls.conf
fi

# Drop the plain-HTTP catch-all that served the SPA on 80 (the new TLS file
# already serves /api and /ws and redirects the rest of port 80 to 443).
# upstreams.conf stays — both fleex.conf and fleex-tls.conf reference its
# upstream blocks.
if [[ -f infra/nginx/conf.d/fleex.conf ]]; then
  mv infra/nginx/conf.d/fleex.conf infra/nginx/conf.d/fleex-http.conf.disabled
fi

echo "[enable-tls] Starting nginx with the new TLS config"
docker compose start nginx
sleep 2
docker compose exec nginx nginx -t

# Auto-renewal (audit L7): install + enable the systemd timer so the cert can
# never silently expire (which would self-DoS the whole site). Idempotent.
if command -v systemctl >/dev/null 2>&1; then
  echo "[enable-tls] Installing the renewal timer"
  cp infra/deploy/systemd/fleex-certbot-renew.service /etc/systemd/system/
  cp infra/deploy/systemd/fleex-certbot-renew.timer   /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now fleex-certbot-renew.timer
  echo "[enable-tls] Renewal timer: $(systemctl is-active fleex-certbot-renew.timer)"
else
  echo "[enable-tls] systemd not found — set up renewal manually (see docs/DEPLOYMENT.md)."
fi

echo "TLS enabled for https://$DOMAIN"
