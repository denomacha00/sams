#!/usr/bin/env bash
# Pre-go-live gate for real schools: production SMS, biometric stack, built API.
# Usage: cd /var/www/sams && bash scripts/production-readiness-check.sh
#
# Exits non-zero on any FAIL. Run after secrets are set and before announcing go-live.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="${ROOT}/packages/backend/.env"

FAIL=0
pass() { echo "  OK  $1"; }
fail() { echo "  FAIL  $1"; FAIL=1; }

echo "==> SAMS production readiness ($(date -Iseconds))"

NODE_ENV="$(read_merged_env NODE_ENV)"
NODE_ENV="${NODE_ENV:-production}"
if [[ "$NODE_ENV" != "production" ]]; then
  fail "NODE_ENV=$NODE_ENV (expected production for real schools)"
else
  pass "NODE_ENV=production"
fi

AT_KEY="$(read_merged_env AT_API_KEY)"
AT_USER="$(read_merged_env AT_USERNAME)"
AT_USER="${AT_USER:-sandbox}"

if [[ -z "$AT_KEY" || "$AT_KEY" == *your-* ]]; then
  fail "AT_API_KEY not set — configure production Africa's Talking"
elif [[ "$AT_USER" == "sandbox" ]]; then
  fail "AT_USERNAME=sandbox — run: bash scripts/configure-production-at.sh (mode 2)"
else
  pass "Africa's Talking production (username=$AT_USER)"
fi

BIO_KEY="$(read_merged_env BIOMETRIC_MASTER_KEY)"
if [[ -z "$BIO_KEY" || ${#BIO_KEY} -lt 32 || "$BIO_KEY" == *change-me* ]]; then
  fail "BIOMETRIC_MASTER_KEY missing or too short — generate: openssl rand -base64 48"
else
  pass "BIOMETRIC_MASTER_KEY set"
fi

BIO_DIST="${ROOT}/packages/backend/dist/routes/biometric.js"
REG_DIST="${ROOT}/packages/backend/dist/registerApplication.js"
if [[ ! -f "$BIO_DIST" ]]; then
  fail "Missing $BIO_DIST — run deploy build"
elif ! grep -qE "('/match'|\"/match\")" "$BIO_DIST" || ! grep -qE "('/enroll'|\"/enroll\")" "$BIO_DIST"; then
  fail "Biometric match/enroll routes not found in dist"
else
  pass "Biometric routes compiled in dist"
fi

if [[ -f "$REG_DIST" ]] && grep -q "biometricRouter" "$REG_DIST"; then
  pass "Biometric router mounted in registerApplication dist"
else
  fail "biometricRouter not wired in dist — rebuild backend"
fi

JWT="$(read_merged_env JWT_SECRET)"
DB="$(read_merged_env DATABASE_URL)"
[[ -n "$JWT" && "$JWT" != *change-me* ]] && pass "JWT_SECRET set" || fail "JWT_SECRET missing"
[[ -n "$DB" ]] && pass "DATABASE_URL set" || fail "DATABASE_URL missing"

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "==> Production readiness passed"
  echo "    Also run: bash scripts/verify-secrets.sh && bash scripts/post-deploy-verify.sh"
  exit 0
fi
echo "==> Production readiness FAILED — fix items above before go-live"
exit 1
