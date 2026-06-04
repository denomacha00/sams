# Denis — Attendance & Biometric Manual Test (VPS)

Run after deploy (`prisma migrate deploy`, backend + frontend build, nginx reload). Test **one role at a time** and record pass/fail.

## Prerequisites (all roles)

| Check | Expected |
|-------|----------|
| School **not suspended** | Login works; no `SCHOOL_SUSPENDED` |
| Timetable has **today’s periods** for test class | Teacher/HOD see class in Sign In Students |
| License **Professional or Enterprise** (biometric) | `GET /biometric/templates/check-access` → 200 |
| At least **2 students** in class; one with **GPS attendance permission** if testing exempt | User Management → Edit student |
| Students **enrolled** for face scan | Settings / `/biometric/enroll` — templates exist for class |
| HTTPS (or localhost) | Geolocation + WebAuthn work in browser |

**VPS quick verify**

```bash
curl -s https://app.smart-managment.com/health | head
```

**Common failures**

- `FEATURE_NOT_AVAILABLE` / 403 on biometric → upgrade school license in Super Admin
- No active session on face scan → teacher must **Start Session** first
- No match / low confidence → re-enroll student face; better lighting; hold teacher phone steady toward student

---

## 1. Student (mobile + web)

**Device:** Student’s own phone (mobile app) or browser.

| Step | Action | Expected API / UI |
|------|--------|-------------------|
| 1.1 | Log in as student (mobile: school code + credentials) | `POST /auth/login` → tokens; home shows **Scan QR** |
| 1.2 | Teacher has **active session** (see §2) | — |
| 1.3 | Mobile → **Scan QR** (or web Scan QR) | Camera permission; scan teacher QR |
| 1.4 | Submit scan | `POST /attendance/qr` → 201; success message |
| 1.5 | Session with **Require GPS ON**, student **without** exempt, far away | `GPS_OUT_OF_RANGE` or equivalent error |
| 1.6 | Same student with **GPS attendance permission** ON, far away | `POST /attendance/qr` → success |
| 1.7 | Teacher **Share Attendance Link** → student opens `/attend/:token` logged in | `POST /attendance/link` → success |
| 1.8 | Student opens **Face attendance** (if visible) | Should **not** mark via student self-scan; face flow is teacher-only |

**Fixes:** wrong API URL in mobile `.env` → set `EXPO_PUBLIC_API_URL`; OTP-only account → use web for OTP login.

---

## 2. Teacher (web + mobile)

**Device:** Teacher phone for **face scan**; web for session/QR/manual.

| Step | Action | Expected API / UI |
|------|--------|-------------------|
| 2.1 | **Sign In Students** → today’s class → **Require GPS OFF** → **Start Session** | `POST /sessions` → 201; active session |
| 2.2 | Show QR; student scans (§1) | Student present in session list |
| 2.3 | **Mark Attendance** → manual present/late/absent | `mark:attendance` succeeds |
| 2.4 | Web → **Face Scan** `/biometric/attendance` | Models load; session id bound; scan student face → `POST /biometric/match` → student name + present |
| 2.5 | Mobile → **Face attendance** (banner or quick action) | `expo-camera` + face-api bridge → `POST /biometric/match`; same match behavior as 2.4 |
| 2.6 | **End Session** | Session inactive; student QR rejected |
| 2.7 | Session **GPS ON** + radius; student in range | QR success; out of range fails unless exempt |
| 2.8 | **Settings** → register passkey → logout → **Sign in with Fingerprint** | WebAuthn login; dashboard loads |

**Fixes:** “No active session” on face scan → complete 2.1; “Face models still loading” → wait for CDN models on first open; no match → student must be enrolled at `/biometric/enroll`.

---

## 3. HOD (same as teacher when teaching)

HOD must appear as `teacherId` on **timetable entry** for the period.

| Step | Action | Expected API / UI |
|------|--------|-------------------|
| 3.1 | HOD → **Sign In Students** (dashboard + Attendance) | Same as teacher 2.1 |
| 3.2 | Start session, QR, manual mark | No 403; `teacherId` = HOD user id on session |
| 3.3 | Web + mobile **Face attendance** | `GET /sessions?isActive=true&teacherId=<hodId>` returns session; match works |
| 3.4 | Department screens (users, reports) | Do **not** block attendance APIs |

**Fixes:** 403 on session start → HOD not on timetable for that slot; add timetable row with HOD as teacher.

---

## 4. School admin

| Step | Action | Expected API / UI |
|------|--------|-------------------|
| 4.1 | **Manage Users** → enable **GPS attendance permission** on test student | Field saved; student exempt from radius |
| 4.2 | View attendance reports / exports | Read-only; no `mark:attendance` on admin account for QR/face |
| 4.3 | Admin does not start class QR session | `start:session` denied or UI hidden |

---

## 5. Class rep (if role exists in school)

| Step | Action | Expected API / UI |
|------|--------|-------------------|
| 5.1 | Log in as class rep | Mobile home shows role-appropriate actions only |
| 5.2 | If rep has `mark:attendance` | Same constraints as teacher for that class scope |
| 5.3 | If rep is student-like | QR scan only on own phone; no face scan nav |

---

## 6. Biometric enroll (before face scan)

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Teacher enrolls student face (web enroll flow) | `POST /biometric/enroll` → 201 |
| 6.2 | `GET /biometric/templates/:classId` | Non-empty for class |
| 6.3 | Match unknown face | `matched: false`; no attendance row |

---

## 7. Suspend sanity (regression)

| Step | Action | Expected |
|------|--------|----------|
| 7.1 | Super admin suspend school | Active users kicked; refresh fails `SCHOOL_SUSPENDED` |
| 7.2 | Unsuspend | User must **log in again** (no ghost session) |

---

## VPS deploy (quick)

```bash
cd /path/to/SAMS
git pull origin main
cd packages/backend && npx prisma migrate deploy
cd ../..
npm ci
npm run build -w @sams/shared
npm run build -w @sams/backend
npm run build -w @sams/frontend
sudo systemctl restart sams-api
sudo nginx -s reload
```

Record pass/fail per section in your ops log.
