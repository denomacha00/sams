#!/usr/bin/env bash
# Full production deploy for SAMS VPS.
# Always rebuilds frontend + super-admin dist (never rely on git for dist/).
#
# Usage (on server):
#   cd /var/www/sams && bash scripts/deploy-production.sh
#
# Safe to run after every `git pull` or let GitHub Actions run it for you.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> SAMS production deploy ($(date -Iseconds))"

# Clean match to GitHub main (avoids dist merge conflicts)
git fetch origin main
git reset --hard origin/main

echo "==> Installing dependencies"
npm ci

echo "==> Building packages"
npm run build -w @sams/shared
npm run build -w @sams/backend
npm run build -w @sams/frontend
npm run build -w @sams/super-admin

verify_dist() {
  local name="$1"
  local dir="$2"
  if [[ ! -f "$dir/index.html" ]]; then
    echo "ERROR: $name build failed — missing $dir/index.html" >&2
    exit 1
  fi
  local js_count
  js_count="$(find "$dir/assets" -maxdepth 1 -name '*.js' 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$js_count" -lt 1 ]]; then
    echo "ERROR: $name build failed — no JS in $dir/assets" >&2
    exit 1
  fi
  echo "    OK $name ($js_count JS bundle(s))"
}

echo "==> Verifying build output"
verify_dist "Main app" "$ROOT/packages/frontend/dist"
verify_dist "Super Admin" "$ROOT/packages/super-admin/dist"
verify_dist "Backend" "$ROOT/packages/backend/dist"

echo "==> Database & super admin bootstrap"
cd "$ROOT/packages/backend"
npx prisma generate
npx prisma migrate deploy
npm run create-super-admin || true
cd "$ROOT"

echo "==> Restarting services"
pm2 reload ecosystem.config.js --env production
sudo nginx -t
sudo systemctl reload nginx

echo "==> Deploy finished successfully"
echo "    App:         https://app.smart-managment.com"
echo "    Super Admin: https://super.smart-managment.com"
