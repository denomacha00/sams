#!/usr/bin/env bash
# Verify merged provider secrets (AI, SMS, etc.) without printing full values.
# Reads .env + .env.secrets + secrets/providers.env (same order as pm2-start.js).
#
# Usage:
#   cd /var/www/sams && bash scripts/verify-secrets.sh
#   bash scripts/verify-secrets.sh --ai-only   # Groq/OpenRouter only (legacy alias)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/packages/backend/.env"
AI_ONLY=0
[[ "${1:-}" == "--ai-only" ]] && AI_ONLY=1

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ENV_FILE"

DEPRECATED_MODELS=(
  llama3-70b-8192
  llama3-8b-8192
  llama-3.1-70b-versatile
)

mask_line() {
  sed -E 's/(OPENAI_(API|FALLBACK)_KEY=).*/\1***masked***/' \
    | sed -E 's/(AT_API_KEY=).*/\1***masked***/' \
    | sed -E 's/(SMTP_PASS=).*/\1***masked***/' \
    | sed -E 's/(MPESA_(CONSUMER_)?SECRET=).*/\1***masked***/' \
    | sed -E 's/(MPESA_PASSKEY=).*/\1***masked***/' \
    | sed -E 's/(JWT_(REFRESH_)?SECRET=).*/\1***masked***/' \
    | sed -E 's/(QR_SECRET=).*/\1***masked***/' \
    | sed -E 's/(LICENSE_SECRET=).*/\1***masked***/' \
    | sed -E 's/(SUPER_ADMIN_PASSWORD=).*/\1***masked***/' \
    | sed -E 's/(CONVERSATION_MASTER_KEY=).*/\1***masked***/'
}

is_real_key() {
  local val="$1"
  [[ -n "$val" ]] || return 1
  [[ "$val" == *your-* ]] && return 1
  [[ "$val" == gsk_your* ]] && return 1
  [[ "$val" == sk-or-v1-your* ]] && return 1
  return 0
}

