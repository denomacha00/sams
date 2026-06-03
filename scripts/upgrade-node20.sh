#!/usr/bin/env bash
# Idempotent Node 20 upgrade for SAMS VPS (via nvm).
# Safe to re-run: exits 0 immediately if Node is already 20+.
#
# Usage:
#   cd /var/www/sams && bash scripts/upgrade-node20.sh
#
# After success:
#   npm ci && bash scripts/deploy-production.sh
#
# See DOCUMENTATION.md §9 — "Upgrading Node.js to 20 on Ubuntu VPS"

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -ge 20 ]]; then
  echo "OK: Node $(node -v) already meets SAMS requirement (20+)."
  exit 0
fi

echo "==> Current Node: $(node -v 2>/dev/null || echo 'not found') — upgrading to 20 via nvm"

load_nvm() {
  if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    return 0
  fi
  if command -v nvm >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

if ! load_nvm; then
  echo "WARN: nvm is not installed or not loaded in this shell." >&2
  echo "" >&2
  echo "Install nvm, then re-run this script:" >&2
  echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash" >&2
  echo "  source ~/.bashrc" >&2
  echo "  cd /var/www/sams && bash scripts/upgrade-node20.sh" >&2
  echo "" >&2
  echo "Or see DOCUMENTATION.md §9 — Upgrading Node.js to 20 on Ubuntu VPS" >&2
  exit 1
fi

echo "==> Installing Node 20 (nvm)"
nvm install 20
nvm use 20
nvm alias default 20

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ERROR: Node $(node -v) after nvm install — expected 20+" >&2
  exit 1
fi

echo "==> Node upgraded: $(node -v) ($(which node))"
echo "Next: cd /var/www/sams && npm ci && bash scripts/deploy-production.sh"
