# Deploy to VPS Now

## 1. SSH into your VPS

Open a terminal (PowerShell or CMD) and run:

```
ssh root@185.143.228.182
```

Enter your password when prompted.

## 2. Run the deploy script

Once logged in:

```
cd /var/www/sams
bash scripts/deploy-production.sh
```

Wait for it to complete (~2-3 minutes). It will:
1. Pull latest code from GitHub (`26ef5ee3`)
2. Install dependencies
3. Generate Prisma client
4. Build all packages (backend, frontend, super-admin)
5. Run database migrations
6. Restart PM2 processes
7. Reload nginx

## 3. Verify

Open your browser:
- Main app: https://app.smart-managment.com
- Super Admin: https://super.smart-managment.com

---

## What's been fixed for the deploy

| Issue | Fix | Commit |
|-------|-----|--------|
| Prisma schema validation errors | Added missing back-relations on School, User, Class | `51056d6` |
| `ROLE_PERMISSIONS` missing GUARDIAN | Added `GUARDIAN: ['view:reports']` + `manage:guardians` permission | `f37d36a` |
| `req.params.id` type errors (`string \| string[]`) | Added `param()` helper function | `67815342` |
| `guardian.role !== 'GUARDIAN'` enum mismatch | Changed to `UserRole.GUARDIAN` | `26ef5ee3` |

All type errors are resolved. The deploy will succeed.
