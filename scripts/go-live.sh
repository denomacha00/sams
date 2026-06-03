#!/usr/bin/env bash
# One-shot production go-live: backup secrets, pull main, build, migrate, readiness gate, restart, verify.
# Does NOT overwrite secrets/providers.env or packages/backend/.env.
#
# Usage (on VPS):
#   cd /var/www/sams && bash scripts/go-live.sh
#
# Prerequisites:
#   - Node 20+ (bash scripts/install-node20-ubuntu.sh or scripts/upgrade-node20.sh)
#   - Production AT + BIOMETRIC_MASTER_KEY in secrets/providers.env
#   - NODE_ENV=production in packages/backend/.env
#
# Exits non-zero if production-readiness-check or post-deploy-verify fails.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ERROR: Node $(node -v 2>/dev/null || echo missing) — SAMS requires Node 20+." >&2
  echo "       Ubuntu (no nvm): bash scripts/install-node20-ubuntu.sh" >&2
  echo "       With nvm:        bash scripts/upgrade-node20.sh" >&2
  echo "       Docs: DOCUMENTATION.md §9" >&2
  exit 1
fi

echo "==> SAMS go-live ($(date -Iseconds))"

echo "==> 1/7 Backup provider secrets"
bash "$ROOT/scripts/backup-secrets.sh"

echo "==> 2/7 Pull latest main"
git fetch origin main
git pull --ff-only origin main

echo "==> 3/7 Install dependencies"
npm ci

echo "==> 4/7 Build all packages"
npm run build -w @sams/shared
rm -rf "$ROOT/packages/backend/dist"
npm run build -w @sams/backend
npm run build -w @sams/frontend
npm run build -w @sams/super-admin

verify_spa() {
  local label="$1"
  local dir="$2"
  [[ -f "$dir/index.html" ]] || { echo "ERROR: $label missing $dir/index.html" >&2; exit 1; }
  echo "    OK $label dist"
}
verify_spa "Main app" "$ROOT/packages/frontend/dist"
verify_spa "Super Admin" "$ROOT/packages/super-admin/dist"
[[ -f "$ROOT/packages/backend/dist/index.js" ]] || {
  echo "ERROR: Backend build failed — no dist/index.js" >&2
  exit 1
}
echo "    OK Backend dist"

echo "==> 5/7 Database migrate"
cd "$ROOT/packages/backend"
npx prisma generate
npx prisma migrate deploy
npm run create-super-admin || true
cd "$ROOT"

echo "==> 6/7 Production readiness (must pass)"
bash "$ROOT/scripts/production-readiness-check.sh"

echo "==> 7/7 Restart API and verify"
bash "$ROOT/scripts/restart-api.sh"
bash "$ROOT/scripts/post-deploy-verify.sh"

echo ""
echo "==> Go-live finished successfully"
echo "    App:         https://app.smart-managment.com"
echo "    Super Admin: https://super.smart-managment.com"
echo "    Health:      curl -s http://127.0.0.1:3001/health | grep -E '\"mode\":\"production\"|\"sandbox\":false'"
