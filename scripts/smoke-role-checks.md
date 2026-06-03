# Production smoke — role checks (VPS)

Run from app root (`/var/www/sams`). No real API keys belong in git.

## One-shot (automated)

```bash
cd /var/www/sams
nvm use
bash scripts/verify-secrets.sh
bash scripts/post-deploy-verify.sh
bash scripts/smoke-production.sh
```

Optional AI guest ping (uses Groq/OpenRouter quota):

```bash
VERIFY_AI_QUERY=1 bash scripts/smoke-production.sh
# or
VERIFY_AI_QUERY=1 bash scripts/post-deploy-verify.sh
```

Optional login + `/users/me` (set test account in shell, not in repo):

```bash
export VERIFY_LOGIN_IDENTIFIER='your-admin@school.com'
export VERIFY_LOGIN_PASSWORD='your-test-password'
bash scripts/smoke-production.sh
```

## Curl reference (localhost API)

```bash
API=http://127.0.0.1:3001

# Health + AI/SMS/OTP block
curl -sS "$API/health" | python3 -m json.tool

# Production AT (not sandbox)
curl -sS "$API/health" | python3 -c "import sys,json; h=json.load(sys.stdin); s=h.get('sms',{}); print('AT production' if s.get('configured') and not s.get('sandbox') else 'check AT_* in secrets/providers.env')"

# Guest AI ping (public route)
curl -sS -X POST "$API/api/v1/ai/query" \
  -H 'Content-Type: application/json' \
  -d '{"question":"Reply with exactly: ok"}'

# Login → token → me (replace credentials)
curl -sS -X POST "$API/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"ADMIN_EMAIL","password":"PASSWORD"}' | tee /tmp/login.json
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['accessToken'])")
curl -sS -H "Authorization: Bearer $TOKEN" "$API/api/v1/users/me"
```

## Manual checks by role

| Role | What to verify |
|------|----------------|
| **SCHOOL_ADMIN** | Login at app URL; Settings → Africa's Talking → **Send test SMS**; AI chat opens |
| **TEACHER** | Timetable / attendance session for assigned class |
| **CLASS_REP** | Student with class-rep flag: class roster; can reply only to teacher messages |
| **STUDENT** | QR scan flow; cannot access admin routes |
| **SUPER_ADMIN** | `https://super.smart-managment.com`, school code `SUPERADMIN` |

## Secrets (never commit)

```bash
bash scripts/backup-secrets.sh          # before deploy / .env edits
bash scripts/verify-secrets.sh          # all providers
bash scripts/configure-production-at.sh # interactive AT sandbox → production
bash scripts/restart-api.sh             # after providers.env changes
```

See `DOCUMENTATION.md` → **Production go-live checklist**.
