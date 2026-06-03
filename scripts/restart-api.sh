#!/usr/bin/env bash
# Restart sams-api with .env loaded — no manual export needed after ecosystem uses pm2-start.js.
# Usage: bash scripts/restart-api.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

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

echo "==> Waiting for GET /health"
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -sf --max-time 5 "${API}/health" >/dev/null 2>&1; then
    echo "OK  /health responded"
    curl -sf "${API}/health" | head -c 500
    echo ""
    exit 0
  fi
  [[ "$attempt" -lt 15 ]] && sleep 2
done

echo "FAIL  /health did not respond on ${API}" >&2
pm2 logs sams-api --lines 40 --nostream 2>/dev/null || true
exit 1
