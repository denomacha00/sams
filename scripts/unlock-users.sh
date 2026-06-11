#!/usr/bin/env bash
# Clear old locked/cooldown user states after switching SAMS to temporary login cooldowns.
#
# Usage:
#   cd /var/www/sams && bash scripts/unlock-users.sh
#   SCHOOL_CODE=ABC123 bash scripts/unlock-users.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/packages/backend/.env" ]]; then
  echo "ERROR: Missing packages/backend/.env" >&2
  exit 1
fi

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ROOT/packages/backend/.env"
source_merged_env

echo "==> Unlocking user accounts and clearing failed-login cooldown counters"
if [[ -n "${SCHOOL_CODE:-}" ]]; then
  echo "    Scope: SCHOOL_CODE=${SCHOOL_CODE}"
else
  echo "    Scope: all schools"
fi

npm run unlock-users --workspace @sams/backend

echo ""
echo "==> Done. Future bad logins use 15 attempts then a 1-minute wait, not a permanent block."
