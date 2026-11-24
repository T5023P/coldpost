#!/usr/bin/env bash
# Cold Post — Oracle Cloud Always Free (Ampere A1, Ubuntu 24.04 ARM64) bootstrap.
#
# Run once on a fresh instance as root:
#   sudo bash deploy/bootstrap.sh
#
# Installs Docker, sqlite3, cloudflared and creates the persistent data layout.
# It never starts the application: that is done by deploy.sh / GitHub Actions.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/bootstrap.sh" >&2
  exit 1
fi

ARCH="$(uname -m)"
if [ "$ARCH" != "aarch64" ]; then
  echo "WARNING: expected aarch64 (Ampere A1), found $ARCH" >&2
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Base packages"
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git rsync sqlite3 ufw openssl cron logrotate

echo "==> Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker --version
docker compose version

echo "==> cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update
  apt-get install -y --no-install-recommends cloudflared
fi
cloudflared --version

echo "==> Persistent application data"
# Owned by uid/gid 1000, which is the unprivileged 'node' user inside the image.
install -d -m 0750 -o 1000 -g 1000 /var/lib/coldpost/data
install -d -m 0750 -o 1000 -g 1000 /var/lib/coldpost/data/uploads
install -d -m 0700 /etc/coldpost
install -d -m 0700 /var/backups/coldpost
if [ ! -f /etc/coldpost/backup.key ]; then
  openssl rand -base64 48 > /etc/coldpost/backup.key
  chmod 600 /etc/coldpost/backup.key
  echo "    generated /etc/coldpost/backup.key — copy it into a password manager"
fi

echo "==> Firewall (SSH only; the API is loopback + Cloudflare Tunnel)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
ufw --force enable
ufw status

echo "==> Daily backups (03:15 UTC)"
cat > /etc/cron.d/coldpost-backup <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 * * * root DATA_DIR=/var/lib/coldpost/data /usr/local/bin/coldpost-backup.sh >> /var/log/coldpost-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/coldpost-backup

echo "==> Done."
echo "Next steps:"
echo "  1. Put the app in /opt/coldpost and .env.production (chmod 600) there."
echo "  2. cloudflared service install <TUNNEL_TOKEN>   # token from Cloudflare Zero Trust dashboard"
echo "  3. docker compose up -d --build"
