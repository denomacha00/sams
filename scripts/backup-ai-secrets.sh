#!/usr/bin/env bash
# Deprecated — use scripts/backup-secrets.sh (backs up all provider keys, not only OPENAI_*).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-secrets.sh" "$@"
