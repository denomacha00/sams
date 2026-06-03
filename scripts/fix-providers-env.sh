#!/usr/bin/env bash
# Repair corrupted secrets/providers.env (truncated quotes, pasted junk, AT_USERNAME confusion).
# Interactive — does not print full secret values.
#
# Fixes:
#   - Junk lines (e.g. bash scripts/restart-api.sh# pasted into the file)
#   - Broken/truncated OPENAI_* / AT_* quoted values
#   - AT_USERNAME="SAMS" mistaken for sender ID (prompts for dashboard app username)
#   - Forces OTP_PASSWORD_RESET_ENABLED=true, OTP_LOGIN_ENABLED=false
#
# Usage:
#   cd /var/www/sams && bash scripts/fix-providers-env.sh
#
# After success:
#   bash scripts/verify-secrets.sh
#   pm2 reload ecosystem.config.js --env production

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVIDERS_FILE="${ROOT}/secrets/providers.env"
if [[ -d /var/www/sams && -f /var/www/sams/secrets/providers.env ]]; then
  PROVIDERS_FILE="/var/www/sams/secrets/providers.env"
fi

# shellcheck source=lib/provider-secret-keys.sh
source "$ROOT/scripts/lib/provider-secret-keys.sh"

if [[ ! -f "$PROVIDERS_FILE" ]]; then
  echo "ERROR: $PROVIDERS_FILE not found." >&2
  echo "  cp secrets/providers.env.example secrets/providers.env && chmod 600" >&2
  exit 1
fi

BACKUP="${PROVIDERS_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$PROVIDERS_FILE" "$BACKUP"
echo "==> Backup: $BACKUP"

escape_env_val() {
  printf '%s' "$1" | sed 's/"/\\"/g'
}

