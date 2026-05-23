#!/usr/bin/env bash
# One-time bootstrap for the Fleex host (178.128.27.70).
#
# Run as root on a fresh Ubuntu 22.04 / Debian 12 box. It installs Docker,
# the firewall, fail2ban, creates the `deploy` user with sudo access for the
# deploy script only, and clones the repo into /opt/fleex.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/fleex/<branch>/infra/deploy/setup-server.sh | sudo bash -s -- <github-repo-url> [<branch>]
#
# After this script finishes:
#   1) Add your ~/.ssh/id_ed25519.pub to /home/deploy/.ssh/authorized_keys
#   2) Edit /opt/fleex/.env (start from .env.example) and set secrets
#   3) Run /opt/fleex/infra/deploy/deploy.sh as the deploy user (first deploy)
#   4) Once DNS for fleex.mn → 178.128.27.70 resolves, run enable-tls.sh

set -euo pipefail

REPO_URL="${1:-}"
BRANCH="${2:-main}"
if [[ -z "$REPO_URL" ]]; then
  echo "Usage: $0 <github-repo-url> [<branch>]" >&2
  exit 1
fi

log() { echo -e "\033[1;36m[setup]\033[0m $*"; }

log "Updating apt & installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release \
  ufw fail2ban git jq unattended-upgrades \
  python3-certbot-nginx

log "Installing Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

log "Configuring UFW firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 5027/tcp  comment 'Teltonika TCP'
ufw --force enable

log "Configuring fail2ban"
cat >/etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
EOF
systemctl restart fail2ban

log "Creating deploy user"
if ! id deploy >/dev/null 2>&1; then
  useradd -m -s /bin/bash deploy
  usermod -aG docker deploy
fi

# Allow `deploy` to run ONLY the two deploy scripts as root without a
# password. Docker access comes from the `docker` group membership above, so
# `docker`/`docker-compose` are deliberately NOT in this allowlist —
# passwordless `sudo docker` is root-equivalent (e.g. `docker run -v /:/host`)
# and would make the whole allowlist moot.
cat >/etc/sudoers.d/fleex-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /opt/fleex/infra/deploy/deploy.sh, /opt/fleex/infra/deploy/enable-tls.sh
EOF
chmod 0440 /etc/sudoers.d/fleex-deploy

log "Cloning repo into /opt/fleex"
if [[ ! -d /opt/fleex/.git ]]; then
  mkdir -p /opt/fleex
  chown deploy:deploy /opt/fleex
  sudo -u deploy git clone "$REPO_URL" /opt/fleex
fi
cd /opt/fleex
sudo -u deploy git fetch origin "$BRANCH"
sudo -u deploy git checkout "$BRANCH"

if [[ ! -f /opt/fleex/.env ]]; then
  cp /opt/fleex/.env.example /opt/fleex/.env
  chown deploy:deploy /opt/fleex/.env
  chmod 0600 /opt/fleex/.env
  log "NOTE: edit /opt/fleex/.env with real secrets before running deploy.sh"
fi

mkdir -p /var/www/certbot
mkdir -p /opt/fleex/infra/nginx/certs

log "Enabling unattended-upgrades for security patches"
dpkg-reconfigure -plow unattended-upgrades || true

log "Setup complete."
echo
echo "Next steps:"
echo "  1) Add your CI deploy key to /home/deploy/.ssh/authorized_keys"
echo "  2) Edit /opt/fleex/.env with production secrets"
echo "  3) Run: sudo -u deploy /opt/fleex/infra/deploy/deploy.sh"
echo "  4) After DNS points to this host: sudo /opt/fleex/infra/deploy/enable-tls.sh fleex.mn admin@fleex.mn"
