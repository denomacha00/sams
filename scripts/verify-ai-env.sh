#!/usr/bin/env bash
# Verify AI provider env on the VPS without changing or printing secrets.
# Groq primary (OPENAI_*), optional OpenRouter fallback (OPENAI_FALLBACK_*).
#
# Usage:
#   cd /var/www/sams && bash scripts/verify-ai-env.sh
#
# Safe inspect (names + masked values only):
#   grep -E '^OPENAI_' packages/backend/.env | sed -E 's/(KEY=).*/\1***masked***/'

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/packages/backend/.env"

DEPRECATED_MODELS=(
  llama3-70b-8192
  llama3-8b-8192
  llama-3.1-70b-versatile
)

read_env() {
  grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

mask_line() {
  sed -E 's/(OPENAI_(API|FALLBACK)_KEY=).*/\1***masked***/' \
    | sed -E 's/(OPENAI_FALLBACK_KEY=).*/\1***masked***/'
}

is_real_key() {
  local val="$1"
  [[ -n "$val" ]] || return 1
  [[ "$val" == *your-* ]] && return 1
  [[ "$val" == gsk_your* ]] && return 1
  [[ "$val" == sk-or-v1-* ]] && return 1
  return 0
}

is_deprecated_model() {
  local model="$1"
  local d
  for d in "${DEPRECATED_MODELS[@]}"; do
    [[ "$model" == "$d" ]] && return 0
  done
  return 1
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

echo "==> AI env check: $ENV_FILE"
echo "    (secrets are never printed in full)"
echo ""

PRIMARY_KEY="$(read_env OPENAI_API_KEY)"
BASE_URL="$(read_env OPENAI_BASE_URL)"
MODEL="$(read_env OPENAI_MODEL)"
FALLBACK_KEY="$(read_env OPENAI_FALLBACK_KEY)"
FALLBACK_URL="$(read_env OPENAI_FALLBACK_URL)"
FALLBACK_MODEL="$(read_env OPENAI_FALLBACK_MODEL)"

ERR=0

if is_real_key "$PRIMARY_KEY"; then
  echo "OK   OPENAI_API_KEY is set"
else
  echo "FAIL OPENAI_API_KEY missing or placeholder — Groq key goes here (gsk_...)"
  ERR=1
fi

if [[ -n "$BASE_URL" ]]; then
  echo "OK   OPENAI_BASE_URL=$BASE_URL"
else
  echo "INFO OPENAI_BASE_URL unset — runtime default: https://api.groq.com/openai/v1"
fi

if [[ -n "$MODEL" ]]; then
  if is_deprecated_model "$MODEL"; then
    echo "WARN OPENAI_MODEL=$MODEL is decommissioned — set OPENAI_MODEL=llama-3.3-70b-versatile (Groq) without removing keys"
    ERR=1
  else
    echo "OK   OPENAI_MODEL=$MODEL"
  fi
else
  echo "INFO OPENAI_MODEL unset — runtime picks provider default (Groq: llama-3.3-70b-versatile)"
fi

if is_real_key "$FALLBACK_KEY"; then
  echo "OK   OPENAI_FALLBACK_KEY is set (OpenRouter backup)"
  if [[ -n "$FALLBACK_URL" ]]; then
    echo "OK   OPENAI_FALLBACK_URL=$FALLBACK_URL"
  else
    echo "INFO OPENAI_FALLBACK_URL unset — default: https://openrouter.ai/api/v1"
  fi
  if [[ -n "$FALLBACK_MODEL" ]]; then
    if is_deprecated_model "$FALLBACK_MODEL"; then
      echo "WARN OPENAI_FALLBACK_MODEL=$FALLBACK_MODEL may be invalid — try meta-llama/llama-3.1-8b-instruct:free"
    else
      echo "OK   OPENAI_FALLBACK_MODEL=$FALLBACK_MODEL"
    fi
  else
    echo "INFO OPENAI_FALLBACK_MODEL unset — default: meta-llama/llama-3.1-8b-instruct:free"
  fi
else
  echo "INFO OPENAI_FALLBACK_KEY not set — optional; primary Groq only"
fi

echo ""
echo "==> Configured OPENAI_* lines (masked):"
grep -E '^OPENAI_' "$ENV_FILE" 2>/dev/null | mask_line || echo "    (no OPENAI_* lines)"

echo ""
if [[ "$ERR" -eq 0 ]]; then
  echo "==> AI env looks usable. Reload after model-only fixes:"
  echo "    pm2 reload ecosystem.config.js --env production"
else
  echo "==> Fix issues above. To update model only (keeps existing keys):"
  echo "    sed -i 's|^OPENAI_MODEL=.*|OPENAI_MODEL=\"llama-3.3-70b-versatile\"|' packages/backend/.env"
  echo "    pm2 reload ecosystem.config.js --env production"
  exit 1
fi
