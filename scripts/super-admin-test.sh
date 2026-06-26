#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> SAMS Super Admin smoke test"
bash scripts/post-deploy-verify.sh

echo
echo "==> Traffic readiness"
REQUESTS="${REQUESTS:-800}" CONCURRENCY="${CONCURRENCY:-40}" bash scripts/traffic-readiness-check.sh
