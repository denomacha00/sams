# SAMS Production Readiness Audit

**Date:** 2026-06-04  
**Auditor:** Cursor agent (Denis-requested comprehensive audit)  
**Production:** `https://app.smart-managment.com` · API via nginx → PM2 `sams-api` · VPS `/var/www/sams`

---

## Executive summary

| Question | Answer |
|----------|--------|
| **Ready for real-world school testing?** | **Yes, with caveats** |
| **Ready for mobile app (API-only client)?** | **Yes** — REST `/api/v1/*` + Socket.IO notifications/attendance are stable contracts |
| **Automated gate (this run)** | Backend **303/303** tests pass · Backend `tsc --noEmit` pass · Builds: shared, backend, frontend, super-admin **pass** · Frontend **12** tests pass |

**Caveats before calling production “done”:**

1. **Denis must smoke-test on VPS** after deploy (login per role, AI data questions, HOD send notification, Cloudflare SSL mode).
2. **SMS** (Africa’s Talking sender ID / sandbox numbers) and **email SMTP** are environment-dependent — not fully verifiable in CI.
3. **OpenAI key** optional for regex/local data paths; LLM fallback returns 401 in dev without key (tests still pass).
4. **Legacy `src/ai/rolepermission.js`** at repo root is obsolete — real RBAC is `packages/backend/src/middleware/rbac.ts`.

---

## Phase 1 — System map

### Monorepo layout

| Package | Role |
|---------|------|
| `packages/shared` | `UserRole`, `AccessTokenPayload`, attendance/GPS utils — consumed by backend + frontends |
| `packages/backend` | Express API, Prisma/PostgreSQL, AI services, jobs, Socket.IO |
| `packages/frontend` | School app (all school roles) — Vite/React |
| `packages/super-admin` | Platform portal (`super.smart-managment.com`) — SUPER_ADMIN only |
| `scripts/` | `deploy-production.sh`, `pre-deploy-check.sh`, env merge, post-deploy verify |

### Backend structure (high level)

- **Routes:** `auth`, `users`, `departments`, `timetable`, `sessions`, `attendance`, `notifications`, `reports`, `riskScores`, `ai`, `knowledge`, `biometric`, `payments`, `superAdmin`, `activation`
- **Middleware:** `authenticate` (JWT), `licenseGuard` (school suspension), `rbac` (`requirePermission`, `enforceSchoolScope`, `requireHODScope`, `requireStudentSelf`)
- **AI:** `aiService` → `localEngine` / `openaiEngine`, `roleActionRegistry`, handlers per role, `conversationMemoryService` (encrypted threads)
- **Prisma:** PostgreSQL schema in `packages/backend/prisma/schema.prisma`

### `UserRole` values and access

| Role | JWT claims | RBAC permissions (`ROLE_PERMISSIONS`) | Primary surfaces |
|------|------------|--------------------------------------|------------------|
| **STUDENT** | `schoolId`, `classId` | `view:timetable`, `view:reports` | Dashboard, timetable, reports, notifications (inbox), AI (self-scope), QR scan |
| **TEACHER** | `schoolId`, `classId` (resolved via `/users/me` if stale) | `start:session`, `mark:attendance`, `view:timetable`, `view:reports`, `manage:knowledge` | Sessions, attendance, class roster, registration links, class-scoped notify |
| **HOD** | `schoolId`, `departmentId` | Same as teacher + `manage:users`, `manage:timetable`, `view:risk`, `manage:knowledge` | Admin subset (users, timetable, departments, risk), HOD department page, dept-scoped notify |
| **SCHOOL_ADMIN** | `schoolId` | `manage:users`, `view:timetable`, `view:reports`, `view:risk`, `manage:payments`, `manage:knowledge` | Full school admin UI, school-wide notify, SMS status (when configured) |
| **SUPER_ADMIN** | Platform school / exempt from suspension | `super:admin`, `view:reports` | Super-admin SPA + platform AI actions (suspend, licenses, audit) |

**School scope:** All authenticated school routes set `req.schoolId` from JWT (`enforceSchoolScope`). Cross-school access blocked via `assertSchoolOwnership`.

**HOD scope:** `requireHODScope` + `scopedNotificationSend` + `resolveHodDepartmentId` enforce department/class targets.

