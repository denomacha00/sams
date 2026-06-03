#!/usr/bin/env bash
# Full production backup: provider secrets + PostgreSQL + optional uploads.
# Does NOT print secret values. Safe to run before deploy or risky edits.
#
# Usage (on VPS):
#   cd /var/www/sams && bash scripts/backup-production.sh
#   cd /var/www/sams && bash scripts/backup-production.sh --with-uploads
#
# Backups land in: /var/www/sams/backups/production-YYYYMMDD-HHMMSS/
# Copy that folder off-server (encrypted) for disaster recovery.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_UPLOADS=false
for arg in "$@"; do
  case "$arg" in
    --with-uploads) WITH_UPLOADS=true ;;
    -h | --help)
      echo "Usage: bash scripts/backup-production.sh [--with-uploads]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${SAMS_BACKUP_DIR:-$ROOT/backups}"
DEST="${BACKUP_ROOT}/production-${STAMP}"

mkdir -p "$DEST"
chmod 700 "$BACKUP_ROOT" "$DEST"

echo "==> SAMS production backup → $DEST"

# ─── 1. Provider secrets (via existing script) ───────────────────────────────
bash "$ROOT/scripts/backup-secrets.sh"
LATEST_SECRETS="$(ls -t "$ROOT/secrets"/providers.env.backup.* 2>/dev/null | head -1 || true)"
if [[ -n "$LATEST_SECRETS" && -f "$LATEST_SECRETS" ]]; then
  cp "$LATEST_SECRETS" "$DEST/providers.env"
  chmod 600 "$DEST/providers.env"
  echo "    OK  secrets → providers.env"
else
  echo "WARN: No secrets backup found" >&2
fi

# ─── 2. Non-secret .env snapshot (JWT, DATABASE_URL shape — redact in manifest) ─
ENV_FILE="$ROOT/packages/backend/.env"
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$DEST/backend.env.snapshot"
  chmod 600 "$DEST/backend.env.snapshot"
  echo "    OK  packages/backend/.env snapshot (keep off-server; contains DB URL + JWT)"
fi

# ─── 3. PostgreSQL dump ──────────────────────────────────────────────────────
# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ENV_FILE"
DATABASE_URL="$(read_merged_env DATABASE_URL)"

if [[ -z "$DATABASE_URL" ]]; then
  echo "WARN: DATABASE_URL not set — skipping database dump" >&2
elif ! command -v pg_dump >/dev/null 2>&1; then
  echo "WARN: pg_dump not installed — skipping database dump" >&2
else
  echo "    … dumping database (this may take a minute)"
  pg_dump "$DATABASE_URL" -Fc -f "$DEST/database.dump"
  chmod 600 "$DEST/database.dump"
  echo "    OK  database → database.dump"
fi

# ─── 4. Optional uploads (avatars) ───────────────────────────────────────────
UPLOADS_ROOT="${UPLOADS_DIR:-/var/www/sams/uploads}"
if [[ "$WITH_UPLOADS" == true && -d "$UPLOADS_ROOT" ]]; then
  tar -czf "$DEST/uploads.tar.gz" -C "$(dirname "$UPLOADS_ROOT")" "$(basename "$UPLOADS_ROOT")"
  chmod 600 "$DEST/uploads.tar.gz"
  echo "    OK  uploads → uploads.tar.gz"
fi

# ─── 5. Manifest ─────────────────────────────────────────────────────────────
cat >"$DEST/RESTORE.md" <<EOF
# SAMS backup ${STAMP}

Created: $(date -Iseconds)
Host: $(hostname 2>/dev/null || echo unknown)

## Restore order

1. **Secrets**
   \`\`\`bash
   cp providers.env /var/www/sams/secrets/providers.env
   chmod 600 /var/www/sams/secrets/providers.env
   \`\`\`

2. **Backend .env** (if needed)
   \`\`\`bash
   cp backend.env.snapshot /var/www/sams/packages/backend/.env
   chmod 600 /var/www/sams/packages/backend/.env
   \`\`\`

3. **Database**
   \`\`\`bash
   pg_restore -d "\$DATABASE_URL" --clean --if-exists database.dump
   # Or create empty DB first, then:
   # pg_restore -d postgresql://user:pass@host:5432/sams_dev --no-owner database.dump
   \`\`\`

4. **Uploads** (if uploads.tar.gz present)
   \`\`\`bash
   tar -xzf uploads.tar.gz -C /var/www/sams
   \`\`\`

5. **Application**
   \`\`\`bash
   cd /var/www/sams
   bash scripts/deploy-production.sh
   # or: bash scripts/restart-api.sh
   \`\`\`

## Verify
\`\`\`bash
curl -sS http://127.0.0.1:3001/health
pm2 status
\`\`\`
EOF
chmod 600 "$DEST/RESTORE.md"

echo ""
echo "==> Backup complete: $DEST"
echo "    Copy this folder off-server (encrypted USB / secure storage)."
echo "    Restore guide: $DEST/RESTORE.md"
ls -la "$DEST"
