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

mkdir -p /var/www/certbot
mkdir -p infra/nginx/certs

# Use certbot in standalone-via-webroot mode — it places the challenge under
# /var/www/certbot which our nginx config already serves.
docker run --rm \
  -v "$PWD/infra/nginx/certs:/etc/letsencrypt" \
  -v "/var/www/certbot:/var/www/certbot" \
  certbot/certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --email "$EMAIL" --agree-tos --no-eff-email \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive

# Activate the TLS server block.
if [[ -f infra/nginx/conf.d/fleex-tls.conf.disabled ]]; then
  mv infra/nginx/conf.d/fleex-tls.conf.disabled infra/nginx/conf.d/fleex-tls.conf
fi

# Drop the plain-HTTP catch-all that served the SPA on 80 (the new TLS file
# already serves /api & /ws and redirects the rest of port 80 -> 443).
if [[ -f infra/nginx/conf.d/fleex.conf ]]; then
  mv infra/nginx/conf.d/fleex.conf infra/nginx/conf.d/fleex-http.conf.disabled
fi

docker compose exec nginx nginx -t
docker compose restart nginx

echo "TLS enabled for https://$DOMAIN"
echo "Add a daily cron job to renew the certificate. See docs/DEPLOYMENT.md."
