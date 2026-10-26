#!/usr/bin/env bash
# One-time setup of the SortSite API + scanner on an Oracle Cloud "Always Free" Ubuntu VM.
# Run from the repository root on the server:  bash deploy/oracle/setup.sh
# Re-running it updates the app (git pull + rebuild) and keeps the existing .env and data.
set -euo pipefail

cd "$(dirname "$0")/../.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
fi

# Oracle's Ubuntu images block everything except SSH in iptables; open HTTP/HTTPS for Caddy.
if ! sudo iptables -C INPUT -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save; fi
fi

IP=$(curl -fsS https://api.ipify.org)
DOMAIN="${IP//./-}.sslip.io"

if [ ! -f .env ]; then
  read -r -p "Admin email [admin@ecomback.com]: " ADMIN_EMAIL
  ADMIN_EMAIL=${ADMIN_EMAIL:-admin@ecomback.com}
  while :; do
    read -r -s -p "Admin password (min 12 characters): " ADMIN_PASSWORD; echo
    [ ${#ADMIN_PASSWORD} -ge 12 ] && break
    echo "Too short, try again."
  done
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
BASE_URL=https://ecom-back-sortsite.vercel.app
SECRET_KEY=$(openssl rand -hex 32)
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$ADMIN_PASSWORD
SEED_ADMIN_NAME=EcomBack Admin
SCANNER_IPS=$IP
PAGE_CONCURRENCY=4
SCAN_CONCURRENCY=2
EOF
  echo "Wrote .env (keep it: SECRET_KEY decrypts stored credentials)."
fi

git pull --ff-only || true
sudo docker compose -f docker-compose.yml -f deploy/oracle/docker-compose.caddy.yml up -d --build

echo
echo "Waiting for the API..."
for _ in $(seq 1 60); do
  if curl -fsS "https://$DOMAIN/api/v1/health" 2>/dev/null; then
    echo
    echo "Done. API address: https://$DOMAIN"
    exit 0
  fi
  sleep 5
done
echo "The API did not answer on https://$DOMAIN yet. Check: sudo docker compose -f docker-compose.yml -f deploy/oracle/docker-compose.caddy.yml logs --tail 50"
exit 1
