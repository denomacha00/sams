#!/usr/bin/env bash
# Full production deploy for SAMS VPS.
# Always rebuilds frontend + super-admin dist (never rely on git for dist/).
#
# Usage (on server):
#   cd /var/www/sams && bash scripts/deploy-production.sh
#
# Safe to run after every `git pull` or let GitHub Actions run it for you.
# Does NOT modify packages/backend/.env, .env.secrets, or secrets/providers.env (keys stay on disk).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "WARN: Node $(node -v) — SAMS requires Node 20+ (see .nvmrc)." >&2
  echo "      Upgrade (nvm):  bash scripts/upgrade-node20.sh" >&2
  echo "      Upgrade (apt):  bash scripts/install-node20-ubuntu.sh" >&2
  echo "      Docs: DOCUMENTATION.md §9 — Upgrading Node.js to 20 on Ubuntu VPS" >&2
fi

echo "==> SAMS production deploy ($(date -Iseconds))"

ENV_FILE="$ROOT/packages/backend/.env"
ENV_DEPLOY_BACKUP=""
PROTECT_ENV_FILES=(
  "$ENV_FILE"
  "$ROOT/secrets/providers.env"
  "/var/www/sams/secrets/providers.env"
  "$ROOT/packages/backend/.env.secrets"
)

backup_deploy_env_files() {
  local f
  for f in "${PROTECT_ENV_FILES[@]}"; do
    [[ -f "$f" ]] || continue
    if [[ -z "$ENV_DEPLOY_BACKUP" ]]; then
      ENV_DEPLOY_BACKUP="$(mktemp -d)"
    fi
    cp "$f" "${ENV_DEPLOY_BACKUP}/$(basename "$f").$(echo "$f" | tr '/:' '__')"
  done
}

restore_deploy_env_files() {
  local f base saved
  [[ -n "${ENV_DEPLOY_BACKUP:-}" && -d "$ENV_DEPLOY_BACKUP" ]] || return 0
  for f in "${PROTECT_ENV_FILES[@]}"; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f").$(echo "$f" | tr '/:' '__')"
    saved="${ENV_DEPLOY_BACKUP}/${base}"
    if [[ -f "$saved" ]]; then
      cp "$saved" "$f"
      echo "    Protected $f (restored after git reset)"
    fi
  done
  rm -rf "$ENV_DEPLOY_BACKUP"
  ENV_DEPLOY_BACKUP=""
}

backup_deploy_env_files

# Clean match to GitHub main (avoids dist merge conflicts). Never rely on git for .env / secrets.
git fetch origin main
git reset --hard origin/main

restore_deploy_env_files

echo "==> Installing dependencies"
npm ci

echo "==> Generating Prisma client"
cd "$ROOT/packages/backend"
npx prisma generate
cd "$ROOT"

echo "==> Building packages"
npm run build -w @sams/shared
# Remove stale compiled output (git reset can restore old dist/index.js with outdated /health)
rm -rf "$ROOT/packages/backend/dist"
npm run build -w @sams/backend
npm run build -w @sams/frontend
npm run build -w @sams/super-admin

verify_spa_dist() {
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

verify_backend_dist() {
  local dir="$ROOT/packages/backend/dist"
  local entry="$dir/index.js"
  local health_module="$dir/registerApplication.js"
  local legacy="$dir/backend/src/index.js"
  if [[ ! -f "$entry" ]]; then
    if [[ -f "$legacy" ]]; then
      echo "    WARN: Found legacy $legacy — rebuilding with rootDir ./src should produce dist/index.js" >&2
      entry="$legacy"
    else
      echo "ERROR: Backend build failed — no dist/index.js under $dir" >&2
      find "$dir" -name 'index.js' 2>/dev/null | head -5 >&2 || true
      exit 1
    fi
  fi
  # /health (ai, otp, sms) lives in registerApplication.js — not index.js (dynamic import).
  if [[ ! -f "$health_module" ]] \
    || ! grep -qE 'getAIHealthSummary|passwordResetEnabled' "$health_module" 2>/dev/null; then
    echo "ERROR: Backend dist looks stale (missing expanded /health in registerApplication.js)." >&2
    echo "       Fix: rm -rf packages/backend/dist && npm run build -w @sams/backend" >&2
    exit 1
  fi
  echo "    OK Backend ($entry + registerApplication.js)"
}

echo "==> Verifying build output"
verify_spa_dist "Main app" "$ROOT/packages/frontend/dist"
verify_spa_dist "Super Admin" "$ROOT/packages/super-admin/dist"
verify_backend_dist

echo "==> Database & super admin bootstrap"
cd "$ROOT/packages/backend"
npx prisma generate
# Existing VPS DBs (db push / incremental migrations only): mark init as applied once.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
if [[ -n "${DATABASE_URL:-}" ]] && command -v psql >/dev/null 2>&1; then
  if psql "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='User' LIMIT 1" 2>/dev/null | grep -q 1; then
    if ! psql "$DATABASE_URL" -tAc "SELECT 1 FROM _prisma_migrations WHERE migration_name='20240101000000_init' LIMIT 1" 2>/dev/null | grep -q 1; then
      echo "==> Baselining 20240101000000_init on existing database"
      npx prisma migrate resolve --applied 20240101000000_init
    fi
  fi
fi
npx prisma migrate deploy
npm run create-super-admin || true
cd "$ROOT"

echo "==> Uploads directories (avatars)"
UPLOADS_ROOT="${UPLOADS_DIR:-/var/www/sams/uploads}"
mkdir -p "$UPLOADS_ROOT/avatars"
# Fix avatars saved to uploads root when UPLOADS_DIR was set without /avatars
find "$UPLOADS_ROOT" -maxdepth 1 -type f -name '*.jpg' -exec mv -n -t "$UPLOADS_ROOT/avatars/" {} + 2>/dev/null || true

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ENV_FILE"
JWT_VAL="$(read_merged_env JWT_SECRET)"
if is_weak_production_secret "$JWT_VAL"; then
  echo "ERROR: JWT_SECRET missing or shorter than 64 chars — API will crash-loop in production." >&2
  echo "       Run: bash scripts/set-production-env.sh" >&2
  echo "       Then re-run: bash scripts/deploy-production.sh" >&2
  exit 1
fi

echo "==> Restarting services"
mkdir -p /var/log/sams
# Provider secrets: secrets/providers.env or packages/backend/.env.secrets (gitignored).
# Deploy never creates, copies, or overwrites those files — only pm2-start.js loads them after .env.
mkdir -p "$ROOT/secrets"
chmod 700 "$ROOT/secrets" 2>/dev/null || true
# delete + start applies ecosystem changes (instances, exec_mode); reload keeps old cluster layout
pm2 delete sams-api 2>/dev/null || true
source_merged_env
pm2 start ecosystem.config.js --env production --update-env
pm2 save
sudo nginx -t
sudo systemctl reload nginx

echo "==> Deploy finished successfully"
echo "    App:         https://app.smart-managment.com"
echo "    Super Admin: https://super.smart-managment.com"
echo "    Env: packages/backend/.env was not overwritten by git (see restore_deploy_env_files above if shown)"
echo "    After first deploy or weak JWT: bash scripts/set-production-env.sh"

echo "==> Running post-deploy verification"
sleep 3
bash "$ROOT/scripts/post-deploy-verify.sh" || {
  echo "WARN: Post-deploy verification reported issues (see above)" >&2
  exit 1
}
