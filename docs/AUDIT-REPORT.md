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
| **Automated gate (this run)** | Backend **304** tests pass · Backend `tsc --noEmit` pass · Builds: shared, backend, frontend, super-admin **pass** · Frontend **14** tests pass |

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

## Local QA pass (2026-06-04)

Full role-by-role audit and automated baseline on Windows dev machine. **No git push** — Denis pushes when ready.

### Per-role status

| Role | Status | Notes |
|------|--------|-------|
| **STUDENT** | PASS | Login, dashboard, `/timetable`, `/sessions/scan`, notifications inbox, AI self-scope, profile/settings; QR uses `getApiErrorMessage` |
| **TEACHER** | PASS | Dashboard **Sign In Students** → `/sessions` (fd1365ab); sessions, manual attendance, class roster, registration links, AI, notifications |
| **HOD** | FIXED | **GET /timetable** now auto-scopes to JWT `departmentId`; dashboard adds **View Timetable** quick action; notifications dept auto-target unchanged (e873beab) |
| **SCHOOL_ADMIN** | PASS | Admin routes, users, departments, school-wide notify, registration links, AI, license paths |
| **SUPER_ADMIN** | PASS | Super-admin SPA routes; suspend/unsuspend including “undo suspension for X” (9a795372); ops/runbook AI context |

### Issues found vs fixed (this pass)

| # | Issue | Fix |
|---|--------|-----|
| 1 | Initial `tsc` failed: `UserWhereInput` has no `isActive` on session student list | Already on `main` as `isLocked: false` (`7e96be84`); verified lint clean |
| 2 | HOD **GET /timetable** returned whole-school entries | `listEntries` + route apply `departmentId` from JWT for HOD |
| 3 | HOD dashboard missing read-only timetable shortcut | Added `/timetable` quick action |
| 4 | Profile avatar upload opaque errors / 413 | `getApiErrorMessage` + explicit 413 hint (nginx 25m) |

**Counts:** 4 issues identified · **3 code fixes** in this session (item 1 pre-committed) · 0 test regressions

### Files changed (this pass)

| File | Change |
|------|--------|
| `packages/backend/src/services/timetableService.ts` | `departmentId` filter on list |
| `packages/backend/src/routes/timetable.ts` | HOD auto-scope on GET |
| `packages/frontend/src/pages/DashboardPage.tsx` | HOD View Timetable link |
| `packages/frontend/src/pages/ProfilePage.tsx` | API error + 413 messaging |
| `docs/AUDIT-REPORT.md` | This section |

### Test commands run and results

| Command | Result |
|---------|--------|
| `npm run lint -w @sams/backend` | **PASS** |
| `npx vitest run --dir packages/backend` | **PASS** — 40 files, **304** tests |
| `npm run lint -w @sams/frontend` | **PASS** |
| `npx vitest run --dir packages/frontend` | **PASS** — 14 tests |
| `npm run lint -w @sams/super-admin` | **PASS** |
| `npm run build -w @sams/shared` | **PASS** |
| `npm run build -w @sams/backend` | **PASS** |
| `npm run build -w @sams/frontend` | **PASS** |
| `npm run build -w @sams/super-admin` | **PASS** |
| `scripts/pre-deploy-check.sh` | **Skipped** (Windows; run on VPS) |

### Pre-push checklist for Denis

1. Review diff: `git log -3 --oneline` and `git diff origin/main` after local commit.
2. On VPS: `cd /var/www/sams && bash scripts/pre-deploy-check.sh`
3. Deploy: `bash scripts/deploy-production.sh` (build-before-PM2-restart per `35504a36`)
4. Run **Top 10 VPS smoke tests** below (15–20 min).
5. Confirm Cloudflare SSL **Full (strict)** if redirect loops (runbook §7).
6. `pm2 logs sams-api --lines 50` — no crash loop.

### Denis — push when ready

```bash
cd /var/www/sams   # or local repo path
git status
git add packages/backend/src/services/timetableService.ts \
        packages/backend/src/routes/timetable.ts \
        packages/frontend/src/pages/DashboardPage.tsx \
        packages/frontend/src/pages/ProfilePage.tsx \
        docs/AUDIT-REPORT.md
git commit -m "fix(hod): scope timetable list to department; polish profile upload errors"
git push origin main
```

Then on VPS: `bash scripts/deploy-production.sh`

### Top 10 manual smoke tests (VPS after deploy)

1. `curl -sS https://app.smart-managment.com/api/v1/health` — AI/SMS/email flags sane.
2. **STUDENT** login → AI: “MY TIME TABLE” → DB-backed slots (not generic).
3. **STUDENT** → Scan QR on active session → attendance recorded.
4. **TEACHER** → Dashboard **Sign In Students** → start session → QR displays.
5. **TEACHER** → Manual attendance for active session → roster loads.
6. **HOD** → Notifications → send to department (no empty dept dropdown).
7. **HOD** → View Timetable → only own department classes (not other depts).
8. **SCHOOL_ADMIN** → Users → create/list; school notification send.
9. **SUPER_ADMIN** (`super.smart-managment.com`) → AI: “undo suspension for &lt;School&gt;” → unsuspend action.
10. Profile photo upload (small JPEG) — no 413; if 413, `grep client_max_body_size /etc/nginx/sites-enabled/sams.conf` (expect 3× `25m`).

### VPS-only / not fully verified locally

- SMS (Africa’s Talking sender ID, sandbox numbers)
- Email SMTP (password reset, lockout alerts)
- OpenAI LLM path with production key (regex/local paths tested in CI)
- Socket.IO through nginx (`/socket.io/` proxy)
- WebAuthn / biometric on real devices
- `pre-deploy-check.sh` Redis/secrets merge
- End-to-end Playwright (no E2E suite in repo)