**Student privacy:** `requireStudentSelf` on student-specific report routes.

---

## Phase 2 — Role-by-role checklist

Legend: **PASS** = verified in code + tests · **WARN** = works but needs manual/VPS check · **FAIL** = broken (none remaining after this audit)

### SUPER_ADMIN

| Area | Status | Notes |
|------|--------|-------|
| A. Auth & JWT | PASS | Platform school exempt from `licenseGuard`; suspension checks on school login |
| B. AI actions | PASS | 8 platform actions; patterns normalized; ops/runbook context in `openaiEngine` |
| C. Notifications | N/A | Uses super-admin UI, not school notification send |
| D. Core features | PASS | Schools, suspend/unsuspend, licenses, audit, revenue — `routes/superAdmin.ts` |
| E. Frontend | PASS | `packages/super-admin` routes behind `AuthGuard` |

### SCHOOL_ADMIN

| Area | Status | Notes |
|------|--------|-------|
| A. Auth & JWT | PASS | `schoolId` on token; suspended school blocked at login/refresh |
| B. AI actions | PASS | User/class/dept management, stats, password reset, scoped notifications |
| C. Notifications | PASS | School/dept/class send; SMS channel gated to admin/HOD in UI |
| D. Core features | PASS | User mgmt, departments, timetable, risk, payments hooks |
| E. Frontend | PASS | `/admin/*` routes; API uses `manage:users` permission |

### HOD

| Area | Status | Notes |
|------|--------|-------|
| A. Auth & JWT | PASS | `departmentId` required for dept scope; 403 if unlinked |
| B. AI actions | PASS | Dept stats, add teacher, registration links, dept/class notify, `list_school_admin` |
| C. Notifications | PASS | Auto `targetId` from profile; no cross-dept picker when scoped (`NotificationsPage` + `scopedNotificationSend`) |
| D. Core features | PASS | Timetable gen (with `manage:timetable`), department page |
| E. Frontend | PASS | HOD admin routes + `/hod/department` |

### TEACHER

| Area | Status | Notes |
|------|--------|-------|
| A. Auth & JWT | PASS | `classId` on token; `/users/me` refresh in notifications UI if stale |
| B. AI actions | PASS | Sessions, attendance, roster, class message, registration link, `list_school_admin` |
| C. Notifications | PASS | Class scope auto-filled; cannot send school-wide |
| D. Core features | PASS | Attendance mark, class view |
| E. Frontend | PASS | Teacher routes under `AuthGuard` |

### STUDENT

| Area | Status | Notes |
|------|--------|-------|
| A. Auth & JWT | PASS | `classId`; self-only guards on reports |
| B. AI actions | PASS | Timetable, attendance view, my teachers/HOD, class rep, explain_reminders |
| C. Notifications | PASS | Inbox + class rep reply path |
| D. Core features | PASS | Timetable, reports (self), QR session scan |
| E. Frontend | PASS | AI thread restore via `loadAiThreadId` / `GET /ai/conversations/:threadId` |

---

## Phase 3 — Automated checks (2026-06-04)

| Check | Result |
|-------|--------|
| `npm run lint` (`@sams/backend` — `tsc --noEmit`) | **PASS** |
| `npx vitest run` (`packages/backend`) | **PASS** — 39 files, **303** tests |
| `npm test` (`packages/frontend`) | **PASS** — **12** tests |
| `npm run build -w @sams/shared` | **PASS** |
| `npm run build -w @sams/backend` | **PASS** |
| `npm run build -w @sams/frontend` | **PASS** |
| `npm run build -w @sams/super-admin` | **PASS** |
| `pre-deploy-check.sh` on Windows | **Skipped** (bash/VPS); script reviewed — line 72 uses safe `${REDIS_MERGED:0:1}` quote check |

---

## Phase 4 — Known regression items

