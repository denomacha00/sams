#!/usr/bin/env bash
# One-shot production deploy after git pull (VPS).
#
# Usage:
#   cd /var/www/sams && git pull origin main
#   cd /var/www/sams && bash scripts/vps-full-deploy.sh
#
# Override install root:
#   SAMS_ROOT=/var/www/sams bash scripts/vps-full-deploy.sh

set -euo pipefail

ROOT="${SAMS_ROOT:-/var/www/sams}"
if [[ ! -d "$ROOT" ]]; then
  echo "ERROR: SAMS_ROOT not found: $ROOT" >&2
  exit 1
fi
cd "$ROOT"

echo "==> SAMS VPS full deploy ($(date -Iseconds))"
echo "    Root: $ROOT"

echo "==> 1/6 Production backup"
bash "$ROOT/scripts/backup-production.sh"

echo "==> 2/6 Prisma migrate deploy"
cd "$ROOT/packages/backend"
npx prisma migrate deploy
cd "$ROOT"

echo "==> 3/6 deploy-production.sh"
bash "$ROOT/scripts/deploy-production.sh"

echo "==> 4/6 post-deploy-verify.sh"
bash "$ROOT/scripts/post-deploy-verify.sh"

echo "==> 5/6 Nginx reload (if sams.conf present)"
NGINX_SAMS=()
for candidate in \
  /etc/nginx/sites-enabled/sams.conf \
  /etc/nginx/sites-available/sams.conf \
  /etc/nginx/conf.d/sams.conf; do
  [[ -f "$candidate" ]] && NGINX_SAMS+=("$candidate")
done
if [[ ${#NGINX_SAMS[@]} -gt 0 ]]; then
  echo "    Found: ${NGINX_SAMS[*]}"
  sudo nginx -t
  sudo systemctl reload nginx
  echo "    OK  nginx reloaded"
else
  echo "    SKIP  no sams.conf under /etc/nginx (deploy-production still reloads nginx)"
fi

echo "==> 6/6 PM2 status"
if command -v pm2 >/dev/null 2>&1; then
  pm2 status || true
  pm2 describe sams-api 2>/dev/null | sed -n '1,25p' || true
else
  echo "WARN: pm2 not in PATH" >&2
fi

echo "==> VPS full deploy finished"