### Preserved recent fixes (not regressed)

- Attendance flow `fd1365ab` / session response helpers
- AI anti-hallucination `39ab7dc1`
- HOD notifications `e873beab`
- Conversation memory `11fbdce3`
- Deploy safety `35504a36` / pre-deploy bash `5c8b0364`

---

## UI polish pass (2026-06-04)

**Scope:** Frontend and super-admin presentation only. No changes to `packages/backend` routes/services for attendance, AI, or notifications.

### Palette (all school roles + super-admin)

| Before | After |
|--------|-------|
| Teal/cyan/purple/pink neon gradients on dashboards | Indigo + slate primary; emerald/teal reserved for **attendance** CTAs |
| Legacy admin pages (teal/cyan buttons) | Global CSS stitch in `index.css` remaps neon utility classes app-wide |
| Floating AI purple accents | Indigo/slate chat chrome (`FloatingAI.tsx`) |

### Dashboard deduplication

| Surface | Change |
|---------|--------|
| `/admin` (HOD / school admin) | Redirects to `/dashboard` — single command center, no duplicate quick-action grid |
| Admin sub-pages back links | Point to `/dashboard` instead of `/admin` |
| Super-admin dashboard | Removed quick-action tiles that duplicated sidebar nav (Layout in `App.tsx`) |
| Role dashboards | `/dashboard` keeps grouped Quick Actions per role (teacher/HOD/student/admin) |

### Files changed (UI polish)

| File | Change |
|------|--------|
| `packages/frontend/src/index.css` | `btn-attendance`, violet/hover-cyan/shadow neon stitch |
| `packages/frontend/src/pages/DashboardPage.tsx` | Professional stat/action gradients; HOD dept badge indigo |
| `packages/frontend/src/pages/admin/AdminDashboardPage.tsx` | Redirect to `/dashboard` |
| `packages/frontend/src/pages/admin/*` | Back links → `/dashboard` |
| `packages/frontend/src/components/FloatingAI.tsx` | Indigo loading dots; neutral subtitle |
| `packages/super-admin/src/pages/DashboardPage.tsx` | Stats/plan/revenue only; no duplicate quick links |

### Automated checks (UI polish)

| Command | Result |
|---------|--------|
| `npm run lint` (backend, frontend, super-admin) | **PASS** |
| `npx vitest run` (`packages/backend`) | **PASS** — 40 files, **304** tests |
| `npx vitest run` (`packages/frontend`) | **PASS** — 14 tests |
| `npm run build` (shared, backend, frontend, super-admin) | **PASS** |

### UI smoke tests (manual, ~10 min)

1. **SCHOOL_ADMIN** — `/dashboard` shows grouped quick actions; visiting `/admin` lands on same dashboard.
2. **HOD** — Dept badge indigo; timetable/reports/risk links present once on dashboard.
3. **TEACHER** — Emerald “Sign In Students” CTA; attendance quick actions emerald, not neon cyan.
4. **STUDENT** — Scan QR + timetable shortcuts; no duplicate timetable block on dashboard.
5. **Floating AI** — Open widget on dashboard; indigo send button; thread restore still works.
6. **Super-admin** — Sidebar nav only; dashboard shows analytics cards without duplicate link row.
7. **Admin users page** — “Back” goes to `/dashboard`.
8. **Notifications send** (HOD) — unchanged flow; dept target still auto-filled.
9. **Attendance session** (teacher) — start session + QR unchanged.
10. **Profile avatar** — upload error messaging from `e4a158e1` still shows 413 hint.

### Release ready (final pass — 2026-06-04)

| Item | Value |
|------|--------|
| **Pushed to `origin/main`** | `e4a158e1` HOD timetable scope + profile errors · `974465e5` UI palette + dashboard dedup · release chore commit (smoke script, docs, blue-purple token stitch) |
| **Prior remote HEAD** | `7e96be84` |
| **Backend tests** | 40 files, **304** passed |
| **Frontend tests** | 4 files, **14** passed |
| **Lint** | `@sams/backend`, `@sams/frontend`, `@sams/super-admin` — pass |
| **Builds** | shared, backend, frontend, super-admin — pass |

**VPS deploy one-liner:**

```bash
cd /var/www/sams && bash scripts/deploy-production.sh
```

**15-minute smoke checklist (Denis):**

1. `bash scripts/post-deploy-verify.sh` — all critical OK.
2. **SCHOOL_ADMIN** — login → `/dashboard`; open `/admin` → lands on dashboard; Users/Timetable back links → dashboard.
3. **HOD** — timetable list shows department only; send dept notification; profile avatar upload error still readable on 413.
4. **TEACHER** — start session → QR refresh; manual attendance; class-scoped notify.
5. **STUDENT** — scan QR; timetable; AI self-scope question; notifications inbox.
6. **SUPER_ADMIN** — `super.smart-managment.com`; schools list; no duplicate quick links on dashboard.
7. **Floating AI** — open on dashboard; thread restore; indigo accents (no neon cyan buttons).
8. **Health** — `curl -sS https://api.smart-managment.com/health` or local `:3001/health` — DB + redis OK.
9. Optional: `VERIFY_AI_QUERY=1 bash scripts/post-deploy-verify.sh` if quota allows.
10. Optional: `VERIFY_LOGIN_*` + `bash scripts/smoke-production.sh` on VPS.

**Files in final release chore commit:** `scripts/smoke-test-local.sh`, `packages/frontend/src/index.css`, `DOCUMENTATION.md`, `docs/SAMS-OPS-RUNBOOK.md`, `docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md`, `docs/AUDIT-REPORT.md`.

---

*End of audit report.*
