# SAMS Operations Runbook

**Smart Attendance Management System — Super Admin troubleshooting blueprint**

| Item | Value |
|------|--------|
| Production app | https://app.smart-managment.com |
| Super Admin | https://super.smart-managment.com (school code `SUPERADMIN`) |
| API (direct) | https://api.smart-managment.com |
| VPS path | `/var/www/sams` |
| API port (local) | `3001` |
| PM2 app name | `sams-api` |

Use this when something breaks: **symptom → where to check → commands → fix**.

---

## 1. First response (any outage)

```bash
cd /var/www/sams
pm2 status
curl -sS http://127.0.0.1:3001/health
sudo nginx -t
```

| Health field | Meaning |
|--------------|---------|
| `checks.database: true` | PostgreSQL OK |
| `checks.redis: true` | Redis OK |
| `ai.configured: true` | AI keys loaded |
| `sms.configured: true` | Africa's Talking keys loaded |

If `/health` fails locally → **backend** issue (PM2, env, DB, Redis).  
If local OK but browser fails → **nginx** or **Cloudflare/DNS**.

---

## 2. Site down / blank page / 502

### Symptom: White screen or 502 Bad Gateway

**Check:** PM2 running?

```bash
pm2 status
pm2 logs sams-api --lines 50 --nostream
```

**Fix — start API:**

```bash
cd /var/www/sams
pm2 start ecosystem.config.js --env production --update-env
pm2 save
bash scripts/restart-api.sh
```

**Check:** nginx:

```bash
sudo nginx -t
sudo systemctl status nginx
sudo systemctl reload nginx
```

**Check:** Frontend built?

```bash
ls packages/frontend/dist/index.html
ls packages/super-admin/dist/index.html
```

**Fix — rebuild UI:**

```bash
cd /var/www/sams
npm run build -w @sams/frontend
npm run build -w @sams/super-admin
```

---

## 3. PM2 empty after deploy

### Symptom: `pm2 status` shows no `sams-api` after `deploy-production.sh`

**Cause:** Often junk line in `secrets/providers.env` (e.g. pasted `bash scripts/restart-api.sh#`) executed during env load.

**Check:**

```bash
grep -n "restart-api\|bash \|pm2 \|curl " secrets/providers.env packages/backend/.env
```

**Fix env file:** Only `# comments` and `KEY="value"` lines. Then:

```bash
bash scripts/restart-api.sh
```

**Never paste:** `bash scripts/restart-api.sh#` (trailing `#` breaks the path).

---

## 4. JWT / API crash loop

### Symptom: Logs show `JWT_SECRET must be … 64+ chars`

```bash
bash scripts/set-production-env.sh
bash scripts/restart-api.sh
```

**Check:**

```bash
bash scripts/verify-secrets.sh
```

---

## 5. Redis errors

### Symptom: `%22redis://localhost:6379%22` or `Connection is closed`

**Cause:** `REDIS_URL` has extra quote characters in env file.

**Check:**

```bash
grep REDIS_URL packages/backend/.env secrets/providers.env
redis-cli ping
sudo systemctl status redis-server
```

**Fix — correct line (no doubled quotes):**

```env
REDIS_URL=redis://localhost:6379
```

```bash
sudo systemctl start redis-server
bash scripts/restart-api.sh
```

**Good log line:** `[Redis] Connected` and `Database and Redis connected — API ready`.

---

## 6. Database / migrations

### Symptom: `PlanTier already exists` / migration P3018

**Cause:** Baseline migration on existing DB.

```bash
cd /var/www/sams/packages/backend
npx prisma migrate resolve --rolled-back 20240101000000_init
npx prisma migrate resolve --applied 20240101000000_init
npx prisma migrate deploy
```

Or use:

```bash
cd /var/www/sams
bash scripts/baseline-prisma-init.sh
cd packages/backend && npx prisma migrate deploy
```

### Symptom: Can't connect to database

```bash
grep DATABASE_URL packages/backend/.env
sudo systemctl status postgresql
```

---

## 7. Nginx / uploads / 413 photo error

### Symptom: AI says "Could not send that photo" / HTTP 413

**Cause:** nginx `client_max_body_size` too small on **app** or **super-admin** (not only api subdomain).

**Check:**

```bash
grep -n client_max_body_size /etc/nginx/sites-enabled/sams.conf
```

Need **3 lines** at `25m` (app, api, super).

**Fix:**

```bash
cd /var/www/sams
git pull origin main
sudo cp nginx/sams.conf /etc/nginx/sites-enabled/sams.conf
sudo nginx -t && sudo systemctl reload nginx
npm run build -w @sams/frontend
npm run build -w @sams/super-admin
```

---

## 8. AI not working

### Symptom: Generic AI errors / not configured

```bash
bash scripts/verify-secrets.sh --ai-only
bash scripts/diagnose-ai.sh
curl -sS http://127.0.0.1:3001/health | grep -o '"ai":{[^}]*}'
```

**Keys live in:** `secrets/providers.env` (not git)

Required: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, optional fallback, `VISION_MODEL` for images.

**Groq-only:** Image upload needs OpenRouter fallback — Groq text models don't read images.

```bash
bash scripts/restart-api.sh
```

### Symptom: AI talks but won't execute actions (suspend/unsuspend)

- Use explicit commands: `unsuspend school [name]`, `suspend school [name]`
- Destructive actions need reply **yes**
- Super Admin only for platform actions

### Symptom: Super Admin AI vs school AI

| Panel | URL | Scope |
|-------|-----|--------|
| Super Admin AI | super.smart-managment.com | All schools, licenses, suspend |
| School AI | app.smart-managment.com | One school only |

