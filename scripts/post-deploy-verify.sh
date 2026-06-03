#!/usr/bin/env bash
# Post-deploy smoke checks for SAMS VPS.
# Usage: bash scripts/post-deploy-verify.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HEALTH_WAIT_LIB="$ROOT/scripts/lib/health-wait.sh"
if [[ ! -f "$HEALTH_WAIT_LIB" ]]; then
  echo "ERROR: Missing $HEALTH_WAIT_LIB" >&2
  exit 1
fi
# shellcheck source=scripts/lib/health-wait.sh
source "$HEALTH_WAIT_LIB"
if ! declare -F health_diagnose_connection_refused >/dev/null 2>&1; then
  echo "ERROR: $HEALTH_WAIT_LIB did not define health_diagnose_connection_refused — pull latest main" >&2
  exit 1
fi

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ROOT/packages/backend/.env"

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
  warn "Node $(node -v) — SAMS requires Node 20+; run: bash scripts/upgrade-node20.sh (see DOCUMENTATION.md §9)"
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

# Health API — retry until HTTP 200 (503 = still starting or DB/Redis down)
HEALTH=""
if wait_for_health_200 "$API" 30 2; then
  HEALTH="$(curl -sS --max-time 5 "${API}/health" 2>/dev/null || true)"
fi

if [[ -n "$HEALTH" ]]; then
  pass "GET /health"
  echo "$HEALTH" | node -e "
    const h=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const db=h.checks?.database ?? h.status;
    const redis=h.checks?.redis;
    if(db===true||h.status==='ok') console.log('       database: ok');
    else console.log('       database: FAIL');
    if(redis===true) console.log('       redis: ok');
    else if(redis===false) console.log('       redis: FAIL');
    if(h.sms) {
      const mode=h.sms.mode||(h.sms.sandbox?'sandbox':'production');
      console.log('       sms:', h.sms.configured ? mode : 'not configured');
    }
    else console.log('       sms: unknown (stale backend — rm -rf packages/backend/dist && redeploy)');
    if(h.otp) console.log('       otp login:', h.otp.loginEnabled, '| reset:', h.otp.passwordResetEnabled);
    if(h.ai) {
      const ai=h.ai;
      if(ai.configured) console.log('       ai: configured | model:', ai.model||'(unknown)');
      else console.log('       ai: not configured (set OPENAI_* in secrets/providers.env)');
      if(ai.fallbackKey) console.log('       ai: fallback key present');
      if(ai.modelMismatch) console.log('       ai: MODEL MISMATCH — fix OPENAI_MODEL vs provider URL');
    } else console.log('       ai: unknown (stale backend — redeploy)');
  " 2>/dev/null || true

  # AI config sanity (non-fatal unless model mismatch)
  AI_MISMATCH="$(echo "$HEALTH" | node -e "try{const h=JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(h.ai?.modelMismatch?1:0)}catch{process.exit(0)}" 2>/dev/null && echo 0 || echo 1)"
  if [[ "${AI_MISMATCH:-0}" == "1" ]]; then
    fail "AI model/provider mismatch — run: bash scripts/verify-secrets.sh --ai-only"
  fi
  AI_OK="$(echo "$HEALTH" | node -e "try{const h=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(h.ai?.configured?'1':'0')}catch{process.stdout.write('0')}" 2>/dev/null || echo 0)"
  if [[ "${AI_OK:-0}" != "1" ]]; then
    warn "AI not configured — chat will fail until OPENAI_* is set in secrets/providers.env"
  else
    pass "AI configured (see /health ai block)"
  fi

  SMS_SANDBOX="$(echo "$HEALTH" | node -e "try{const h=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(h.sms?.sandbox?'1':'0')}catch{process.stdout.write('0')}" 2>/dev/null || echo 0)"
  SMS_MODE="$(echo "$HEALTH" | node -e "try{const h=JSON.parse(require('fs').readFileSync(0,'utf8'));const s=h.sms||{};process.stdout.write(s.mode||(s.sandbox?'sandbox':s.configured?'production':''))}catch{process.stdout.write('')}" 2>/dev/null || echo "")"
  NODE_ENV_VAL="$(grep -E '^NODE_ENV=' "$ROOT/packages/backend/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\"' || true)"
  [[ -z "$NODE_ENV_VAL" && -f "$ROOT/secrets/providers.env" ]] && NODE_ENV_VAL="$(grep -E '^NODE_ENV=' "$ROOT/secrets/providers.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\"' || true)"
  if [[ "${NODE_ENV_VAL:-}" == "production" ]]; then
    if [[ "${SMS_SANDBOX:-0}" == "1" || "${SMS_MODE:-}" == "sandbox" ]]; then
      fail "SMS sandbox while NODE_ENV=production — run: bash scripts/configure-production-at.sh (mode 2)"
    elif [[ -n "${SMS_MODE:-}" && "${SMS_MODE:-}" != "production" ]]; then
      fail "SMS mode=${SMS_MODE} — expected production (configure AT in secrets/providers.env)"
    elif [[ "${SMS_MODE:-}" == "production" ]]; then
      pass "SMS mode=production"
    fi
  fi

  BIO_DIST="$ROOT/packages/backend/dist/routes/biometric.js"
  if [[ -f "$BIO_DIST" ]]; then
    if grep -q "'/match'" "$BIO_DIST" && grep -q "'/enroll'" "$BIO_DIST"; then
      pass "Biometric routes in backend dist"
    else
      fail "Biometric routes missing from dist — rebuild backend"
    fi
  else
    warn "Biometric dist smoke skipped — build backend first"
  fi
