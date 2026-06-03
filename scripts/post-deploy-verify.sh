#!/usr/bin/env bash
# Post-deploy smoke checks for SAMS VPS.
# Usage: bash scripts/post-deploy-verify.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
API="http://127.0.0.1:${PORT}"
FAIL=0

pass() { echo "  OK  $1"; }
warn() { echo "  WARN  $1"; }
fail() { echo "  FAIL  $1"; FAIL=1; }

echo "==> SAMS post-deploy verification ($(date -Iseconds))"

# Node version
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -ge 20 ]]; then
  pass "Node $(node -v)"
else
  warn "Node $(node -v) — project recommends Node 20+"
fi

# Build artifacts
[[ -f "$ROOT/packages/backend/dist/index.js" ]] && pass "Backend dist" || fail "Missing packages/backend/dist/index.js"
[[ -f "$ROOT/packages/frontend/dist/index.html" ]] && pass "Frontend dist" || fail "Missing frontend dist"
[[ -f "$ROOT/packages/super-admin/dist/index.html" ]] && pass "Super-admin dist" || fail "Missing super-admin dist"
[[ -f "$ROOT/DOCUMENTATION.md" ]] && pass "DOCUMENTATION.md (AI context)" || warn "DOCUMENTATION.md missing — AI doc context may be empty"

# PM2
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe sams-api >/dev/null 2>&1; then
    ONLINE="$(pm2 jlist 2>/dev/null | node -e "let n=0;try{const a=JSON.parse(require('fs').readFileSync(0,'utf8'));a.filter(p=>p.name==='sams-api'&&p.pm2_env.status==='online').forEach(()=>n++);}catch{}console.log(n)" 2>/dev/null || echo 0)"
    if [[ "${ONLINE:-0}" -ge 1 ]]; then
      pass "PM2 sams-api online (${ONLINE} instance(s))"
    else
      fail "PM2 sams-api not online"
    fi
  else
    fail "PM2 process sams-api not found"
  fi
else
  warn "pm2 not in PATH — skipping process check"
fi

# Health API
if HEALTH="$(curl -sf --max-time 10 "${API}/health" 2>/dev/null)"; then
  pass "GET /health"
  echo "$HEALTH" | node -e "
    const h=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const db=h.checks?.database ?? h.status;
    const redis=h.checks?.redis;
    if(db===true||h.status==='ok') console.log('       database: ok');
    else console.log('       database: FAIL');
    if(redis===true) console.log('       redis: ok');
    else if(redis===false) console.log('       redis: FAIL');
    if(h.sms) console.log('       sms:', h.sms.configured ? (h.sms.sandbox?'sandbox':'production') : 'not configured');
    if(h.otp) console.log('       otp login:', h.otp.loginEnabled, '| reset:', h.otp.passwordResetEnabled);
  " 2>/dev/null || true
else
  fail "GET /health — API not responding on ${API}"
fi

# Auth login (optional — set VERIFY_LOGIN_IDENTIFIER + VERIFY_LOGIN_PASSWORD in env)
if [[ -n "${VERIFY_LOGIN_IDENTIFIER:-}" && -n "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  LOGIN_CODE="$(curl -s -o /tmp/sams-login.json -w "%{http_code}" -X POST "${API}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"identifier\":\"${VERIFY_LOGIN_IDENTIFIER}\",\"password\":\"${VERIFY_LOGIN_PASSWORD}\"}")"
  if [[ "$LOGIN_CODE" == "200" ]] && grep -q accessToken /tmp/sams-login.json 2>/dev/null; then
    pass "Login test (${VERIFY_LOGIN_IDENTIFIER})"
  else
    fail "Login test failed (HTTP ${LOGIN_CODE})"
  fi
  rm -f /tmp/sams-login.json
else
  warn "Skipping login test — set VERIFY_LOGIN_IDENTIFIER and VERIFY_LOGIN_PASSWORD to enable"
fi

# Env file
if [[ -f "$ROOT/packages/backend/.env" ]]; then
  pass "packages/backend/.env exists"
  grep -q '^JWT_SECRET=' "$ROOT/packages/backend/.env" && pass "JWT_SECRET set" || warn "JWT_SECRET missing"
  grep -q '^DATABASE_URL=' "$ROOT/packages/backend/.env" && pass "DATABASE_URL set" || fail "DATABASE_URL missing"
else
  fail "packages/backend/.env missing"
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "==> All critical checks passed"
  exit 0
else
  echo "==> Some checks failed — review output above"
  exit 1
fi