---

## 9. SMS / OTP

### Symptom: SMS not delivered

```bash
curl -sS http://127.0.0.1:3001/health | grep -o '"sms":{[^}]*}'
```

**Check `providers.env`:**

- `AT_USERNAME=deno1` (dashboard app username, **not** `sams`)
- `AT_API_KEY=atsk_...`
- `AT_SENDER_ID=SAMS` (must be approved in Africa's Talking dashboard)

**OTP flags:**

- `OTP_LOGIN_ENABLED=false` (login without SMS)
- `OTP_PASSWORD_RESET_ENABLED=true` (forgot-password SMS when sender approved)

Until AT approves sender **SAMS**, SMS will fail with `InvalidSenderId` — config can still be correct.

```bash
bash scripts/configure-production-at.sh
bash scripts/restart-api.sh
```

---

## 10. Email

### Symptom: `[Email] SMTP not configured`

Optional. Set in `providers.env`: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, etc.  
In-app notifications work without email.

---

## 11. School suspended / users can't login

### Symptom: `SCHOOL_SUSPENDED` / 403

**Super Admin — unsuspend via AI:**

```text
unsuspend school [School Name]
```

Or Super Admin panel → school → Unsuspend.

**Check DB:**

```bash
cd /var/www/sams/packages/backend
npx prisma studio
# or SQL: SELECT name, "isSuspended" FROM "School";
```

---

## 12. Secrets & env files

| File | Purpose | In git? |
|------|---------|--------|
| `packages/backend/.env` | JWT, DATABASE_URL, PORT | **No** |
| `secrets/providers.env` | AI, AT, SMTP, M-Pesa keys | **No** |
| `secrets/providers.env.example` | Template | Yes |

**Load order:** `.env` → `.env.secrets` → `providers.env` (later wins).

**Before editing secrets:**

```bash
bash scripts/backup-secrets.sh
# or full backup:
bash scripts/backup-production.sh --with-uploads
```

**Repair corrupted providers file:**

```bash
bash scripts/fix-providers-env.sh
bash scripts/verify-secrets.sh
bash scripts/restart-api.sh
```

**Rules:**

- Never commit real keys
- Never paste shell commands into `.env` files
- Only `# comments` and `KEY="value"` lines

---

## 13. Deploy (full)

**Before deploy:**

```bash
cd /var/www/sams
bash scripts/backup-production.sh
```

**Deploy:**

```bash
bash scripts/deploy-production.sh
```

Deploy: backs up env → `git reset --hard origin/main` → rebuilds all packages → prisma migrate → PM2 start → nginx reload → post-deploy verify.

**If deploy fails at restart:**

```bash
pm2 start ecosystem.config.js --env production --update-env
pm2 save
```

**Never use:** `bash scripts/restart-api.sh#`

---

## 14. Backup & restore

**Create backup:**

```bash
bash scripts/backup-production.sh --with-uploads
ls -la backups/production-*
```

**Download to PC (from Windows PowerShell):**

```powershell
scp -r root@182.143.228.182:/var/www/sams/backups/production-YYYYMMDD-HHMMSS "$env:USERPROFILE\Desktop\SAMS-backups\"
```

**Restore:** See `RESTORE.md` inside backup folder.

---

## 15. Super Admin account

```bash
cd /var/www/sams/packages/backend
npm run create-super-admin
# Reset password:
SUPER_ADMIN_FORCE_RESET=true npm run create-super-admin
```

Login: https://super.smart-managment.com — code `SUPERADMIN`.

---

## 16. Log locations

| Log | Path |
|-----|------|
| PM2 stdout | `/var/log/sams/sams-api-out.log` |
| PM2 stderr | `/var/log/sams/sams-api-error.log` |
| PM2 live | `pm2 logs sams-api` |
| Nginx error | `/var/log/nginx/error.log` |

---

## 17. Quick command cheat sheet

```bash
# Status
pm2 status
curl -sS http://127.0.0.1:3001/health

# Restart API (safe)
cd /var/www/sams && bash scripts/restart-api.sh

# Verify secrets
bash scripts/verify-secrets.sh

# Nginx
sudo nginx -t && sudo systemctl reload nginx

# Full deploy
bash scripts/backup-production.sh && bash scripts/deploy-production.sh

# Git update only
cd /var/www/sams && git pull origin main
```

---

## 18. Load this runbook into Super Admin AI

**Option A — Automatic (after deploy):** This file and `docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md` are injected into Super Admin AI context (ops runbook first, then developer book, then platform docs).

**Option B — Knowledge Base (editable in UI):**

1. Super Admin → AI Knowledge (or API `POST /api/v1/super/ai-knowledge`)
2. Category: `ops`
3. Title: `SAMS Operations Runbook`
4. Paste sections you use most (keep under ~8000 chars per entry if splitting)

**Option C — PDF for your desk:** See `docs/README-RUNBOOK-PDF.md`

**Deep reference (architecture & failure modes):** See `docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md` and `docs/README-DEVELOPER-OPS-BOOK-PDF.md` — also auto-injected into Super Admin AI after deploy.

---

## 19. Symptom index

| Symptom | Section |
|---------|---------|
| Site down / 502 | §2 |
| PM2 empty | §3 |
| JWT crash | §4 |
| Redis errors | §5 |
| Migration failed | §6 |
| Photo upload 413 | §7 |
| AI broken | §8 |
| SMS failed | §9 |
| School suspended | §11 |
| Deploy failed | §13 |
| Need backup | §14 |

---

*Last updated for VPS layout `/var/www/sams`, PM2 `sams-api`, nginx multi-subdomain setup.*
