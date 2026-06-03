#!/usr/bin/env bash
# Quick VPS diagnostics when PM2 is online but /health fails.
# Usage: bash scripts/diagnose-api.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
API="http://127.0.0.1:${PORT}"

echo "==> SAMS API diagnostics ($(date -Iseconds))"
echo "    API=${API}"
echo ""

echo "==> PM2 describe sams-api"
if command -v pm2 >/dev/null 2>&1; then
  pm2 describe sams-api 2>/dev/null || echo "  (sams-api process not found)"
else
  echo "  pm2 not in PATH"
fi
echo ""

echo "==> Listening on port ${PORT}"
if command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep -E ":${PORT}\\b" || echo "  (nothing listening on ${PORT})"
elif command -v netstat >/dev/null 2>&1; then
  netstat -tlnp 2>/dev/null | grep -E ":${PORT}\\b" || echo "  (nothing listening on ${PORT})"
else
  echo "  ss/netstat not available"
fi
echo ""

echo "==> curl -v ${API}/health"
curl -v --max-time 10 "${API}/health" 2>&1 || true
echo ""

echo "==> Tail PM2 logs (out + error, last 60 lines each)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 logs sams-api --lines 60 --nostream 2>/dev/null || true
else
  for f in /var/log/sams/sams-api-out.log /var/log/sams/sams-api-error.log; do
    if [[ -f "$f" ]]; then
      echo "--- $f ---"
      tail -n 60 "$f" 2>/dev/null || true
    fi
  done
fi
