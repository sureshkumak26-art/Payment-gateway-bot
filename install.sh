#!/usr/bin/env bash
set -euo pipefail

APP_NAME="anime-cloud-pay"
APP_DIR="/opt/anime-cloud-pay"
REPO_URL="https://github.com/sureshkumak26-art/Payment-gateway-bot.git"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash install.sh"
  exit 1
fi

echo "=============================================="
echo " Anime Cloud Pay - One Command Installer"
echo "=============================================="

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch origin
  git -C "${APP_DIR}" reset --hard origin/main
else
  rm -rf "${APP_DIR}"
  git clone "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
  else
    cat > .env <<'EOF'
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://pay.example.com
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
ADMIN_ROLE_ID=
MONGODB_URI=mongodb://127.0.0.1:27017/anime_cloud_pay
ZAPPAY_API_KEY=
ZAPPAY_API_BASE_URL=https://zappay-beta.vercel.app
POLL_INTERVAL_MS=15000
BRAND_NAME=Anime Cloud Pay
CURRENCY=INR
EOF
  fi
  echo "Created ${APP_DIR}/.env"
else
  echo ".env already exists; keeping existing secrets/configuration."
fi

# Start MongoDB if this repository provides a compose file.
if [[ -f docker-compose.yml || -f compose.yml ]]; then
  docker compose up -d mongodb 2>/dev/null || docker compose up -d
fi

# Install PM2 globally if needed.
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
pm2 start npm --name "${APP_NAME}" -- start
pm2 save

STARTUP_CMD="$(pm2 startup systemd -u root --hp /root | tail -n 1 || true)"
if [[ "${STARTUP_CMD}" == sudo* ]]; then
  eval "${STARTUP_CMD}" || true
fi
pm2 save

cat <<EOF

==============================================
 Installation complete
==============================================
Project: ${APP_DIR}

Edit configuration:
  nano ${APP_DIR}/.env

Then restart:
  cd ${APP_DIR}
  pm2 restart ${APP_NAME}

Check status/logs:
  pm2 status
  pm2 logs ${APP_NAME}

Local health check:
  curl -I http://127.0.0.1:3000/ || true

IMPORTANT:
1. Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env.
2. Set ZAPPAY_API_KEY in .env.
3. Set PUBLIC_BASE_URL to your HTTPS payment domain.
4. Confirm MONGODB_URI matches your MongoDB deployment.
5. Never commit .env or share your secrets.
==============================================
EOF
