#!/usr/bin/env bash
# Deprecated alias — use scripts/verify-secrets.sh (checks AI + AT + more).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify-secrets.sh" --ai-only
