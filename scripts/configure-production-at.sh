#!/usr/bin/env bash
# Guided Africa's Talking (SMS) setup for SAMS on the VPS.
# Does NOT contain or print real API keys — you paste values interactively or edit .env manually.
#
# Prerequisites:
#   - Africa's Talking account: https://account.africastalking.com
#   - For production: live app username + production API key + approved AT_SENDER_ID
#   - For sandbox: AT_USERNAME=sandbox + sandbox API key (often starts with atsk_)
#
# Usage:
#   cd /var/www/sams && bash scripts/configure-production-at.sh
#
# After changes:
#   pm2 reload ecosystem.config.js --env production
#   curl -s http://127.0.0.1:3001/health | jq '.sms,.otp'
#
# School admins verify in the app: Settings → SMS · Africa's Talking → Send test SMS

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/packages/backend/.env"
PROVIDERS_FILE="${ROOT}/secrets/providers.env"
if [[ -d /var/www/sams && -f /var/www/sams/secrets/providers.env ]]; then
  PROVIDERS_FILE="/var/www/sams/secrets/providers.env"
fi

# Prefer providers.env on VPS (overrides .env at runtime via pm2-start merge order).
TARGET_FILE="$ENV_FILE"
if [[ -f "$PROVIDERS_FILE" ]]; then
  TARGET_FILE="$PROVIDERS_FILE"
  echo "==> Writing AT_* to secrets overlay: $TARGET_FILE"
elif [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy from packages/backend/.env.example first." >&2
  exit 1
fi

NODE_ENV="$(grep -E '^NODE_ENV=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
if [[ -f "$PROVIDERS_FILE" ]]; then
  PE="$(grep -E '^NODE_ENV=' "$PROVIDERS_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
  [[ -n "$PE" ]] && NODE_ENV="$PE"
fi

cp "$TARGET_FILE" "${TARGET_FILE}.bak.$(date +%Y%m%d%H%M%S)"

set_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$TARGET_FILE"; then
    sed -i "s|^${key}=.*|${key}=\"${val}\"|" "$TARGET_FILE"
  else
    echo "${key}=\"${val}\"" >> "$TARGET_FILE"
  fi
}

read_env() {
  grep "^${1}=" "$TARGET_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true
}

echo "==> SAMS — Africa's Talking configuration"
echo "    Target file: $TARGET_FILE"
if [[ "$NODE_ENV" == "production" ]]; then
  echo "    NODE_ENV=production — sandbox SMS is NOT acceptable for live schools."
fi
echo ""
echo "Choose mode:"
echo "  1) Sandbox (dev only — AT_USERNAME=sandbox, whitelist numbers in AT dashboard)"
echo "  2) Production (live username + production API key + approved sender ID)"
read -r -p "Enter 1 or 2 [2]: " MODE
if [[ "$NODE_ENV" == "production" ]]; then
  MODE="${MODE:-2}"
else
  MODE="${MODE:-1}"
fi

if [[ "$MODE" == "1" && "$NODE_ENV" == "production" ]]; then
  echo "ERROR: Refusing sandbox AT while NODE_ENV=production. Choose mode 2 or change NODE_ENV." >&2
  exit 1
fi

if [[ "$MODE" == "2" ]]; then
  echo ""
  echo "Production checklist:"
  echo "  - Create/get production API key in AT dashboard (not the sandbox atsk_ key)"
  echo "  - Set AT_USERNAME to your live application username (NOT the word 'sandbox')"
  echo "  - Request sender ID approval for AT_SENDER_ID (default: SAMS)"
  echo "  - Top up SMS balance on Africa's Talking"
  echo ""
  read -r -p "AT_USERNAME (live app username): " AT_USER
  read -r -s -p "AT_API_KEY (hidden): " AT_KEY
  echo ""
  read -r -p "AT_SENDER_ID [SAMS]: " AT_SENDER
  AT_SENDER="${AT_SENDER:-SAMS}"
  set_env AT_USERNAME "$AT_USER"
  set_env AT_API_KEY "$AT_KEY"
  set_env AT_SENDER_ID "$AT_SENDER"
  set_env OTP_PASSWORD_RESET_ENABLED true
  echo ""
  read -r -p "Enable OTP login (password + SMS/email code)? Usually keep false until tested [y/N]: " OTP_LOGIN
  if [[ "${OTP_LOGIN,,}" == "y" ]]; then
    set_env OTP_LOGIN_ENABLED true
  else
    set_env OTP_LOGIN_ENABLED false
  fi
else
  echo ""
  echo "Sandbox: SMS only delivers to numbers you add at:"
  echo "  account.africastalking.com → SMS → phone numbers"
  echo ""
  read -r -s -p "AT_API_KEY (sandbox, hidden): " AT_KEY
  echo ""
  set_env AT_USERNAME sandbox
  set_env AT_API_KEY "$AT_KEY"
  set_env AT_SENDER_ID SAMS
  set_env OTP_PASSWORD_RESET_ENABLED true
  set_env OTP_LOGIN_ENABLED false
fi

# Optional welcome SMS when users register or add a phone
WELCOME="$(read_env SMS_WELCOME_ON_REGISTER)"
if [[ -z "$WELCOME" ]]; then
  set_env SMS_WELCOME_ON_REGISTER true
fi

echo ""
echo "==> Applied (secrets not shown):"
grep -E '^(AT_USERNAME|AT_SENDER_ID|OTP_|SMS_WELCOME)=' "$TARGET_FILE" | sed 's/AT_API_KEY=.*/AT_API_KEY="***"/'
echo ""
echo "==> Verify (must show production AT, not sandbox):"
echo "    bash scripts/verify-secrets.sh"
echo "    bash scripts/production-readiness-check.sh"
echo ""
echo "==> Reload PM2 and check health"
cd "$ROOT"
pm2 reload ecosystem.config.js --env production
sleep 2
curl -s "http://127.0.0.1:${PORT:-3001}/health" || true
echo ""
echo "==> Next: sign in as school admin → Settings → send test SMS to a whitelisted (sandbox) or any (production) number."
