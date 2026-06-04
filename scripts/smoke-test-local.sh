#!/usr/bin/env bash
# Local dev smoke — API must be running (default PORT=3001).
# Usage:
#   npm run dev -w @sams/backend   # in another terminal
#   bash scripts/smoke-test-local.sh
#   VERIFY_LOGIN_IDENTIFIER=teacher@school.com VERIFY_LOGIN_PASSWORD='***' bash scripts/smoke-test-local.sh
#
# Full VPS gate after deploy: bash scripts/post-deploy-verify.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
API="http://127.0.0.1:${PORT}"
FAIL=0

pass() { echo "  OK  $1"; }
warn() { echo "  WARN  $1"; }
fail() { echo "  FAIL  $1"; FAIL=1; }

echo "==> SAMS local smoke ($(date -Iseconds))"
echo "    API: ${API}"
echo ""

# Health
HEALTH_CODE="$(curl -sS -o /tmp/sams-local-health.json -w '%{http_code}' --max-time 5 "${API}/health" 2>/dev/null || echo 000)"
if [[ "$HEALTH_CODE" == "200" ]]; then
  pass "GET /health (HTTP 200)"
  node -e "
    const h=JSON.parse(require('fs').readFileSync('/tmp/sams-local-health.json','utf8'));
    const db=h.checks?.database ?? h.status;
    console.log('       status:', h.status);
    console.log('       database:', db === true || h.status === 'ok' ? 'ok' : db);
    if (h.checks?.redis !== undefined) console.log('       redis:', h.checks.redis ? 'ok' : 'FAIL');
    if (h.ai) console.log('       ai:', h.ai.configured ? 'configured' : 'off');
  " 2>/dev/null || true
else
  fail "GET /health (HTTP ${HEALTH_CODE}) — start backend: npm run dev -w @sams/backend"
fi
rm -f /tmp/sams-local-health.json

# Public AI route (no JWT) — expect 400/401/200 depending on body; must not 404
AI_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "${API}/api/v1/ai/query" \
  -H 'Content-Type: application/json' \
  -d '{}' 2>/dev/null || echo 000)"
if [[ "$AI_CODE" != "404" && "$AI_CODE" != "000" ]]; then
  pass "POST /api/v1/ai/query reachable (HTTP ${AI_CODE})"
else
  fail "POST /api/v1/ai/query (HTTP ${AI_CODE})"
fi

# Auth login without creds — expect 400/401, not 404
LOGIN_EMPTY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "${API}/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{}' 2>/dev/null || echo 000)"
if [[ "$LOGIN_EMPTY" != "404" && "$LOGIN_EMPTY" != "000" ]]; then
  pass "POST /api/v1/auth/login reachable (HTTP ${LOGIN_EMPTY})"
else
  fail "POST /api/v1/auth/login (HTTP ${LOGIN_EMPTY})"
fi

# Forgot-password OTP — invalid school: 404, not 500
FP_OTP_CODE="$(curl -sS -o /tmp/sams-fp-otp.json -w '%{http_code}' --max-time 10 \
  -X POST "${API}/api/v1/auth/forgot-password-otp" \
  -H 'Content-Type: application/json' \
  -d '{"schoolCode":"ZZZNOSCHOOL","identifier":"nobody@example.com"}' 2>/dev/null || echo 000)"
if [[ "$FP_OTP_CODE" == "404" || "$FP_OTP_CODE" == "400" || "$FP_OTP_CODE" == "503" ]]; then
  pass "POST /api/v1/auth/forgot-password-otp structured response (HTTP ${FP_OTP_CODE})"
elif [[ "$FP_OTP_CODE" == "500" ]]; then
  fail "POST /api/v1/auth/forgot-password-otp returned HTTP 500"
else
  warn "POST /api/v1/auth/forgot-password-otp HTTP ${FP_OTP_CODE} (404/503 expected when OTP off or school missing)"
fi
rm -f /tmp/sams-fp-otp.json

# Forgot-password link — validation error, not 500
FP_LINK_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "${API}/api/v1/auth/forgot-password" \
  -H 'Content-Type: application/json' \
  -d '{"schoolCode":"AB","identifier":"x"}' 2>/dev/null || echo 000)"
if [[ "$FP_LINK_CODE" != "500" && "$FP_LINK_CODE" != "000" ]]; then
  pass "POST /api/v1/auth/forgot-password reachable (HTTP ${FP_LINK_CODE})"
