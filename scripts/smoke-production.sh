#!/usr/bin/env bash
# Lightweight production smoke curls (run on VPS as deploy user).
# Usage:
#   cd /var/www/sams && bash scripts/smoke-production.sh
#   VERIFY_AI_QUERY=1 bash scripts/smoke-production.sh
#   VERIFY_LOGIN_IDENTIFIER=admin@school.com VERIFY_LOGIN_PASSWORD='***' bash scripts/smoke-production.sh
#
# See scripts/smoke-role-checks.md for role-specific UI checks.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
API="http://127.0.0.1:${PORT}"
PUBLIC_APP="${PUBLIC_APP_URL:-https://app.smart-managment.com}"

echo "==> SAMS production smoke ($(date -Iseconds))"
echo "    API: ${API}"
echo "    App: ${PUBLIC_APP}"
echo ""

echo "==> 1) Secrets reminder (no values printed)"
echo "    Run before/after env edits:"
echo "      bash scripts/backup-secrets.sh"
echo "      bash scripts/verify-secrets.sh"
echo "      bash scripts/verify-secrets.sh --ai-only"
echo ""

echo "==> 2) GET /health"
curl -sS --max-time 10 "${API}/health" | node -e "
  const h=JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('    status:', h.status);
  console.log('    database:', h.checks?.database);
  console.log('    redis:', h.checks?.redis);
  if(h.sms) console.log('    sms:', h.sms.configured ? (h.sms.sandbox?'sandbox':'production AT') : 'off');
  if(h.ai) console.log('    ai:', h.ai.configured ? 'configured' : 'off', '| model:', h.ai.model||'-', h.ai.modelMismatch?'| MISMATCH':'');
  if(h.otp) console.log('    otp:', 'login', h.otp.loginEnabled, '| reset', h.otp.passwordResetEnabled);
" 2>/dev/null || { curl -sS --max-time 10 "${API}/health"; echo; }
echo ""

if [[ "${VERIFY_AI_QUERY:-}" == "1" ]]; then
  echo "==> 3) POST /api/v1/ai/query (guest ping)"
  CODE="$(curl -sS -o /tmp/sams-smoke-ai.json -w '%{http_code}' --max-time 45 \
    -X POST "${API}/api/v1/ai/query" \
    -H 'Content-Type: application/json' \
    -d '{"question":"Reply with exactly: ok"}' || echo 000)"
  echo "    HTTP ${CODE}"
  head -c 400 /tmp/sams-smoke-ai.json 2>/dev/null && echo ""
  rm -f /tmp/sams-smoke-ai.json
  echo ""
else
  echo "==> 3) AI query smoke skipped (set VERIFY_AI_QUERY=1)"
  echo ""
fi

if [[ -n "${VERIFY_LOGIN_IDENTIFIER:-}" && -n "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  echo "==> 4) Login + authenticated /api/v1/users/me"
  LOGIN_CODE="$(curl -sS -o /tmp/sams-smoke-login.json -w '%{http_code}' \
    -X POST "${API}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"identifier\":\"${VERIFY_LOGIN_IDENTIFIER}\",\"password\":\"${VERIFY_LOGIN_PASSWORD}\"}" || echo 000)"
  TOKEN="$(node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/sams-smoke-login.json','utf8'));console.log(j.accessToken||'')" 2>/dev/null || true)"
  echo "    login HTTP ${LOGIN_CODE}"
  if [[ -n "$TOKEN" ]]; then
    ME_CODE="$(curl -sS -o /tmp/sams-smoke-me.json -w '%{http_code}' \
      -H "Authorization: Bearer ${TOKEN}" \
      "${API}/api/v1/users/me" || echo 000)"
    echo "    GET /users/me HTTP ${ME_CODE}"
    node -e "const u=JSON.parse(require('fs').readFileSync('/tmp/sams-smoke-me.json','utf8'));console.log('    role:', u.role||u.user?.role||'(unknown)')" 2>/dev/null || true
  fi
  rm -f /tmp/sams-smoke-login.json /tmp/sams-smoke-me.json
  echo ""
else
  echo "==> 4) Authenticated smoke skipped"
  echo "    Set VERIFY_LOGIN_IDENTIFIER + VERIFY_LOGIN_PASSWORD for token checks"
  echo ""
fi

echo "==> 5) Browser checks (by role)"
echo "    SCHOOL_ADMIN: ${PUBLIC_APP} → login → Settings → SMS test"
echo "    TEACHER: mark attendance / view class"
echo "    CLASS_REP (student flag): roster + reply to teacher messages"
echo "    SUPER_ADMIN: https://super.smart-managment.com (school code SUPERADMIN)"
echo ""
echo "==> Done. Full verify: bash scripts/post-deploy-verify.sh"
