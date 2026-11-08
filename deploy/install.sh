#!/bin/sh
# One-shot install on a fresh Debian/Ubuntu server, as root:
#   curl -fsSL https://raw.githubusercontent.com/damienboudousquie-sudo/how-much-is-it/master/deploy/install.sh | sh -s -- [domain]
# Without a domain the site answers on http://SERVER_IP; run again with the domain later
# to switch to HTTPS.
set -eu

DOMAIN="${1:-}"
DIR=/opt/how-much-is-it
REPO=https://github.com/damienboudousquie-sudo/how-much-is-it.git

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl ca-certificates ufw

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker"
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Firewall (SSH, HTTP, HTTPS)"
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> Code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR"

echo "==> Settings"
touch .env
sed -i '/^SITE_ADDRESS=/d' .env
if [ -n "$DOMAIN" ]; then
  echo "SITE_ADDRESS=$DOMAIN, www.$DOMAIN" >> .env
else
  echo "SITE_ADDRESS=:80" >> .env
fi

echo "==> Build and start (first time: 2 to 4 minutes)"
docker compose up -d --build
docker image prune -f >/dev/null

IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | cut -d' ' -f1)
echo
if [ -n "$DOMAIN" ]; then
  echo "Done: https://$DOMAIN (once the domain points to $IP)"
else
  echo "Done: http://$IP"
fi
echo "Full map scan progress: /api/scan"
