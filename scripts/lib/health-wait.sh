#!/usr/bin/env bash
# Wait until GET /health returns HTTP 200 (not 503 starting/degraded).
# Usage: source scripts/lib/health-wait.sh && wait_for_health_200 "$API" 30 2

wait_for_health_200() {
  local api="${1:?API base URL required}"
  local max_attempts="${2:-30}"
  local sleep_secs="${3:-2}"
  local attempt code

  for attempt in $(seq 1 "$max_attempts"); do
    code="$(curl -sS --max-time 5 -o /dev/null -w "%{http_code}" "${api}/health" 2>/dev/null || echo "000")"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep "$sleep_secs"
    fi
  done
  return 1
}

health_curl_verbose() {
  local api="${1:?API base URL required}"
  echo "--- curl -v ${api}/health (last attempt) ---"
  curl -v --max-time 10 "${api}/health" 2>&1 || true
}
