#!/usr/bin/env bash
# Gate checks before restarting PM2 during deploy (or manually before a risky update).
# Usage: bash scripts/pre-deploy-check.sh [--skip-tsc]
#
# Exits non-zero on FAIL. Safe to run on VPS while sams-api is still online.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_TSC=0
for arg in "$@"; do
  [[ "$arg" == "--skip-tsc" ]] && SKIP_TSC=1
done

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ROOT/packages/backend/.env"

FAIL=0
pass() { echo "  OK  $1"; }
warn() { echo "  WARN  $1"; }
fail() { echo "  FAIL  $1"; FAIL=1; }

echo "==> SAMS pre-deploy checks ($(date -Iseconds))"

# nginx: remove stale .bak copies that duplicate limit_req_zone blocks
if [[ -d /etc/nginx/sites-enabled ]]; then
  while IFS= read -r -d '' bak; do
    echo "    Removing stale sites-enabled backup: $bak"
    sudo rm -f "$bak"
  done < <(sudo find /etc/nginx/sites-enabled -maxdepth 1 -name '*.bak' -type f -print0 2>/dev/null || true)
fi

if command -v nginx >/dev/null 2>&1; then
  if sudo nginx -t 2>&1; then
    pass "nginx -t"
  else
    fail "nginx -t failed — fix config before reload"
  fi
else
  warn "nginx not in PATH — skipping nginx -t"
fi

SSL_CERT="/etc/letsencrypt/live/smart-managment.com/fullchain.pem"
SSL_KEY="/etc/letsencrypt/live/smart-managment.com/privkey.pem"
if [[ -f "$SSL_CERT" && -f "$SSL_KEY" ]]; then
  pass "SSL certs present ($SSL_CERT)"
elif [[ -d /etc/letsencrypt ]]; then
  fail "SSL certs missing — run: sudo certbot certonly --nginx -d smart-managment.com -d app.smart-managment.com ..."
else
  warn "certbot path not found — skipping SSL file check (local dev)"
fi

REDIS_RAW="$(grep -E '^REDIS_URL=' "$ROOT/packages/backend/.env" 2>/dev/null | head -1 || true)"
while IFS= read -r f; do
  [[ -z "$f" || ! -f "$f" ]] && continue
  line="$(grep -E '^REDIS_URL=' "$f" 2>/dev/null | head -1 || true)"
  [[ -n "$line" ]] && REDIS_RAW="$line"
done < <(merged_env_secrets_paths)

if [[ -n "$REDIS_RAW" ]]; then
  raw_val="${REDIS_RAW#*=}"
  if [[ "${raw_val:0:1}" == '"' && "${raw_val: -1}" == '"' ]] || [[ "${raw_val:0:1}" == "'" && "${raw_val: -1}" == "'" ]]; then
    warn "REDIS_URL has wrapping quotes in env file — runtime strips them; remove quotes to avoid confusion"
  fi
  REDIS_MERGED="$(read_merged_env REDIS_URL)"
  if [[ -z "$REDIS_MERGED" ]]; then
    fail "REDIS_URL empty after merge"
  elif [[ "${REDIS_MERGED:0:1}" == '"' || "${REDIS_MERGED:0:1}" == "'" ]]; then
    fail "REDIS_URL still has quotes after merge — fix env files"
  else
    pass "REDIS_URL ok (no stray quotes)"
  fi
else
  warn "REDIS_URL not set — API may run without Redis cache"
fi

JWT_VAL="$(read_merged_env JWT_SECRET)"
JWT_REFRESH_VAL="$(read_merged_env JWT_REFRESH_SECRET)"
QR_VAL="$(read_merged_env QR_SECRET)"
LICENSE_VAL="$(read_merged_env LICENSE_SECRET)"
if is_weak_production_secret "$JWT_VAL"; then
  fail "JWT_SECRET missing or <64 chars — run: bash scripts/set-production-env.sh"
else
  pass "JWT_SECRET ok (64+ chars)"
fi
if is_weak_production_secret "$JWT_REFRESH_VAL"; then
  fail "JWT_REFRESH_SECRET missing or <64 chars — run: bash scripts/set-production-env.sh"
else
  pass "JWT_REFRESH_SECRET ok (64+ chars)"
fi
if is_weak_production_secret "$QR_VAL"; then
  fail "QR_SECRET missing or <64 chars — run: bash scripts/set-production-env.sh"
else
  pass "QR_SECRET ok (64+ chars)"
fi
if is_weak_production_secret "$LICENSE_VAL"; then
  fail "LICENSE_SECRET missing or <64 chars — run: bash scripts/set-production-env.sh"
else
  pass "LICENSE_SECRET ok (64+ chars)"
fi

[[ -n "$(read_merged_env DATABASE_URL)" ]] && pass "DATABASE_URL set" || fail "DATABASE_URL missing"

if [[ -f "$ROOT/packages/backend/dist/index.js" ]]; then
  pass "Backend dist present"
else
  fail "Missing packages/backend/dist/index.js — build before restarting PM2"
fi

if [[ "$SKIP_TSC" -eq 0 ]]; then
  echo "    Running backend tsc --noEmit..."
  if npm run lint -w @sams/backend >/dev/null 2>&1; then
    pass "Backend TypeScript (tsc --noEmit)"
  else
    fail "Backend TypeScript check failed — run: npm run lint -w @sams/backend"
  fi
fi

if [[ -d "$ROOT/packages/backend/prisma/migrations" ]]; then
  echo "    Checking prisma migrate status..."
  migrate_out=""
  if migrate_out="$(cd "$ROOT/packages/backend" && npx prisma migrate status 2>&1)"; then
    if echo "$migrate_out" | grep -qiE 'following migration.*have not yet been applied|Database schema is not up to date'; then
      warn "Pending migrations — deploy will run prisma migrate deploy"
    else
      pass "Prisma migrate status"
    fi
  else
    fail "prisma migrate status failed — check DATABASE_URL and Postgres"
    echo "$migrate_out" | sed 's/^/       /' >&2
  fi
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "==> Pre-deploy checks passed"
  exit 0
fi
echo "==> Pre-deploy checks FAILED — fix items above before restarting sams-api"
exit 1
