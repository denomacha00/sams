#!/usr/bin/env bash
# Shared helpers: read effective env after .env + optional secrets overlays.
# Secrets files are never modified by deploy scripts.

# shellcheck disable=SC2034
MERGED_ENV_ROOT="${MERGED_ENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
MERGED_ENV_FILE="${MERGED_ENV_FILE:-${MERGED_ENV_ROOT}/packages/backend/.env}"

merged_env_secrets_paths() {
  local root="${MERGED_ENV_ROOT}"
  printf '%s\n' \
    "${root}/packages/backend/.env.secrets" \
    "${root}/secrets/providers.env" \
    "/var/www/sams/secrets/providers.env" \
    "${root}/secrets/ai.env" \
    "/var/www/sams/secrets/ai.env"
}

# Read key from .env then overlay secrets files (later files win).
read_merged_env() {
  local key="$1"
  local val="" line f
  if [[ -f "$MERGED_ENV_FILE" ]]; then
    line="$(grep "^${key}=" "$MERGED_ENV_FILE" 2>/dev/null | head -1 || true)"
    if [[ -n "$line" ]]; then
      val="${line#*=}"
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
    fi
  fi
  while IFS= read -r f; do
    [[ -z "$f" || ! -f "$f" ]] && continue
    line="$(grep "^${key}=" "$f" 2>/dev/null | head -1 || true)"
    if [[ -n "$line" ]]; then
      val="${line#*=}"
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
    fi
  done < <(merged_env_secrets_paths)
  printf '%s' "$val"
}

# Source .env then secrets for PM2 shell (same order as load-env-from-file.js).
source_merged_env() {
  local f
  if [[ -f "$MERGED_ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$MERGED_ENV_FILE"
    set +a
  fi
  while IFS= read -r f; do
    [[ -z "$f" || ! -f "$f" ]] && continue
    set -a
    # shellcheck disable=SC1090
    source "$f"
    set +a
  done < <(merged_env_secrets_paths)
}