is_real_at_key() {
  local val="$1"
  is_real_key "$val" || return 1
  [[ "$val" == your-africastalking* ]] && return 1
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

echo "==> Provider secrets check (merged .env + overlays)"
echo "    base: $ENV_FILE"
while IFS= read -r f; do
  [[ -f "$f" ]] && echo "    overlay: $f"
done < <(merged_env_secrets_paths)
echo "    (secret values are never printed in full)"
echo ""

ERR=0

# ─── AI (required for AI features) ───────────────────────────────────────────
PRIMARY_KEY="$(read_merged_env OPENAI_API_KEY)"
BASE_URL="$(read_merged_env OPENAI_BASE_URL)"
MODEL="$(read_merged_env OPENAI_MODEL)"
FALLBACK_KEY="$(read_merged_env OPENAI_FALLBACK_KEY)"
FALLBACK_URL="$(read_merged_env OPENAI_FALLBACK_URL)"
FALLBACK_MODEL="$(read_merged_env OPENAI_FALLBACK_MODEL)"
VISION_MODEL="$(read_merged_env VISION_MODEL)"

echo "--- AI (Groq / OpenRouter) ---"
if is_real_key "$PRIMARY_KEY"; then
  echo "OK   OPENAI_API_KEY is set (effective merged env)"
else
  echo "FAIL OPENAI_API_KEY missing or placeholder — add to secrets/providers.env (gsk_...)"
  ERR=1
fi

if [[ -n "$BASE_URL" ]]; then
  echo "OK   OPENAI_BASE_URL=$BASE_URL"
else
  echo "INFO OPENAI_BASE_URL unset — runtime default: https://api.groq.com/openai/v1"
fi

if [[ -n "$MODEL" ]]; then
  if is_deprecated_model "$MODEL"; then
    echo "WARN OPENAI_MODEL=$MODEL is decommissioned — use llama-3.3-70b-versatile"
    ERR=1
  else
    echo "OK   OPENAI_MODEL=$MODEL"
  fi
else
  echo "INFO OPENAI_MODEL unset — runtime default (Groq: llama-3.3-70b-versatile)"
fi

if is_real_key "$FALLBACK_KEY"; then
  if [[ -n "$FALLBACK_URL" && "$FALLBACK_URL" == *groq.com* ]]; then
    echo "OK   OPENAI_FALLBACK_KEY is set (Groq backup)"
  else
    echo "OK   OPENAI_FALLBACK_KEY is set (OpenRouter backup)"
  fi
else
  echo "INFO OPENAI_FALLBACK_KEY not set — optional"
fi

if [[ -n "$VISION_MODEL" ]]; then
  if [[ -n "$BASE_URL" && "$BASE_URL" == *groq.com* && "$VISION_MODEL" == *scout* ]] && ! is_real_key "$FALLBACK_KEY"; then
    echo "WARN VISION_MODEL=$VISION_MODEL — Groq-only setup may need OpenRouter for image upload"
  else
    echo "OK   VISION_MODEL=$VISION_MODEL"
  fi
else
  echo "INFO VISION_MODEL unset — runtime default: meta-llama/llama-4-scout-17b-16e-instruct"
fi

if [[ "$AI_ONLY" -eq 1 ]]; then
  CONV_KEY="$(read_merged_env CONVERSATION_MASTER_KEY)"
  CONV_PREV="$(read_merged_env CONVERSATION_MASTER_KEY_PREVIOUS)"
  echo ""
  echo "--- Conversation memory ---"
  if [[ -n "$CONV_KEY" && ${#CONV_KEY} -ge 32 ]]; then
    echo "OK   CONVERSATION_MASTER_KEY is set (32+ chars)"
    if [[ -n "$CONV_PREV" ]]; then
      if [[ ${#CONV_PREV} -ge 32 ]]; then
        echo "OK   CONVERSATION_MASTER_KEY_PREVIOUS set (decrypt old threads after rotation)"
      else
        echo "WARN CONVERSATION_MASTER_KEY_PREVIOUS shorter than 32 chars — old AI threads may fail to decrypt"
      fi
    else
      echo "INFO After rotating CONVERSATION_MASTER_KEY, set CONVERSATION_MASTER_KEY_PREVIOUS to the old key until threads re-encrypt"
    fi
  else
    echo "WARN CONVERSATION_MASTER_KEY missing or shorter than 32 chars — encrypted chat memory disabled"
  fi
  if [[ "$ERR" -eq 0 ]]; then
    echo ""
    echo "==> AI env looks usable. Reload: bash scripts/restart-api.sh"
  else
    exit 1
  fi
  exit 0
fi

# ─── Africa's Talking (SMS / OTP) ─────────────────────────────────────────────
AT_KEY="$(read_merged_env AT_API_KEY)"
AT_USER="$(read_merged_env AT_USERNAME)"

echo ""
NODE_ENV="$(read_merged_env NODE_ENV)"
NODE_ENV="${NODE_ENV:-development}"

echo "--- SMS (Africa's Talking) ---"
if is_real_at_key "$AT_KEY"; then
  echo "OK   AT_API_KEY is set"
  if [[ -n "$AT_USER" && "$AT_USER" != "sandbox" ]]; then
    echo "OK   AT_USERNAME=$AT_USER (production)"
  elif [[ "$AT_USER" == "sandbox" ]]; then
    if [[ "$NODE_ENV" == "production" ]]; then
      echo "FAIL AT_USERNAME=sandbox — real schools require production AT (run: bash scripts/configure-production-at.sh)"
      ERR=1
    else
      echo "INFO AT_USERNAME=sandbox — sandbox mode (OK for dev only)"
    fi
  else
    if [[ "$NODE_ENV" == "production" ]]; then
      echo "FAIL AT_USERNAME unset — defaults to sandbox; set live AT username in secrets/providers.env"
      ERR=1
    else
      echo "WARN AT_USERNAME unset — defaulting to sandbox"
    fi
  fi
else
  if [[ "$NODE_ENV" == "production" ]]; then
    echo "FAIL AT_API_KEY missing or placeholder — SMS required for production schools"
    ERR=1
  else
    echo "WARN AT_API_KEY missing or placeholder — SMS/OTP disabled until set in secrets/providers.env"
  fi
fi

JWT_VAL="$(read_merged_env JWT_SECRET)"
JWT_REFRESH="$(read_merged_env JWT_REFRESH_SECRET)"
QR_VAL="$(read_merged_env QR_SECRET)"
LICENSE_VAL="$(read_merged_env LICENSE_SECRET)"
echo ""
echo "--- JWT / QR / License (production startup) ---"
if [[ "$NODE_ENV" == "production" ]]; then
  if is_weak_production_secret "$JWT_VAL"; then
    echo "FAIL JWT_SECRET missing or <64 chars — run: bash scripts/set-production-env.sh"
    ERR=1
  else
    echo "OK   JWT_SECRET ok (64+ chars, merged env)"
  fi
  if is_weak_production_secret "$JWT_REFRESH"; then
    echo "FAIL JWT_REFRESH_SECRET missing or <64 chars — run: bash scripts/set-production-env.sh"
    ERR=1
  else
    echo "OK   JWT_REFRESH_SECRET ok (64+ chars)"
  fi
  if is_weak_production_secret "$QR_VAL"; then
    echo "FAIL QR_SECRET missing or <64 chars — run: bash scripts/set-production-env.sh"
    ERR=1
  else
    echo "OK   QR_SECRET ok (64+ chars)"
  fi
  if is_weak_production_secret "$LICENSE_VAL"; then
    echo "FAIL LICENSE_SECRET missing or <64 chars — run: bash scripts/set-production-env.sh"
    ERR=1
  else
    echo "OK   LICENSE_SECRET ok (64+ chars)"
  fi
else
  echo "INFO JWT/QR/license length checks skipped (NODE_ENV=$NODE_ENV)"
fi

BIO_KEY="$(read_merged_env BIOMETRIC_MASTER_KEY)"
echo ""
echo "--- Biometric (enroll + match) ---"
if [[ -n "$BIO_KEY" && ${#BIO_KEY} -ge 32 && "$BIO_KEY" != *change-me* ]]; then
  echo "OK   BIOMETRIC_MASTER_KEY is set (32+ chars)"
else
  if [[ "$NODE_ENV" == "production" ]]; then
    echo "FAIL BIOMETRIC_MASTER_KEY missing or placeholder — required for licensed school biometric"
    ERR=1
  else
    echo "WARN BIOMETRIC_MASTER_KEY missing — biometric encryption disabled"
  fi
fi

# ─── SMTP (optional) ─────────────────────────────────────────────────────────
SMTP_USER="$(read_merged_env SMTP_USER)"
SMTP_PASS="$(read_merged_env SMTP_PASS)"

echo ""
echo "--- Email (SMTP) ---"
if [[ -n "$SMTP_USER" && -n "$SMTP_PASS" ]] && [[ "$SMTP_PASS" != *your-* ]]; then
  echo "OK   SMTP_USER + SMTP_PASS configured"
else
  echo "INFO SMTP not fully configured — email notifications disabled"
fi

# ─── Conversation memory (encrypted DB threads) ─────────────────────────────
CONV_KEY="$(read_merged_env CONVERSATION_MASTER_KEY)"
CONV_PREV="$(read_merged_env CONVERSATION_MASTER_KEY_PREVIOUS)"

echo ""
echo "--- Conversation memory ---"
if [[ -n "$CONV_KEY" && ${#CONV_KEY} -ge 32 ]]; then
  echo "OK   CONVERSATION_MASTER_KEY is set (32+ chars)"
  if [[ -n "$CONV_PREV" ]]; then
    if [[ ${#CONV_PREV} -ge 32 ]]; then
      echo "OK   CONVERSATION_MASTER_KEY_PREVIOUS set (decrypt old threads after rotation)"
    else
      echo "WARN CONVERSATION_MASTER_KEY_PREVIOUS shorter than 32 chars — old AI threads may fail to decrypt"
    fi
  else
    echo "INFO After rotating CONVERSATION_MASTER_KEY, set CONVERSATION_MASTER_KEY_PREVIOUS to the old key until threads re-encrypt"
  fi
else
  echo "WARN CONVERSATION_MASTER_KEY missing or shorter than 32 chars — encrypted chat memory disabled"
fi

# ─── M-Pesa (optional) ───────────────────────────────────────────────────────
MPESA_KEY="$(read_merged_env MPESA_CONSUMER_KEY)"
MPESA_SECRET="$(read_merged_env MPESA_CONSUMER_SECRET)"

echo ""
echo "--- M-Pesa ---"
if is_real_key "$MPESA_KEY" && [[ -n "$MPESA_SECRET" && "$MPESA_SECRET" != *your-* ]]; then
  echo "OK   MPESA_CONSUMER_KEY + MPESA_CONSUMER_SECRET configured"
else
  echo "INFO M-Pesa keys not set — payments use sandbox/disabled until configured"
fi

echo ""
echo "==> Configured provider lines (masked, all sources):"
{
  grep -E '^(OPENAI_|VISION_MODEL=|CONVERSATION_MASTER_KEY=|AT_|SMTP_|MPESA_CONSUMER_|MPESA_PASSKEY=|JWT_|QR_SECRET=|LICENSE_SECRET=)' "$ENV_FILE" 2>/dev/null || true
  while IFS= read -r f; do
    [[ -f "$f" ]] && grep -E '^(OPENAI_|VISION_MODEL=|CONVERSATION_MASTER_KEY=|AT_|SMTP_|MPESA_CONSUMER_|MPESA_PASSKEY=|JWT_|QR_SECRET=|LICENSE_SECRET=)' "$f" 2>/dev/null || true
  done < <(merged_env_secrets_paths)
} | mask_line | sort -u || echo "    (no matching lines)"

echo ""
if [[ "$ERR" -eq 0 ]]; then
  echo "==> Critical checks passed (AI + readable overlays). Reload after changes:"
  echo "    bash scripts/restart-api.sh"
  echo "    Backup before edits: bash scripts/backup-secrets.sh"
else
  echo "==> Fix FAIL items above. Template: secrets/providers.env.example"
  echo "    VPS path: /var/www/sams/secrets/providers.env"
  exit 1
fi
