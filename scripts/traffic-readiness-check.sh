#!/usr/bin/env bash
# SAMS traffic readiness probe.
# Non-destructive: health + read-only authenticated endpoints when login creds are provided.
#
# Usage:
#   REQUESTS=300 CONCURRENCY=20 bash scripts/traffic-readiness-check.sh
#
# Optional authenticated checks:
#   VERIFY_LOGIN_IDENTIFIER='teacher1' VERIFY_LOGIN_PASSWORD='...' \
#   VERIFY_LOGIN_SCHOOL_CODE='GREENWOOD' REQUESTS=300 CONCURRENCY=20 \
#   bash scripts/traffic-readiness-check.sh

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3001}"
REQUESTS="${REQUESTS:-200}"
CONCURRENCY="${CONCURRENCY:-10}"
MAX_P95_SECONDS="${MAX_P95_SECONDS:-1.5}"
TMP_DIR="$(mktemp -d)"
RESULTS_FILE="$TMP_DIR/results.tsv"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "==> SAMS traffic readiness"
echo "    API:         $API_BASE"
echo "    Requests:    $REQUESTS"
echo "    Concurrency: $CONCURRENCY"
echo "    p95 target:  <= ${MAX_P95_SECONDS}s"

TOKEN=""
if [[ -n "${VERIFY_LOGIN_IDENTIFIER:-}" && -n "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  echo "==> Logging in for authenticated read checks"
  LOGIN_BODY="$(
    node -e "process.stdout.write(JSON.stringify({schoolCode: process.env.VERIFY_LOGIN_SCHOOL_CODE || '', identifier: process.env.VERIFY_LOGIN_IDENTIFIER, password: process.env.VERIFY_LOGIN_PASSWORD}))"
  )"
  LOGIN_RESPONSE="$(
    curl -sS --max-time 20 \
      -H 'Content-Type: application/json' \
      -d "$LOGIN_BODY" \
      "$API_BASE/api/v1/auth/login"
  )"
  TOKEN="$(
    LOGIN_RESPONSE="$LOGIN_RESPONSE" node -e "try{const r=JSON.parse(process.env.LOGIN_RESPONSE||'{}');process.stdout.write(r.accessToken||r.token||'')}catch{}"
  )"
  if [[ -z "$TOKEN" ]]; then
    echo "FAIL login did not return an access token"
    echo "$LOGIN_RESPONSE"
    exit 1
  fi
  echo "OK   authenticated token acquired"
fi

ENDPOINTS="/health/live|/health/ready|/health"
if [[ -n "$TOKEN" ]]; then
  ENDPOINTS="$ENDPOINTS|/api/v1/users/me|/api/v1/timetable|/api/v1/notifications"
fi

export API_BASE TOKEN ENDPOINTS
run_one() {
  local n="$1"
  local IFS='|'
  local paths
  read -r -a paths <<< "$ENDPOINTS"
  local idx=$(( (n - 1) % ${#paths[@]} ))
  local path="${paths[$idx]}"
  local header=()
  if [[ -n "$TOKEN" ]]; then
    header=(-H "Authorization: Bearer $TOKEN")
  fi

  curl -sS -o /dev/null \
    -w "%{http_code}\t%{time_total}\t${path}\n" \
    --max-time 20 \
    "${header[@]}" \
    "$API_BASE$path" 2>/dev/null || echo -e "000\t20.000\t${path}"
}
export -f run_one

seq 1 "$REQUESTS" | xargs -n1 -P "$CONCURRENCY" bash -c 'run_one "$1"' _ > "$RESULTS_FILE"

node - "$RESULTS_FILE" "$MAX_P95_SECONDS" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const maxP95 = Number(process.argv[3]);
const rows = fs.readFileSync(file, 'utf8').trim().split(/\n+/).filter(Boolean).map((line) => {
  const [codeRaw, timeRaw, path] = line.split('\t');
  return { code: Number(codeRaw), time: Number(timeRaw), path };
});

const total = rows.length;
const serverFailures = rows.filter((r) => r.code === 0 || r.code >= 500 || Number.isNaN(r.code));
const times = rows.map((r) => r.time).filter(Number.isFinite).sort((a, b) => a - b);
const percentile = (p) => times.length ? times[Math.min(times.length - 1, Math.ceil((p / 100) * times.length) - 1)] : Infinity;
const avg = times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : Infinity;
const p50 = percentile(50);
const p95 = percentile(95);
const max = times[times.length - 1] ?? Infinity;

const byPath = new Map();
for (const row of rows) {
  const item = byPath.get(row.path) ?? { count: 0, failures: 0, total: 0, max: 0 };
  item.count += 1;
  if (row.code === 0 || row.code >= 500 || Number.isNaN(row.code)) item.failures += 1;
  if (Number.isFinite(row.time)) {
    item.total += row.time;
    item.max = Math.max(item.max, row.time);
  }
  byPath.set(row.path, item);
}

console.log('');
console.log('==> Result');
console.log(`total=${total} server_failures=${serverFailures.length}`);
console.log(`avg=${avg.toFixed(3)}s p50=${p50.toFixed(3)}s p95=${p95.toFixed(3)}s max=${max.toFixed(3)}s`);
console.log('');
console.log('endpoint summary:');
for (const [path, item] of byPath.entries()) {
  const endpointAvg = item.count ? item.total / item.count : 0;
  console.log(`  ${path}: count=${item.count} failures=${item.failures} avg=${endpointAvg.toFixed(3)}s max=${item.max.toFixed(3)}s`);
}

if (serverFailures.length > 0) {
  console.error('');
  console.error('FAIL server errors occurred under load');
  process.exit(1);
}
if (p95 > maxP95) {
  console.error('');
  console.error(`FAIL p95 ${p95.toFixed(3)}s is above target ${maxP95.toFixed(3)}s`);
  process.exit(1);
}

console.log('');
console.log('OK traffic readiness target passed');
NODE
