#!/usr/bin/env bash
# Validate CONVERSATION_MASTER_KEY (+ optional PREVIOUS) for encrypted AI threads.
# Usage: bash scripts/check-conversation-keys.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ROOT/packages/backend/.env"

read_merged_env() {
  local key="$1"
  read_merged_env_value "$key" 2>/dev/null || true
}

ERR=0
CONV="$(read_merged_env CONVERSATION_MASTER_KEY)"
PREV="$(read_merged_env CONVERSATION_MASTER_KEY_PREVIOUS)"

echo "==> Conversation encryption keys"

if [[ -z "$CONV" || ${#CONV} -lt 32 ]]; then
  echo "WARN CONVERSATION_MASTER_KEY missing or <32 chars — encrypted chat memory disabled"
  ERR=1
else
  echo "OK   CONVERSATION_MASTER_KEY length ${#CONV} (32+ required)"
fi

if [[ -n "$PREV" ]]; then
  if [[ ${#PREV} -lt 32 ]]; then
    echo "WARN CONVERSATION_MASTER_KEY_PREVIOUS is <32 chars — old threads may not decrypt"
    ERR=1
  else
    echo "OK   CONVERSATION_MASTER_KEY_PREVIOUS set (rotation fallback)"
  fi
elif [[ -n "$CONV" && ${#CONV} -ge 32 ]]; then
  echo "INFO CONVERSATION_MASTER_KEY_PREVIOUS unset — required after key rotation until threads re-encrypt"
fi

if [[ -n "$CONV" && -n "$PREV" && "$CONV" == "$PREV" ]]; then
  echo "WARN Current and PREVIOUS keys are identical — remove PREVIOUS after migration"
fi

exit "$ERR"