| # | Item | Status |
|---|------|--------|
| 1 | `normalizeActionPatterns` — no iterable crash | **PASS** — `roleActionRegistry.ts` + `actionIntentDetector.ts` + test |
| 2 | Conversation decrypt skip + frontend history restore | **PASS** — `conversationMemoryService.ts`, `aiChat.ts`, `AIAssistantPage` / `FloatingAI`, commit `11fbdce3` |
| 3 | HOD notifications auto `targetId` | **PASS** — `NotificationsPage.tsx` + `scopedNotificationSend.ts` |
| 4 | HOD/TEACHER `list_school_admin` via `roleContextQuery` | **PASS** — `roleContextQuery.ts` + tests |
| 5 | Timetable “MY TIME TABLE” patterns | **PASS** — `timetableQuery.ts` + tests |
| 6 | Anti-hallucination `data_not_found` | **PASS** — `dataQueryRouter.ts`, `aiService.ts`, tests |
| 7 | `pre-deploy-check.sh` bash compatible | **PASS** — commit `5c8b0364` |
| 8 | `deploy-production.sh` build before `pm2 delete` | **PASS** — lines 78–84 build, 169 restart |
| 9 | nginx runbook Cloudflare **Full (strict)** | **PASS** — `docs/SAMS-OPS-RUNBOOK.md` §7 |

---

## Phase 5 — Issues found and fixed in this audit

| Issue | Fix |
|-------|-----|
| Super Admin AI phrase **“undo suspension for &lt;school&gt;”** did not match regex (`suspend(?:sion)?` ≠ word *suspension*) | Updated `unsuspend_school` patterns in `superAdminHandlers.ts` to `(?:suspension\|suspend)` |

---

## Known remaining gaps (not blockers for pilot)

- **SMS:** Africa’s Talking sender ID, sandbox allowlist, production billing — configure in `secrets/providers.env` / `.env.secrets`.
- **Email:** SMTP for password reset / lockout alerts — `isEmailConfigured()` in health; verify on VPS.
- **SCHOOL_ADMIN AI:** No `create_registration_link` in registry (teachers/HOD have it) — use Registration Links UI or add action later.
- **Bundle size:** Frontend chunk &gt;500 kB — performance WARN only.
- **E2E:** No Playwright/Cypress suite — manual role matrix on staging still required.

---

## Mobile app readiness

| Capability | API | Notes |
|------------|-----|-------|
| Login / refresh / logout | `POST /api/v1/auth/*` | Store refresh token securely (Keychain/Keystore) |
| Role-scoped data | JWT `role`, `schoolId`, `departmentId`, `classId` | Refresh profile via `GET /users/me` after login |
| Timetable, attendance, reports | REST under `/api/v1` | Same RBAC as web |
| Notifications | REST + **Socket.IO** (`notification:new`) | Pass `auth: { token: accessToken }` |
| AI chat | `POST /api/v1/ai/query`, thread APIs | Optional; not required for MVP mobile |
| Super Admin | Separate host `super.smart-managment.com` | Different SPA; same API prefix `/api/v1/super/*` |

Recommended mobile stack: any HTTP client + socket.io-client; no coupling to Vite/React web bundles.

---

## VPS deploy command (Denis)

On the server (already at `/var/www/sams`):

```bash
cd /var/www/sams && bash scripts/deploy-production.sh
```

The script runs `git fetch` + `git reset --hard origin/main`, rebuilds all packages, runs Prisma migrate, pre-deploy checks, then `pm2 delete sams-api` / `pm2 start` and nginx reload.

**After deploy — manual smoke (15 min):**

1. `curl -sS https://app.smart-managment.com/api/v1/health` — expanded health (AI, OTP, SMS flags).
2. Login as **STUDENT** → “MY TIME TABLE” in AI → DB-backed answer.
3. Login as **HOD** → Notifications → send to department (no empty dept dropdown).
4. Cloudflare SSL = **Full (strict)** if redirect loops (see runbook §7).
5. `pm2 logs sams-api --lines 50` — no crash loop.

---

## Appendix — AI action inventory (registry)

| Role | Actions (count) |
|------|-----------------|
| SUPER_ADMIN | 8 — suspend/unsuspend, license, extend, school info, system stats, reset password, clear audit |
| SCHOOL_ADMIN | 9 — add/remove user, class, dept, stats, reset password, 3× notify scopes |
| HOD | 6 — add teacher, dept stats, 2× notify, list school admin, registration link |
| TEACHER | 7 — session start/end, mark attendance, roster, class message, list school admin, registration link |
| STUDENT | 10 — timetable, schedule, attendance, teachers, HOD, admin, class/dept describe, class rep, reminders |

All registered actions are normalized to `patterns: RegExp[]` at registry load time.

---

*End of audit report.*
