#!/usr/bin/env bash
# Automated backup: runs the full production backup, rotates old copies, and
# (if configured) pushes each backup off-server to Cloudflare R2 / any S3 bucket.
#
# This is the script cron should call nightly. It is safe to run by hand too.
#
# ─── One-time VPS setup ───────────────────────────────────────────────────────
#   1. Install rclone:            curl https://rclone.org/install.sh | sudo bash
#   2. Configure an R2 remote:    rclone config
#        - n) new remote, name it e.g. "r2"
#        - Storage: "Cloudflare R2" (or S3 → provider Cloudflare)
#        - Paste the R2 Access Key ID + Secret from the Cloudflare dashboard
#          (R2 → Manage R2 API Tokens → Create API Token, "Object Read & Write")
#        - endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
#   3. Create a bucket in the Cloudflare R2 dashboard, e.g. "sams-backups"
#   4. In packages/backend/.env (or secrets/providers.env) set:
#        BACKUP_R2_REMOTE="r2:sams-backups"      # rclone remote:bucket[/path]
#        BACKUP_RETENTION_LOCAL="14"             # local copies to keep (optional)
#        BACKUP_RETENTION_REMOTE_DAYS="30"       # delete remote copies older than N days (optional)
#   5. Test once:                 bash scripts/backup-offsite.sh
#   6. Schedule nightly (2:17am): run `crontab -e` and add:
#        17 2 * * * cd /var/www/sams && /usr/bin/bash scripts/backup-offsite.sh >> /var/log/sams/backup.log 2>&1
#
# If BACKUP_R2_REMOTE is not set, the script still runs + rotates LOCAL backups
# and just warns that no offsite copy was made — so it is safe before R2 is ready.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/merged-env.sh
source "$ROOT/scripts/lib/merged-env.sh"
MERGED_ENV_ROOT="$ROOT"
MERGED_ENV_FILE="$ROOT/packages/backend/.env"

# Config (env overrides merged .env; merged .env overrides defaults)
R2_REMOTE="${BACKUP_R2_REMOTE:-$(read_merged_env BACKUP_R2_REMOTE)}"
RETAIN_LOCAL="${BACKUP_RETENTION_LOCAL:-$(read_merged_env BACKUP_RETENTION_LOCAL)}"
RETAIN_REMOTE_DAYS="${BACKUP_RETENTION_REMOTE_DAYS:-$(read_merged_env BACKUP_RETENTION_REMOTE_DAYS)}"
RETAIN_LOCAL="${RETAIN_LOCAL:-14}"
RETAIN_REMOTE_DAYS="${RETAIN_REMOTE_DAYS:-30}"
BACKUP_ROOT="${SAMS_BACKUP_DIR:-$ROOT/backups}"

# Guard: retention counts must be sane positive integers, else fall back.
[[ "$RETAIN_LOCAL" =~ ^[0-9]+$ && "$RETAIN_LOCAL" -ge 1 ]] || RETAIN_LOCAL=14
[[ "$RETAIN_REMOTE_DAYS" =~ ^[0-9]+$ && "$RETAIN_REMOTE_DAYS" -ge 1 ]] || RETAIN_REMOTE_DAYS=30

echo "==> [$(date -Iseconds)] SAMS automated backup starting"

# ─── 1. Create the backup (delegates to the existing, well-tested script) ─────
bash "$ROOT/scripts/backup-production.sh" "$@"

# Newest production-* directory is the one we just made.
LATEST="$(ls -dt "$BACKUP_ROOT"/production-* 2>/dev/null | head -1 || true)"
if [[ -z "$LATEST" || ! -d "$LATEST" ]]; then
  echo "ERROR: no backup directory found under $BACKUP_ROOT — aborting" >&2
  exit 1
fi
echo "    latest backup: $LATEST"

# ─── 2. Offsite copy to R2 / S3 (if configured) ──────────────────────────────
if [[ -z "$R2_REMOTE" ]]; then
  echo "WARN: BACKUP_R2_REMOTE not set — backup stays LOCAL ONLY (a disk failure would lose it)." >&2
  echo "      Configure R2 per the header of this script to enable off-server copies."
elif ! command -v rclone >/dev/null 2>&1; then
  echo "WARN: rclone not installed — cannot push offsite. Install: curl https://rclone.org/install.sh | sudo bash" >&2
else
  DEST_PATH="${R2_REMOTE%/}/$(basename "$LATEST")"
  echo "    uploading → $DEST_PATH"
  rclone copy "$LATEST" "$DEST_PATH" --transfers 4 --checksum
  echo "    OK  offsite copy complete"

  # Prune remote copies older than the retention window.
  echo "    pruning remote backups older than ${RETAIN_REMOTE_DAYS}d"
  rclone delete "${R2_REMOTE%/}/" --min-age "${RETAIN_REMOTE_DAYS}d" 2>/dev/null || true
  rclone rmdirs "${R2_REMOTE%/}/" --leave-root 2>/dev/null || true
fi

# ─── 3. Rotate local backups (keep newest RETAIN_LOCAL) ───────────────────────
# Timestamped names (production-YYYYMMDD-HHMMSS) sort chronologically, so we can
# keep the newest N by name and delete the rest. Only ever touches production-*.
mapfile -t ALL_LOCAL < <(ls -dt "$BACKUP_ROOT"/production-* 2>/dev/null || true)
if (( ${#ALL_LOCAL[@]} > RETAIN_LOCAL )); then
  echo "    rotating local backups: keeping newest ${RETAIN_LOCAL} of ${#ALL_LOCAL[@]}"
  for ((i = RETAIN_LOCAL; i < ${#ALL_LOCAL[@]}; i++)); do
    old="${ALL_LOCAL[$i]}"
    # Safety: only delete paths under BACKUP_ROOT that match the backup pattern.
    case "$old" in
      "$BACKUP_ROOT"/production-*)
        rm -rf "$old"
        echo "      removed $(basename "$old")"
        ;;
    esac
  done
else
  echo "    local backups: ${#ALL_LOCAL[@]} (within retention of ${RETAIN_LOCAL}, nothing to rotate)"
fi

echo "==> [$(date -Iseconds)] SAMS automated backup finished OK"
