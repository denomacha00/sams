#!/usr/bin/env bash
# Apply production-safe defaults to packages/backend/.env on the VPS.
# Generates JWT/QR/license secrets automatically if not already set to real values.
#
# Africa's Talking (SMS): use scripts/configure-production-at.sh for guided AT setup.
# Sandbox is detected when AT_USERNAME=sandbox (there is no separate AT_SANDBOX env var).
#
# Provider secrets (AI, AT, SMTP, M-Pesa, etc.): this script does NOT overwrite keys in
# secrets/providers.env or .env.secrets. Verify merged env: bash scripts/verify-secrets.sh
#
# Usage: bash scripts/set-production-env.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/packages/backend/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"

set_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=\"${val}\"|" "$ENV_FILE"
  else
    echo "${key}=\"${val}\"" >> "$ENV_FILE"
  fi
}

# Matches packages/backend/src/config/secrets.ts (64+ chars in production).
is_placeholder_secret() {
  local val="$1"
  [[ -z "$val" ]] && return 0
  [[ ${#val} -lt 64 ]] && return 0
  [[ "$val" == *change-me* ]] && return 0
  [[ "$val" == *qr-secret-dev* ]] && return 0
  [[ "$val" == *default-license-secret* ]] && return 0
  return 1
}

read_env() {
  grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true
}

gen_secret() { openssl rand -hex 32; }

JWT_SECRET="$(read_env JWT_SECRET)"
JWT_REFRESH_SECRET="$(read_env JWT_REFRESH_SECRET)"
QR_SECRET="$(read_env QR_SECRET)"
LICENSE_SECRET="$(read_env LICENSE_SECRET)"

if is_placeholder_secret "$JWT_SECRET"; then JWT_SECRET="$(gen_secret)"; fi
if is_placeholder_secret "$JWT_REFRESH_SECRET"; then JWT_REFRESH_SECRET="$(gen_secret)"; fi
if is_placeholder_secret "$QR_SECRET"; then QR_SECRET="$(gen_secret)"; fi
if is_placeholder_secret "$LICENSE_SECRET"; then LICENSE_SECRET="$(gen_secret)"; fi

set_env NODE_ENV production
set_env APP_URL "https://app.smart-managment.com"
set_env FRONTEND_URL "https://app.smart-managment.com"
set_env CORS_ORIGIN "https://app.smart-managment.com"
set_env OTP_LOGIN_ENABLED false

AT_KEY="$(read_env AT_API_KEY)"
if [[ -n "$AT_KEY" && "$AT_KEY" != "your-africastalking-api-key" ]]; then
  set_env OTP_PASSWORD_RESET_ENABLED true
  echo "    SMS key found — OTP password reset enabled"
else
  set_env OTP_PASSWORD_RESET_ENABLED false
  echo "    No AT_API_KEY — OTP password reset left disabled"
fi
set_env JWT_SECRET "$JWT_SECRET"
set_env JWT_REFRESH_SECRET "$JWT_REFRESH_SECRET"
set_env QR_SECRET "$QR_SECRET"
set_env LICENSE_SECRET "$LICENSE_SECRET"

echo "==> Production env applied to $ENV_FILE"
grep -E '^(NODE_ENV|APP_URL|FRONTEND_URL|CORS_ORIGIN|OTP_|JWT_|QR_SECRET|LICENSE_SECRET)=' "$ENV_FILE" \
  | sed -E 's/(JWT_(REFRESH_)?SECRET=).*/\1***masked***/' \
  | sed -E 's/(QR_SECRET=).*/\1***masked***/' \
  | sed -E 's/(LICENSE_SECRET=).*/\1***masked***/'

echo "==> Reload PM2"
cd "$ROOT"
mkdir -p /var/log/sams
# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ENV_FILE"
source_merged_env
pm2 delete sams-api 2>/dev/null || true
pm2 start ecosystem.config.js --env production --update-env

echo "==> Health"
sleep 2
curl -s "http://127.0.0.1:${PORT:-3001}/health" || true
echo ""
