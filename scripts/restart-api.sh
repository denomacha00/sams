#!/usr/bin/env bash
# Restart sams-api with .env loaded — no manual export needed after ecosystem uses pm2-start.js.
# Usage: bash scripts/restart-api.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/health-wait.sh
source "$ROOT/scripts/lib/health-wait.sh"

ENV_FILE="$ROOT/packages/backend/.env"
PORT="${PORT:-3001}"
API="http://127.0.0.1:${PORT}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

mkdir -p /var/log/sams

echo "==> Restarting sams-api (pm2-start.js loads .env)"
pm2 delete sams-api 2>/dev/null || true
pm2 start ecosystem.config.js --env production --update-env
pm2 save

echo "==> Waiting for GET /health (HTTP 200, up to 60s)"
if wait_for_health_200 "$API" 30 2; then
  echo "OK  /health returned HTTP 200"
  curl -sS --max-time 5 "${API}/health" | head -c 500
  echo ""
  exit 0
fi

echo "FAIL  /health did not return HTTP 200 on ${API}" >&2
health_curl_verbose "$API"
health_diagnose_connection_refused "$API"
pm2 logs sams-api --err --lines 30 --nostream 2>/dev/null || true
pm2 logs sams-api --lines 30 --nostream 2>/dev/null || true
exit 1
