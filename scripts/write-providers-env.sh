#!/usr/bin/env bash
# Write AI provider secrets to providers.env (OpenRouter primary, Groq fallback).
#
# Does NOT embed keys in this script. Pass keys via environment or arguments only.
#
# Usage (recommended — keys not stored in shell history if you use env from a file):
#   export OPENROUTER_KEY='sk-or-v1-...'
#   export GROQ_KEY='gsk_...'
#   export CONVERSATION_MASTER_KEY='...'   # optional; 32+ chars for encrypted chat memory
#   bash scripts/write-providers-env.sh
#
# Usage (positional):
#   bash scripts/write-providers-env.sh '<openrouter-key>' '<groq-key>' ['<conversation-master-key>']
#
# Optional overrides:
#   OUT=/var/www/sams/secrets/providers.env   (default: VPS path, else repo secrets/providers.env)
#   OPENROUTER_BASE_URL  OPENROUTER_MODEL
#   GROQ_BASE_URL        GROQ_MODEL
#   CONVERSATION_MASTER_KEY   (or 3rd positional arg; generate: openssl rand -base64 48)
#
# Merges with an existing providers.env: updates OPENAI_* / VISION_MODEL (and
# CONVERSATION_MASTER_KEY when provided); preserves AT, SMTP, M-Pesa, and other keys.
#
# After writing: chmod 600. Restart API: cd /var/www/sams && pm2 reload ecosystem.config.js --update-env

set -euo pipefail

OPENROUTER_KEY="${OPENROUTER_KEY:-${1:-}}"
GROQ_KEY="${GROQ_KEY:-${2:-}}"
CONVERSATION_MASTER_KEY="${CONVERSATION_MASTER_KEY:-${3:-}}"

if [[ -z "$OPENROUTER_KEY" || -z "$GROQ_KEY" ]]; then
  echo "ERROR: OPENROUTER_KEY and GROQ_KEY are required." >&2
  echo "  export OPENROUTER_KEY='...' GROQ_KEY='...' && bash $0" >&2
  echo "  bash $0 '<openrouter-key>' '<groq-key>'" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${OUT:-}" ]]; then
  :
elif [[ -d /var/www/sams ]]; then
  OUT="/var/www/sams/secrets/providers.env"
else
  OUT="${ROOT}/secrets/providers.env"
fi

PRIMARY_BASE_URL="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
PRIMARY_MODEL="${OPENROUTER_MODEL:-meta-llama/llama-3.1-8b-instruct:free}"
FALLBACK_BASE_URL="${GROQ_BASE_URL:-https://api.groq.com/openai/v1}"
FALLBACK_MODEL="${GROQ_MODEL:-llama-3.3-70b-versatile}"

mkdir -p "$(dirname "$OUT")"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

strip_re='^(OPENAI_|VISION_MODEL=)'
[[ -n "$CONVERSATION_MASTER_KEY" ]] && strip_re='^(OPENAI_|VISION_MODEL=|CONVERSATION_MASTER_KEY=)'

if [[ -f "$OUT" ]]; then
  grep -v -E "$strip_re" "$OUT" >"$tmp" || true
else
  : >"$tmp"
fi

{
  echo "# AI providers (OpenRouter primary, Groq fallback) — $(date -Iseconds)"
  printf 'OPENAI_API_KEY="%s"\n' "$OPENROUTER_KEY"
  printf 'OPENAI_BASE_URL="%s"\n' "$PRIMARY_BASE_URL"
  printf 'OPENAI_MODEL="%s"\n' "$PRIMARY_MODEL"
  printf 'OPENAI_FALLBACK_KEY="%s"\n' "$GROQ_KEY"
  printf 'OPENAI_FALLBACK_URL="%s"\n' "$FALLBACK_BASE_URL"
  printf 'OPENAI_FALLBACK_MODEL="%s"\n' "$FALLBACK_MODEL"
  printf 'VISION_MODEL="%s"\n' "${VISION_MODEL:-meta-llama/llama-4-scout-17b-16e-instruct}"
  if [[ -n "$CONVERSATION_MASTER_KEY" ]]; then
    printf 'CONVERSATION_MASTER_KEY="%s"\n' "$CONVERSATION_MASTER_KEY"
  fi
} >>"$tmp"

mv "$tmp" "$OUT"
trap - EXIT
chmod 600 "$OUT"

echo "==> Wrote AI provider config to $OUT (chmod 600)"
echo "    Primary:  OpenRouter ($PRIMARY_MODEL)"
echo "    Fallback: Groq ($FALLBACK_MODEL)"
echo "    Vision:   ${VISION_MODEL:-meta-llama/llama-4-scout-17b-16e-instruct}"
if [[ -n "$CONVERSATION_MASTER_KEY" ]]; then
  echo "    Memory:   CONVERSATION_MASTER_KEY set (${#CONVERSATION_MASTER_KEY} chars)"
elif grep -q '^CONVERSATION_MASTER_KEY=' "$OUT" 2>/dev/null; then
  echo "    Memory:   CONVERSATION_MASTER_KEY preserved from existing file"
else
  echo "    Memory:   CONVERSATION_MASTER_KEY not set — export it or: openssl rand -base64 48"
fi
echo "==> Verify:  bash scripts/verify-secrets.sh --ai-only"
echo "==> Reload:  pm2 reload ecosystem.config.js --update-env"
