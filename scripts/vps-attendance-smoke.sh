#!/usr/bin/env bash
# Attendance + biometric API smoke (production VPS).
#
# Required (on disk or exported):
#   None for critical checks (uses local API).
#
# Optional:
#   API_URL          — default http://127.0.0.1:${PORT:-3001}
#   PORT             — default 3001
#   VERIFY_LOGIN_IDENTIFIER / VERIFY_LOGIN_PASSWORD — login + sessions probe
#
# Usage:
#   cd /var/www/sams && bash scripts/vps-attendance-smoke.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ROOT/packages/backend/.env"

PORT="${PORT:-3001}"
API="${API_URL:-http://127.0.0.1:${PORT}}"
FAIL=0

pass() { echo "  OK  $1"; }
warn() { echo "  WARN  $1"; }
fail() { echo "  FAIL  $1"; FAIL=1; }

health_field() {
  local expr="$1"
  if command -v jq >/dev/null 2>&1; then
    echo "$HEALTH_BODY" | jq -r "$expr" 2>/dev/null || true
  else
    HEALTH_FIELD_EXPR="$expr" node -e "
const h=JSON.parse(process.env.HEALTH_BODY||'{}');
const e=process.env.HEALTH_FIELD_EXPR;
let v=h;
for (const p of e.replace(/^\./,'').split('.')) { if(!p) continue; v=v?.[p]; }
if (v===true||v===false) process.stdout.write(v?'true':'false');
else process.stdout.write(v==null?'':String(v));
" 2>/dev/null || true
  fi
}

echo "==> SAMS attendance / biometric smoke ($(date -Iseconds))"
echo "    API: $API"

if [[ -z "${VERIFY_LOGIN_IDENTIFIER:-}" ]]; then
  VERIFY_LOGIN_IDENTIFIER="$(read_merged_env VERIFY_LOGIN_IDENTIFIER)"
fi
if [[ -z "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  VERIFY_LOGIN_PASSWORD="$(read_merged_env VERIFY_LOGIN_PASSWORD)"
fi

HEALTH_CODE="$(curl -sS -o /tmp/sams-att-health.json -w '%{http_code}' --max-time 10 "${API}/health" 2>/dev/null || echo 000)"
HEALTH_BODY="$(cat /tmp/sams-att-health.json 2>/dev/null || true)"
rm -f /tmp/sams-att-health.json
export HEALTH_BODY

if [[ "$HEALTH_CODE" == "200" && -n "$HEALTH_BODY" ]]; then
  pass "GET /health (HTTP 200)"
  DB_OK="$(health_field .checks.database)"
  if [[ "$DB_OK" == "true" ]]; then
    pass "health.checks.database"
  else
    fail "health.checks.database not true"
  fi
else
  fail "GET /health (HTTP ${HEALTH_CODE})"
fi

BIO_DIST="$ROOT/packages/backend/dist/routes/biometric.js"
if [[ -f "$BIO_DIST" ]] && grep -q "'/match'" "$BIO_DIST" && grep -q "'/enroll'" "$BIO_DIST"; then
  pass "Biometric routes present in backend dist"
else
  fail "Biometric routes missing from dist — run deploy-production.sh"
fi

MATCH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "${API}/api/v1/biometric/match" \
  -H 'Content-Type: application/json' \
  -d '{"descriptor":[0.1]}' 2>/dev/null || echo 000)"
case "$MATCH_CODE" in
  400|401|403) pass "POST /api/v1/biometric/match reachable (HTTP ${MATCH_CODE})" ;;
  404) fail "POST /api/v1/biometric/match not found (HTTP 404)" ;;
  500|000) fail "POST /api/v1/biometric/match error (HTTP ${MATCH_CODE})" ;;
  *) pass "POST /api/v1/biometric/match responded (HTTP ${MATCH_CODE})" ;;
esac

ATT_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "${API}/api/v1/attendance/qr" \
  -H 'Content-Type: application/json' \
  -d '{}' 2>/dev/null || echo 000)"
case "$ATT_CODE" in
  400|401|403) pass "POST /api/v1/attendance/qr reachable (HTTP ${ATT_CODE})" ;;
  404) fail "POST /api/v1/attendance/qr not found (HTTP 404)" ;;
  500|000) fail "POST /api/v1/attendance/qr error (HTTP ${ATT_CODE})" ;;
  *) pass "POST /api/v1/attendance/qr responded (HTTP ${ATT_CODE})" ;;
esac

ATT_LIST_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  "${API}/api/v1/attendance/" 2>/dev/null || echo 000)"
case "$ATT_LIST_CODE" in
  401|403) pass "GET /api/v1/attendance reachable (HTTP ${ATT_LIST_CODE}, auth required)" ;;
  200) pass "GET /api/v1/attendance (HTTP 200)" ;;
  404) fail "GET /api/v1/attendance not found (HTTP 404)" ;;
  500|000) fail "GET /api/v1/attendance error (HTTP ${ATT_LIST_CODE})" ;;
  *) warn "GET /api/v1/attendance unexpected HTTP ${ATT_LIST_CODE}" ;;
esac

if [[ -n "${VERIFY_LOGIN_IDENTIFIER:-}" && -n "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  LOGIN_CODE="$(curl -sS -o /tmp/sams-att-login.json -w '%{http_code}' --max-time 15 \
    -X POST "${API}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"identifier\":\"${VERIFY_LOGIN_IDENTIFIER}\",\"password\":\"${VERIFY_LOGIN_PASSWORD}\"}" 2>/dev/null || echo 000)"
  if [[ "$LOGIN_CODE" == "200" ]] && grep -q accessToken /tmp/sams-att-login.json 2>/dev/null; then
    pass "Login smoke (${VERIFY_LOGIN_IDENTIFIER})"
    TOKEN="$(node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/sams-att-login.json','utf8'));process.stdout.write(j.accessToken||'')" 2>/dev/null || true)"
    if [[ -n "$TOKEN" ]]; then
      SESS_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
        -H "Authorization: Bearer ${TOKEN}" \
        "${API}/api/v1/sessions?isActive=true" 2>/dev/null || echo 000)"
      [[ "$SESS_CODE" == "200" ]] && pass "GET /api/v1/sessions?isActive=true" || warn "sessions HTTP ${SESS_CODE}"
    fi
  else
    warn "Login smoke failed (HTTP ${LOGIN_CODE})"
  fi
  rm -f /tmp/sams-att-login.json
else
  warn "Login smoke skipped — run: bash scripts/vps-setup-verify-login.sh"
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "==> Attendance / biometric smoke passed (critical checks)"
  exit 0
fi
echo "==> Attendance / biometric smoke FAILED"
exit 1