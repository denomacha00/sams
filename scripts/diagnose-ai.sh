#!/usr/bin/env bash
# Diagnose AI when chat fails but PM2 is online.
# Usage: cd /var/www/sams && bash scripts/diagnose-ai.sh
#
# Optional: AI_PROBE=1 to hit provider APIs via /health?ai_probe=1 (uses quota).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
API="http://127.0.0.1:${PORT}"
AI_PROBE="${AI_PROBE:-0}"

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="${ROOT}/packages/backend/.env"

mask_line() {
  sed -E 's/(OPENAI_(API|FALLBACK)_KEY=).*/\1***masked***/' \
    | sed -E 's/(ATOMESUS_API_KEY=).*/\1***masked***/'
}

echo "==> SAMS AI diagnostics ($(date -Iseconds))"
echo ""

echo "==> 1) Merged secrets (AI only)"
bash "$ROOT/scripts/verify-secrets.sh" --ai-only || true
echo ""

echo "==> 2) PM2 logs (last 80 lines)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 logs sams-api --lines 80 --nostream 2>/dev/null | grep -E '\[AI|\[STARTUP\]|OPENAI|ATOMESUS|Atomesus|Groq|OpenRouter|rate|401|429|model' || pm2 logs sams-api --lines 80 --nostream 2>/dev/null || true
else
  echo "  pm2 not in PATH"
fi
echo ""

echo "==> 3) Provider env lines (masked)"
{
  grep -E '^(OPENAI_|ATOMESUS_|VISION_MODEL=)' "${ROOT}/packages/backend/.env" 2>/dev/null || true
  while IFS= read -r f; do
    [[ -f "$f" ]] && grep -E '^(OPENAI_|ATOMESUS_|VISION_MODEL=)' "$f" 2>/dev/null || true
  done < <(merged_env_secrets_paths)
} | mask_line | sort -u || echo "  (no AI provider lines found)"
echo ""

echo "==> 4) GET ${API}/health (ai config)"
curl -sS --max-time 10 "${API}/health" | python3 -m json.tool 2>/dev/null || curl -sS --max-time 10 "${API}/health" || true
echo ""

if [[ "$AI_PROBE" == "1" ]]; then
  echo "==> 5) Live provider probe via /health?ai_probe=1"
  curl -sS --max-time 25 "${API}/health?ai_probe=1" | python3 -m json.tool 2>/dev/null || curl -sS --max-time 25 "${API}/health?ai_probe=1" || true
  echo ""
fi

echo "==> 6) POST ${API}/api/v1/ai/query (guest ping)"
HTTP_CODE="$(curl -sS -o /tmp/sams-ai-ping.json -w '%{http_code}' --max-time 45 \
  -X POST "${API}/api/v1/ai/query" \
  -H 'Content-Type: application/json' \
  -d '{"question":"Reply with exactly: ok"}' || echo "000")"
echo "    HTTP ${HTTP_CODE}"
if [[ -f /tmp/sams-ai-ping.json ]]; then
  python3 -m json.tool /tmp/sams-ai-ping.json 2>/dev/null || cat /tmp/sams-ai-ping.json
  rm -f /tmp/sams-ai-ping.json
fi
echo ""

echo "==> 7) Direct provider reachability (if keys in merged env)"
source_merged_env 2>/dev/null || true
PRIMARY_KEY="$(read_merged_env OPENAI_API_KEY)"
BASE_URL="$(read_merged_env OPENAI_BASE_URL)"
MODEL="$(read_merged_env OPENAI_MODEL)"
FALLBACK_KEY="$(read_merged_env OPENAI_FALLBACK_KEY)"
FALLBACK_URL="$(read_merged_env OPENAI_FALLBACK_URL)"
FALLBACK_MODEL="$(read_merged_env OPENAI_FALLBACK_MODEL)"
ATOMESUS_KEY="$(read_merged_env ATOMESUS_API_KEY)"
ATOMESUS_BASE_URL="$(read_merged_env ATOMESUS_BASE_URL)"
ATOMESUS_MODEL="$(read_merged_env ATOMESUS_MODEL)"
ATOMESUS_VISION_MODEL="$(read_merged_env ATOMESUS_VISION_MODEL)"

probe_provider() {
  local label="$1" key="$2" url="$3" model="$4"
  [[ -z "$key" || "$key" == *your-* ]] && { echo "  SKIP $label — no real key"; return; }
  url="${url:-https://api.groq.com/openai/v1}"
  model="${model:-llama-3.3-70b-versatile}"
  echo "  --- $label ($url, model=$model) ---"
  curl -sS --max-time 20 "${url}/chat/completions" \
    -H "Authorization: Bearer ${key}" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],\"max_tokens\":5}" \
    | head -c 400 || echo "  curl failed"
  echo ""
}

probe_provider "primary" "$PRIMARY_KEY" "$BASE_URL" "$MODEL"
probe_provider "fallback" "$FALLBACK_KEY" "$FALLBACK_URL" "$FALLBACK_MODEL"
probe_provider "atomesus" "$ATOMESUS_KEY" "${ATOMESUS_BASE_URL:-https://api.atomesus.com/v1}" "${ATOMESUS_MODEL:-cipher}"
if [[ -n "$ATOMESUS_VISION_MODEL" ]]; then
  echo "  INFO atomesus vision model configured: ${ATOMESUS_VISION_MODEL}"
else
  echo "  INFO atomesus vision model not configured; image reading uses OpenRouter/OpenAI vision only"
fi

echo "==> Done. Fix FAIL from verify-secrets, then: bash scripts/restart-api.sh"
echo "    Live probe: AI_PROBE=1 bash scripts/diagnose-ai.sh"
