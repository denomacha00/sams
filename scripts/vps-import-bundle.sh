#!/usr/bin/env bash
# Master VPS import: full deploy + attendance smoke. Run after git pull on a configured server.
#
# One-liner (from repo root on VPS):
#   cd /var/www/sams && git pull origin main && bash scripts/vps-import-bundle.sh
#
# Fresh VPS still needs: packages/backend/.env, secrets/providers.env, Postgres, Redis, nginx, PM2.
# This script does not create secrets — see docs/VPS-SCRIPTS.md

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> SAMS VPS import bundle ($(date -Iseconds))"
echo ""
echo "    Run anytime after git pull:"
echo "      cd /var/www/sams && git pull origin main && bash scripts/vps-import-bundle.sh"
echo ""

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ROOT/packages/backend/.env"

VERIFY_ID="$(read_merged_env VERIFY_LOGIN_IDENTIFIER)"
VERIFY_PW="$(read_merged_env VERIFY_LOGIN_PASSWORD)"

echo "==> Step 1: full deploy"
SAMS_ROOT="${SAMS_ROOT:-/var/www/sams}" bash "$ROOT/scripts/vps-full-deploy.sh"

echo ""
echo "==> Step 2: attendance / biometric smoke"
bash "$ROOT/scripts/vps-attendance-smoke.sh"

echo ""
echo "==> Interactive setup still recommended if missing:"
NEED=()
[[ -z "$VERIFY_ID" || -z "$VERIFY_PW" ]] && NEED+=("VERIFY_LOGIN_* — bash scripts/vps-setup-verify-login.sh")
[[ ! -f "$ROOT/packages/backend/.env" ]] && NEED+=("packages/backend/.env — copy from backup or set-production-env.sh")
[[ ! -f "$ROOT/secrets/providers.env" ]] && NEED+=("secrets/providers.env — AI/SMS/SMTP keys (never commit)")
if [[ ${#NEED[@]} -eq 0 ]]; then
  echo "    (none — verify login creds already set)"
else
  for item in "${NEED[@]}"; do
    echo "    • $item"
  done
fi

echo ""
echo "==> Import bundle finished"