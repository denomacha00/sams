# VPS one-shot scripts (Denis)

Executable bash scripts live in `scripts/`. After they are committed, **`git pull` on the VPS is enough** — no separate copy step unless you use a partial checkout.

| Path on VPS | `/var/www/sams` (override with `SAMS_ROOT`) |
|-------------|---------------------------------------------|

**Never commit** real `packages/backend/.env`, `secrets/providers.env`, or verify passwords.

---

## Quick commands (copy-paste on VPS)

```bash
cd /var/www/sams
git pull origin main

# Full deploy chain (backup → migrate → deploy → verify → nginx → pm2)
bash scripts/vps-full-deploy.sh

# Attendance + biometric API smoke
bash scripts/vps-attendance-smoke.sh

# Master: deploy + smoke + checklist
bash scripts/vps-import-bundle.sh

# Set verify-login creds in .env (no password printed) + post-deploy verify
bash scripts/vps-setup-verify-login.sh
# Or non-interactive (password may appear in process list briefly):
bash scripts/vps-setup-verify-login.sh --identifier 'user@example.com' --password 'your-password'
```

First-time server setup (env, DB, certbot, providers) is still documented in `docs/SAMS-OPS-RUNBOOK.md`.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `vps-full-deploy.sh` | Backup, `prisma migrate deploy`, `deploy-production.sh`, `post-deploy-verify.sh`, optional nginx reload if `sams.conf` exists, PM2 summary |
| `vps-attendance-smoke.sh` | `/health`, biometric dist + `POST .../biometric/match`, attendance routes; optional login if `VERIFY_LOGIN_*` set |
| `vps-setup-verify-login.sh` | Writes `VERIFY_LOGIN_IDENTIFIER` / `VERIFY_LOGIN_PASSWORD` into `packages/backend/.env` (with backup), runs post-deploy verify |
| `vps-import-bundle.sh` | Runs full deploy + attendance smoke; lists remaining manual steps |

Existing scripts (`deploy-production.sh`, `post-deploy-verify.sh`, `set-production-env.sh`, `backup-production.sh`) are unchanged; VPS scripts orchestrate them.

---

## Environment variables (optional)

| Variable | Used by |
|----------|---------|
| `SAMS_ROOT` | Default `/var/www/sams` for `vps-full-deploy.sh` |
| `API_URL` | Attendance smoke (default `http://127.0.0.1:3001`) |
| `PORT` | Attendance smoke if `API_URL` unset |
| `VERIFY_LOGIN_IDENTIFIER` / `VERIFY_LOGIN_PASSWORD` | Smoke + post-deploy verify (or set via `vps-setup-verify-login.sh`) |

---

## See also

- [SAMS-OPS-RUNBOOK.md](./SAMS-OPS-RUNBOOK.md) — outages, JWT, nginx, PM2
- [DENIS-ATTENDANCE-MANUAL-TEST.md](./DENIS-ATTENDANCE-MANUAL-TEST.md) — attendance QA flows