is_junk_line() {
  local line="$1"
  line="${line//$'\r'/}"
  [[ -z "${line//[[:space:]]/}" ]] && return 0
  [[ "$line" =~ restart-api\.sh ]] && return 0
  [[ "$line" =~ ^bash[[:space:]]+scripts/ ]] && return 0
  [[ "$line" =~ \.sh# ]] && return 0
  [[ "$line" =~ ^pm2[[:space:]] ]] && return 0
  [[ "$line" =~ ^curl[[:space:]] ]] && return 0
  if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && [[ ! "$line" =~ ^[[:space:]]*# ]]; then
    return 0
  fi
  return 1
}

sanitize_raw() {
  local in="$1" out="$2"
  : >"$out"
  while IFS= read -r line || [[ -n "$line" ]]; do
    is_junk_line "$line" && continue
    printf '%s\n' "${line//$'\r'/}" >>"$out"
  done <"$in"
}

# Return 0 if the key's assignment in file is missing a closing quote (truncated / wrapped).
is_key_truncated() {
  local key="$1" file="$2"
  local in_key=0 blob="" line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//$'\r'/}"
    if [[ $in_key -eq 0 ]]; then
      [[ "$line" =~ ^${key}= ]] || continue
      blob="$line"
      in_key=1
      if [[ "$blob" =~ ^${key}=\"[^\"]*\"[[:space:]]*$ ]]; then
        return 1
      fi
      if [[ "$blob" =~ ^${key}=\"[^\"]*\" ]]; then
        return 1
      fi
      if [[ "$blob" =~ ^${key}=[^\"]*$ ]] && [[ ! "$blob" =~ \" ]]; then
        return 1
      fi
      if [[ "$blob" == *\" ]]; then
        continue
      fi
      return 0
    else
      blob+=$'\n'"$line"
      if [[ "$line" == *\" ]]; then
        in_key=0
        return 1
      fi
    fi
  done <"$file"
  [[ $in_key -eq 1 ]] && return 0
  return 1
}

get_parsed_value() {
  local key="$1" file="$2"
  local accumulating=0 partial="" line val=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//$'\r'/}"
    if [[ $accumulating -eq 1 ]]; then
      partial+="$line"
      if [[ "$partial" == *\" ]]; then
        val="${partial%\"}"
        val="${val#\"}"
        printf '%s' "$val"
        return 0
      fi
      continue
    fi
    if [[ "$line" =~ ^${key}= ]]; then
      partial="${line#${key}=}"
      partial="${partial#\"}"
      if [[ "$line" == *\" ]] && [[ "$partial" == *\" ]]; then
        val="${partial%\"}"
        printf '%s' "$val"
        return 0
      fi
      if [[ "$line" == *\" ]]; then
        accumulating=1
        continue
      fi
      partial="${partial%\"}"
      partial="${partial#\'}"
      partial="${partial%\'}"
      printf '%s' "$partial"
      return 0
    fi
  done <"$file"
  return 1
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

prompt_if_truncated() {
  local key="$1" label="$2" hidden="${3:-0}" file="$4" current="$5"
  if is_key_truncated "$key" "$file" || ! is_real_key "$current"; then
    echo "" >&2
    echo "    $label appears truncated or invalid in backup — re-enter." >&2
    if [[ "$hidden" == "1" ]]; then
      read -r -s -p "    $key: " current
      echo "" >&2
    else
      read -r -p "    $key: " current
    fi
  fi
  printf '%s' "$current"
}

declare -A VALS=()

SANITIZED="$(mktemp)"
trap 'rm -f "$SANITIZED"' EXIT
sanitize_raw "$BACKUP" "$SANITIZED"

while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  v="$(get_parsed_value "$key" "$SANITIZED" 2>/dev/null || true)"
  VALS["$key"]="$v"
done < <(provider_secret_keys)

for key in OTP_PASSWORD_RESET_ENABLED OTP_LOGIN_ENABLED SMS_WELCOME_ON_REGISTER; do
  v="$(get_parsed_value "$key" "$SANITIZED" 2>/dev/null || true)"
  VALS["$key"]="$v"
done

echo ""
echo "==> SAMS — repair secrets/providers.env"
echo "    File: $PROVIDERS_FILE"
echo "    (values are not printed; backup kept if you need to recover)"
echo ""

# ─── Africa's Talking (interactive) ───────────────────────────────────────────
AT_USER="${VALS[AT_USERNAME]:-}"
AT_KEY="${VALS[AT_API_KEY]:-}"
AT_SENDER="${VALS[AT_SENDER_ID]:-}"

if [[ "$AT_USER" == "SAMS" ]]; then
  echo "WARN: AT_USERNAME=SAMS is usually wrong — that is typically AT_SENDER_ID."
  echo "      Use your Africa's Talking dashboard application username (often lowercase, e.g. sams)."
  AT_USER=""
fi

DEFAULT_USER="$AT_USER"
if [[ -z "$DEFAULT_USER" ]]; then
  DEFAULT_USER="sams"
fi
read -r -p "AT_USERNAME (AT app username, not sender ID) [${DEFAULT_USER}]: " NEW_USER
AT_USER="${NEW_USER:-$DEFAULT_USER}"

AT_KEY="$(prompt_if_truncated AT_API_KEY "AT_API_KEY" 1 "$SANITIZED" "$AT_KEY")"
if ! is_real_at_key "$AT_KEY"; then
  read -r -s -p "AT_API_KEY (required): " AT_KEY
  echo ""
fi

DEFAULT_SENDER="${AT_SENDER:-SAMS}"
read -r -p "AT_SENDER_ID (approved sender label) [${DEFAULT_SENDER}]: " NEW_SENDER
AT_SENDER="${NEW_SENDER:-$DEFAULT_SENDER}"

VALS[AT_USERNAME]="$AT_USER"
VALS[AT_API_KEY]="$AT_KEY"
VALS[AT_SENDER_ID]="$AT_SENDER"
VALS[OTP_PASSWORD_RESET_ENABLED]="true"
VALS[OTP_LOGIN_ENABLED]="false"
VALS[SMS_WELCOME_ON_REGISTER]="${VALS[SMS_WELCOME_ON_REGISTER]:-true}"

# ─── AI keys (preserve unless truncated) ──────────────────────────────────────
for key in OPENAI_API_KEY OPENAI_FALLBACK_KEY; do
  cur="${VALS[$key]:-}"
  VALS[$key]="$(prompt_if_truncated "$key" "$key" 1 "$SANITIZED" "$cur")"
done

for key in OPENAI_BASE_URL OPENAI_MODEL OPENAI_FALLBACK_URL OPENAI_FALLBACK_MODEL VISION_MODEL; do
  cur="${VALS[$key]:-}"
  if is_key_truncated "$key" "$SANITIZED" || [[ -z "$cur" ]]; then
    case "$key" in
      OPENAI_BASE_URL) cur="${cur:-https://openrouter.ai/api/v1}" ;;
      OPENAI_MODEL) cur="${cur:-meta-llama/llama-3.1-8b-instruct:free}" ;;
      OPENAI_FALLBACK_URL) cur="${cur:-https://api.groq.com/openai/v1}" ;;
      OPENAI_FALLBACK_MODEL) cur="${cur:-llama-3.3-70b-versatile}" ;;
      VISION_MODEL) cur="${cur:-meta-llama/llama-4-scout-17b-16e-instruct}" ;;
    esac
    read -r -p "    $key [${cur}]: " entered
    cur="${entered:-$cur}"
  fi
  VALS[$key]="$cur"
done

CONV="${VALS[CONVERSATION_MASTER_KEY]:-}"
if is_key_truncated CONVERSATION_MASTER_KEY "$SANITIZED" || [[ -z "$CONV" ]] || [[ ${#CONV} -lt 32 ]]; then
  echo "" >&2
  echo "    CONVERSATION_MASTER_KEY missing/truncated (<32 chars) — optional but recommended." >&2
  read -r -s -p "    CONVERSATION_MASTER_KEY (Enter to skip): " CONV
  echo ""
  [[ -n "$CONV" ]] && VALS[CONVERSATION_MASTER_KEY]="$CONV"
else
  VALS[CONVERSATION_MASTER_KEY]="$CONV"
fi

# ─── Write clean file ─────────────────────────────────────────────────────────
tmp="$(mktemp)"
trap 'rm -f "$SANITIZED" "$tmp"' EXIT

{
  echo "# SAMS provider secrets — repaired $(date -Iseconds)"
  echo "# Restored from backup: $BACKUP"
  echo ""
  echo "# ─── AI (OpenRouter primary, Groq fallback) ─────────────────────────────"
  for key in OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL OPENAI_FALLBACK_KEY OPENAI_FALLBACK_URL OPENAI_FALLBACK_MODEL VISION_MODEL; do
    v="${VALS[$key]:-}"
    [[ -n "$v" ]] && printf '%s="%s"\n' "$key" "$(escape_env_val "$v")"
  done
  if [[ -n "${VALS[CONVERSATION_MASTER_KEY]:-}" ]]; then
    printf 'CONVERSATION_MASTER_KEY="%s"\n' "$(escape_env_val "${VALS[CONVERSATION_MASTER_KEY]}")"
  fi
  echo ""
  echo "# ─── Africa's Talking (SMS / OTP) ─────────────────────────────────────────"
  printf 'AT_API_KEY="%s"\n' "$(escape_env_val "${VALS[AT_API_KEY]}")"
  printf 'AT_USERNAME="%s"\n' "$(escape_env_val "${VALS[AT_USERNAME]}")"
  printf 'AT_SENDER_ID="%s"\n' "$(escape_env_val "${VALS[AT_SENDER_ID]}")"
  if [[ -n "${VALS[AT_SANDBOX_SENDER_ID]:-}" ]]; then
    printf 'AT_SANDBOX_SENDER_ID="%s"\n' "$(escape_env_val "${VALS[AT_SANDBOX_SENDER_ID]}")"
  fi
  printf 'OTP_PASSWORD_RESET_ENABLED="%s"\n' "${VALS[OTP_PASSWORD_RESET_ENABLED]}"
  printf 'OTP_LOGIN_ENABLED="%s"\n' "${VALS[OTP_LOGIN_ENABLED]}"
  printf 'SMS_WELCOME_ON_REGISTER="%s"\n' "${VALS[SMS_WELCOME_ON_REGISTER]}"
  echo ""
  echo "# ─── SMTP (email) ─────────────────────────────────────────────────────────"
  for key in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM_NAME SMTP_FROM_EMAIL; do
    v="${VALS[$key]:-}"
    [[ -n "$v" ]] && printf '%s="%s"\n' "$key" "$(escape_env_val "$v")"
  done
  echo ""
  echo "# ─── M-Pesa (Daraja) ──────────────────────────────────────────────────────"
  for key in MPESA_CONSUMER_KEY MPESA_CONSUMER_SECRET MPESA_SHORTCODE MPESA_PASSKEY MPESA_CALLBACK_URL; do
    v="${VALS[$key]:-}"
    [[ -n "$v" ]] && printf '%s="%s"\n' "$key" "$(escape_env_val "$v")"
  done
  echo ""
  echo "# ─── Biometric / app crypto (optional) ────────────────────────────────────"
  for key in BIOMETRIC_MASTER_KEY BIOMETRIC_ENCRYPTION_KEY JWT_SECRET JWT_REFRESH_SECRET QR_SECRET LICENSE_SECRET SUPER_ADMIN_PASSWORD CONVERSATION_MASTER_KEY_PREVIOUS; do
    v="${VALS[$key]:-}"
    [[ -n "$v" ]] && printf '%s="%s"\n' "$key" "$(escape_env_val "$v")"
  done
} >"$tmp"

mv "$tmp" "$PROVIDERS_FILE"
trap - EXIT
rm -f "$SANITIZED"
chmod 600 "$PROVIDERS_FILE" 2>/dev/null || true

echo ""
echo "==> Wrote clean $PROVIDERS_FILE (one line per key, quoted values)"
echo "    AT_USERNAME=${AT_USER}  AT_SENDER_ID=${AT_SENDER}  (secrets masked below)"
grep -E '^(AT_USERNAME|AT_SENDER_ID|OTP_|SMS_WELCOME)=' "$PROVIDERS_FILE" | sed 's/AT_API_KEY=.*/AT_API_KEY="***"/' || true

echo ""
echo "==> Running verify-secrets.sh"
cd "$ROOT"
if bash "$ROOT/scripts/verify-secrets.sh"; then
  echo ""
  echo "==> Reload PM2 and check health:"
  echo "    pm2 reload ecosystem.config.js --env production"
  echo "    sleep 2 && curl -s http://127.0.0.1:\${PORT:-3001}/health"
  echo ""
  echo "    Or: bash scripts/restart-api.sh"
else
  echo ""
  echo "==> verify-secrets.sh reported issues — fix FAIL lines above, then:"
  echo "    pm2 reload ecosystem.config.js --env production"
  exit 1
fi
