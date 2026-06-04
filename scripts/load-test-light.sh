#!/usr/bin/env bash
# Light load smoke — repeated GET /health (no auth). Not a full load test.
# Usage: LOOPS=20 bash scripts/load-test-light.sh

set -euo pipefail

PORT="${PORT:-3001}"
API="http://127.0.0.1:${PORT}"
LOOPS="${LOOPS:-20}"
FAIL=0

echo "==> SAMS light load (${LOOPS} x GET /health) → ${API}"

for i in $(seq 1 "$LOOPS"); do
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${API}/health" 2>/dev/null || echo 000)"
  if [[ "$CODE" != "200" && "$CODE" != "503" ]]; then
    echo "  FAIL  request ${i}: HTTP ${CODE}"
    FAIL=1
    break
  fi
done

if [[ "$FAIL" -eq 0 ]]; then
  echo "  OK  ${LOOPS} requests completed (200 or 503 starting/degraded)"
  exit 0
fi
echo "==> Light load failed"
exit 1
