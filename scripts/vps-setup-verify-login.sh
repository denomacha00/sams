#!/usr/bin/env bash
# Configure post-deploy login verification creds in packages/backend/.env (no stdout secrets).
#
# Usage:
#   cd /var/www/sams && bash scripts/vps-setup-verify-login.sh
#   cd /var/www/sams && bash scripts/vps-setup-verify-login.sh --identifier 'user@school.com' --password 'secret'
#
# Writes: VERIFY_LOGIN_IDENTIFIER, VERIFY_LOGIN_PASSWORD
# Then runs: bash scripts/post-deploy-verify.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ROOT}/packages/backend/.env"
IDENT=""
PASS=""

usage() {
  echo "Usage: bash scripts/vps-setup-verify-login.sh [--identifier USER] [--password PASS]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --identifier)
      [[ $# -ge 2 ]] || usage
      IDENT="$2"
      shift 2
      ;;
    --password)
      [[ $# -ge 2 ]] || usage
      PASS="$2"
      shift 2
      ;;
    -h | --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

if [[ -z "$IDENT" ]]; then
  read -r -p "VERIFY_LOGIN_IDENTIFIER (email or username): " IDENT
fi
if [[ -z "$PASS" ]]; then
  read -r -s -p "VERIFY_LOGIN_PASSWORD: " PASS
  echo ""
fi

if [[ -z "$IDENT" || -z "$PASS" ]]; then
  echo "ERROR: identifier and password are required" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
echo "==> Backed up .env before edit"

upsert_env() {
  local key="$1"
  local val="$2"
  KEY="$key" VAL="$val" ENV_FILE="$ENV_FILE" node <<'NODE'
const fs = require('fs');
const path = process.env.ENV_FILE;
const key = process.env.KEY;
const val = process.env.VAL;
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const line = `${key}="${esc(val)}"`;
let text = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const lines = text.length ? text.split(/\n/) : [];
let found = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith(`${key}=`)) {
    lines[i] = line;
    found = true;
    break;
  }
}
if (!found) lines.push(line);
fs.writeFileSync(path, lines.join('\n').replace(/\n*$/, '\n'));
NODE
}

upsert_env VERIFY_LOGIN_IDENTIFIER "$IDENT"
upsert_env VERIFY_LOGIN_PASSWORD "$PASS"
echo "==> VERIFY_LOGIN_* configured (password not printed)"

export VERIFY_LOGIN_IDENTIFIER="$IDENT"
export VERIFY_LOGIN_PASSWORD="$PASS"

echo "==> Running post-deploy verification"
bash "$ROOT/scripts/post-deploy-verify.sh"