#!/usr/bin/env bash
# Install Node.js 20 on Ubuntu via NodeSource (no nvm required).
# Idempotent: exits 0 if Node is already 20+.
#
# Usage (on VPS as a user with sudo):
#   cd /var/www/sams && bash scripts/install-node20-ubuntu.sh
#
# After success:
#   node -v   # v20.x.x
#   which node   # typically /usr/bin/node
#   cd /var/www/sams && npm ci && bash scripts/go-live.sh
#
# Alternative (per-user nvm): scripts/upgrade-node20.sh
# See DOCUMENTATION.md §9 — "Upgrading Node.js to 20 on Ubuntu VPS"

set -euo pipefail

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -ge 20 ]]; then
  echo "OK: Node $(node -v) already meets SAMS requirement (20+)."
  exit 0
fi

if [[ "$(uname -s 2>/dev/null || echo unknown)" != "Linux" ]]; then
  echo "ERROR: This script targets Ubuntu/Debian Linux (NodeSource apt)." >&2
  echo "       On other OS, use nvm: bash scripts/upgrade-node20.sh" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "ERROR: apt-get not found — use scripts/upgrade-node20.sh (nvm) instead." >&2
  exit 1
fi

echo "==> Current Node: $(node -v 2>/dev/null || echo 'not found') — installing Node 20 via NodeSource"

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl gnupg

# NodeSource setup_20.x — official Node 20 LTS for Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y -qq nodejs

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ERROR: Node $(node -v) after install — expected 20+" >&2
  exit 1
fi

echo "==> Node installed: $(node -v) ($(command -v node))"
echo "    npm $(npm -v 2>/dev/null || echo '?')"
echo "Next: cd /var/www/sams && npm ci && bash scripts/go-live.sh"