else
  fail "POST /api/v1/auth/forgot-password (HTTP ${FP_LINK_CODE})"
fi

# Forgot-password with valid-shaped body — expect 404/503/200, never opaque 500 (SMTP off → EMAIL_NOT_CONFIGURED)
FP_BODY_CODE="$(curl -sS -o /tmp/sams-fp-body.json -w '%{http_code}' --max-time 10 \
  -X POST "${API}/api/v1/auth/forgot-password" \
  -H 'Content-Type: application/json' \
  -d '{"schoolCode":"ZZZNOSCHOOL","identifier":"nobody@example.com"}' 2>/dev/null || echo 000)"
if [[ "$FP_BODY_CODE" == "500" ]]; then
  fail "POST /api/v1/auth/forgot-password returned HTTP 500"
elif [[ "$FP_BODY_CODE" != "000" ]]; then
  pass "POST /api/v1/auth/forgot-password structured (HTTP ${FP_BODY_CODE})"
  if [[ "$FP_BODY_CODE" == "503" ]]; then
    node -e "
      const j=JSON.parse(require('fs').readFileSync('/tmp/sams-fp-body.json','utf8'));
      if (j.code === 'EMAIL_NOT_CONFIGURED') console.log('       code: EMAIL_NOT_CONFIGURED (SMTP off — expected)');
    " 2>/dev/null || true
  fi
else
  fail "POST /api/v1/auth/forgot-password unreachable"
fi
rm -f /tmp/sams-fp-body.json

# Optional authenticated smoke
if [[ -n "${VERIFY_LOGIN_IDENTIFIER:-}" && -n "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  LOGIN_CODE="$(curl -sS -o /tmp/sams-local-login.json -w '%{http_code}' --max-time 15 \
    -X POST "${API}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"identifier\":\"${VERIFY_LOGIN_IDENTIFIER}\",\"password\":\"${VERIFY_LOGIN_PASSWORD}\"}" 2>/dev/null || echo 000)"
  TOKEN="$(node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/sams-local-login.json','utf8'));console.log(j.accessToken||'')" 2>/dev/null || true)"
  if [[ "$LOGIN_CODE" == "200" && -n "$TOKEN" ]]; then
    pass "Login (${VERIFY_LOGIN_IDENTIFIER})"
    ME_CODE="$(curl -sS -o /tmp/sams-local-me.json -w '%{http_code}' --max-time 10 \
      -H "Authorization: Bearer ${TOKEN}" \
      "${API}/api/v1/users/me" 2>/dev/null || echo 000)"
    if [[ "$ME_CODE" == "200" ]]; then
      pass "GET /api/v1/users/me"
      node -e "const u=JSON.parse(require('fs').readFileSync('/tmp/sams-local-me.json','utf8'));console.log('       role:', u.role||u.user?.role||'(unknown)')" 2>/dev/null || true
    else
      fail "GET /api/v1/users/me (HTTP ${ME_CODE})"
    fi
    TT_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
      -H "Authorization: Bearer ${TOKEN}" \
      "${API}/api/v1/timetable" 2>/dev/null || echo 000)"
    if [[ "$TT_CODE" == "200" ]]; then
      pass "GET /api/v1/timetable (scoped list)"
    else
      warn "GET /api/v1/timetable HTTP ${TT_CODE} (role may lack view:timetable)"
    fi
    SESS_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
      -H "Authorization: Bearer ${TOKEN}" \
      "${API}/api/v1/sessions?isActive=true" 2>/dev/null || echo 000)"
    if [[ "$SESS_CODE" == "200" ]]; then
      pass "GET /api/v1/sessions?isActive=true"
    else
      warn "GET /api/v1/sessions?isActive=true HTTP ${SESS_CODE} (role may lack start:session)"
    fi
  else
    fail "Login failed (HTTP ${LOGIN_CODE})"
  fi
  rm -f /tmp/sams-local-login.json /tmp/sams-local-me.json
else
  warn "Skipping authenticated checks — set VERIFY_LOGIN_IDENTIFIER + VERIFY_LOGIN_PASSWORD"
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "==> Local smoke passed"
  echo "    UI: npm run dev -w @sams/frontend — see scripts/smoke-ui-checklist.md"
  exit 0
else
  echo "==> Local smoke failed"
  exit 1
fi
