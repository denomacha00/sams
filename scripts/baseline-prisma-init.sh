#!/usr/bin/env bash
# Mark 20240101000000_init as applied on databases that existed before the baseline
# migration was added (schema already present — avoids PlanTier already exists / P3018).
#
# Usage:
#   cd /var/www/sams && bash scripts/baseline-prisma-init.sh
#   # or from repo root during deploy

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/packages/backend"
ENV_FILE="$BACKEND/.env"
INIT_MIGRATION="20240101000000_init"

cd "$BACKEND"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "baseline-prisma-init: DATABASE_URL not set — skipping" >&2
  exit 0
fi

schema_exists() {
  echo 'SELECT 1 FROM "User" LIMIT 1' | npx prisma db execute --stdin --schema=prisma/schema.prisma >/dev/null 2>&1
}

if ! schema_exists; then
  echo "baseline-prisma-init: fresh database (no User table) — nothing to baseline"
  exit 0
fi

echo "==> Baselining ${INIT_MIGRATION} on existing database (schema already present)"

set +e
# Clear failed migration state (P3018) so init can be marked applied without re-running SQL.
npx prisma migrate resolve --rolled-back "$INIT_MIGRATION" 2>/dev/null
npx prisma migrate resolve --applied "$INIT_MIGRATION"
resolve_exit=$?
set -e

if [[ "$resolve_exit" -ne 0 ]]; then
  echo "baseline-prisma-init: resolve --applied returned $resolve_exit (may already be applied)" >&2
fi

echo "==> Baseline complete — continue with: npx prisma migrate deploy"
