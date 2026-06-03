#!/usr/bin/env bash
# Backup third-party secrets from merged env to secrets/ (chmod 600). Run on VPS before risky edits.
#
# Usage:
#   cd /var/www/sams && bash scripts/backup-secrets.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
# shellcheck source=lib/provider-secret-keys.sh
source "$ROOT/scripts/lib/provider-secret-keys.sh"
MERGED_ENV_ROOT="$ROOT"

SECRETS_DIR="${ROOT}/secrets"
STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP="${SECRETS_DIR}/providers.env.backup.${STAMP}"

mkdir -p "$SECRETS_DIR"
umask 077

{
  echo "# SAMS provider secrets backup ${STAMP}"
  echo "# Restore: cp this file to secrets/providers.env or packages/backend/.env.secrets"
  echo ""
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    val="$(read_merged_env "$key")"
    [[ -n "$val" ]] && printf '%s="%s"\n' "$key" "$val"
  done < <(provider_secret_keys)
} >"$BACKUP"

chmod 600 "$BACKUP"

saved="$(grep -cE '^[A-Z_]+=' "$BACKUP" 2>/dev/null || echo 0)"
if [[ "$saved" -ge 1 ]]; then
  echo "==> Backed up ${saved} key(s) to $BACKUP"
  echo "    (values not printed — inspect with: sed -E 's/(KEY|PASS|SECRET)=.*/\\1***masked***/' $BACKUP)"
else
  echo "WARN: No provider secrets in merged env — nothing to save" >&2
  rm -f "$BACKUP"
  exit 1
fi
