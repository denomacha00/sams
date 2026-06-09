#!/usr/bin/env bash
# Prepare a production VPS for app-only notifications while live SMS is not ready.
#
# This does not remove AT keys. It only disables features that require SMS:
#   - password reset OTP by SMS
#   - OTP login
#   - welcome SMS on registration
#
# When live Africa's Talking is ready, switch back with:
#   bash scripts/configure-production-at.sh
#
# Usage:
#   cd /var/www/sams && bash scripts/ready-app-only-production.sh
#   NO_RESTART=1 bash scripts/ready-app-only-production.sh
#   NO_VERIFY=1 bash scripts/ready-app-only-production.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/packages/backend/.env"
PROVIDERS_FILE="$ROOT/secrets/providers.env"
if [[ -d /var/www/sams && -f /var/www/sams/secrets/providers.env ]]; then
  PROVIDERS_FILE="/var/www/sams/secrets/providers.env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

mkdir -p "$(dirname "$PROVIDERS_FILE")"
if [[ ! -f "$PROVIDERS_FILE" ]]; then
  EXAMPLE="$ROOT/secrets/providers.env.example"
  if [[ -f "$EXAMPLE" ]]; then
    cp "$EXAMPLE" "$PROVIDERS_FILE"
  else
    touch "$PROVIDERS_FILE"
  fi
fi
chmod 600 "$PROVIDERS_FILE" 2>/dev/null || true
cp "$PROVIDERS_FILE" "${PROVIDERS_FILE}.bak.app-only.$(date +%Y%m%d%H%M%S)"

set_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$PROVIDERS_FILE"; then
    sed -i "s|^${key}=.*|${key}=\"${val}\"|" "$PROVIDERS_FILE"
  else
    printf '%s="%s"\n' "$key" "$val" >> "$PROVIDERS_FILE"
  fi
}

echo "==> SAMS app-only production mode"
echo "    Target file: $PROVIDERS_FILE"
echo "    Notifications remain in-app only. SMS-dependent features are disabled for now."

set_env OTP_PASSWORD_RESET_ENABLED false
set_env OTP_LOGIN_ENABLED false
set_env SMS_WELCOME_ON_REGISTER false

echo ""
echo "==> Applied:"
grep -E '^(OTP_PASSWORD_RESET_ENABLED|OTP_LOGIN_ENABLED|SMS_WELCOME_ON_REGISTER)=' "$PROVIDERS_FILE" || true

echo ""
echo "==> Important"
echo "    Forgot-password SMS is disabled in this mode."
echo "    Use admin password reset, or configure SMTP/live AT before relying on self-service reset."

if [[ "${NO_RESTART:-}" != "1" ]]; then
  if command -v pm2 >/dev/null 2>&1; then
    echo ""
    echo "==> Restarting API"
    bash "$ROOT/scripts/restart-api.sh"
  else
    echo ""
    echo "WARN: pm2 not found; restart skipped. Run: bash scripts/restart-api.sh"
  fi
fi

if [[ "${NO_VERIFY:-}" != "1" ]]; then
  echo ""
  echo "==> Verifying"
  bash "$ROOT/scripts/verify-secrets.sh"
  bash "$ROOT/scripts/post-deploy-verify.sh"
fi

echo ""
echo "==> Ready. Later, enable live SMS with: bash scripts/configure-production-at.sh"
