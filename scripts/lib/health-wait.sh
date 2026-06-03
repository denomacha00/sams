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

# Print PM2 / Node hints when nothing is listening (curl 000 / connection refused).
health_diagnose_connection_refused() {
  local api="${1:?API base URL required}"
  local code
  code="$(curl -sS --max-time 3 -o /dev/null -w "%{http_code}" "${api}/health" 2>/dev/null || echo "000")"
  if [[ "$code" != "000" ]]; then
    return 0
  fi
  echo ""
  echo "  Diagnose (connection refused — nothing listening on ${api}):"
  echo "    PM2 may show online while the process exits before binding the port."
  if command -v pm2 >/dev/null 2>&1; then
    echo "    pm2 logs sams-api --err --lines 30"
    echo "    pm2 logs sams-api --lines 30 --nostream"
    echo "    pm2 describe sams-api"
  fi
  local node_major
  node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [[ "$node_major" -lt 20 ]]; then
    echo "    Node $(node -v) is below 20 — run: bash scripts/install-node20-ubuntu.sh or scripts/upgrade-node20.sh (DOCUMENTATION.md §9)"
    echo "    Then: npm ci && bash scripts/deploy-production.sh"
  fi
  echo "    Common causes: missing/placeholder JWT_SECRET (64+ chars), Redis/Postgres down, stale dist"
}
