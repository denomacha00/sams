#!/usr/bin/env bash
# Normalize and dedupe User phones per school, then ensure partial unique index exists.
# Use when migrate deploy fails with duplicate (schoolId, phone) or for pre-migrate cleanup.
#
#   cd /var/www/sams && bash scripts/fix-duplicate-phones.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/packages/backend/.env}"
SQL_FILE="$ROOT/scripts/fix-duplicate-phones.sql"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "ERROR: Missing $SQL_FILE" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL not set. Export it or set ENV_FILE to backend .env." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install postgresql-client." >&2
  exit 1
fi

echo "==> Running fix-duplicate-phones.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE"