else
  fail "GET /health — no HTTP 200 on ${API} (connection refused or 503 starting/degraded)"
  health_curl_verbose "$API"
  health_diagnose_connection_refused "$API"
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

# Optional guest AI smoke (uses provider quota — set VERIFY_AI_QUERY=1 to enable)
if [[ "${VERIFY_AI_QUERY:-}" == "1" ]]; then
  AI_CODE="$(curl -sS -o /tmp/sams-ai-verify.json -w "%{http_code}" --max-time 45 \
    -X POST "${API}/api/v1/ai/query" \
    -H "Content-Type: application/json" \
    -d '{"question":"Reply with exactly: ok"}' 2>/dev/null || echo "000")"
  if [[ "$AI_CODE" == "200" ]] && grep -qE 'answer|response|content' /tmp/sams-ai-verify.json 2>/dev/null; then
    pass "AI guest query smoke (HTTP 200)"
  else
    warn "AI guest query failed (HTTP ${AI_CODE}) — run: bash scripts/diagnose-ai.sh"
  fi
  rm -f /tmp/sams-ai-verify.json
else
  warn "Skipping AI query smoke — set VERIFY_AI_QUERY=1 to enable (uses API quota)"
fi

# Env file (merged: .env + secrets overlays)
if [[ -f "$ROOT/packages/backend/.env" ]]; then
  pass "packages/backend/.env exists"
  JWT_MERGED="$(read_merged_env JWT_SECRET)"
  NODE_ENV_MERGED="$(read_merged_env NODE_ENV)"
  NODE_ENV_MERGED="${NODE_ENV_MERGED:-production}"
  if is_weak_production_secret "$JWT_MERGED"; then
    if [[ "$NODE_ENV_MERGED" == "production" ]]; then
      fail "JWT_SECRET weak (<64 chars) — API crash-loop risk; run: bash scripts/set-production-env.sh"
    else
      warn "JWT_SECRET weak (<64 chars) — run set-production-env before NODE_ENV=production"
    fi
  else
    pass "JWT_SECRET ok (64+ chars, merged env)"
  fi
  [[ -n "$(read_merged_env DATABASE_URL)" ]] && pass "DATABASE_URL set" || fail "DATABASE_URL missing"
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
