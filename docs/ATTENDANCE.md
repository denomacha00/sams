# SAMS Attendance & Biometric — Core Reference

Last verified: 2026-06-04 (HOD teacher parity, GPS controls, student GPS permission).

## Roles & permissions

| Permission | TEACHER | HOD | SCHOOL_ADMIN | STUDENT |
|------------|---------|-----|--------------|---------|
| `start:session` | yes | yes | no* | no |
| `mark:attendance` | yes | yes | no* | no |
| QR scan (`POST /attendance/qr`) | no | no | no | yes (authenticated) |
| Link sign-in (`POST /attendance/link`) | no | no | no | yes |
| Link generate (`POST /attendance/link/generate`) | yes | yes | no* | no |

\* Admins use manual overrides via other tooling; core teacher flows use teacher/HOD permissions.

HODs who teach must appear on **timetable entries** as `teacherId` (same as teachers) to start sessions.

## Session start (QR)

`POST /api/v1/sessions`

- `timetableEntryId` (required)
- `requireGps` (default `true`) — when `false`, session anchor is not stored and QR scans skip radius checks
- `locationRadiusM` (10–10000, default 100) — used when `requireGps` is true
- `location` `{ lat, lng }` — required when `requireGps` is true (teacher device GPS)

## Link attendance

`POST /api/v1/attendance/link/generate` — teacher sets `requireGps` and `gpsRadiusM` per link (independent of session QR settings).

Students open `/attend/:token` (web, logged in).

## Student GPS permission

Field: `User.attendanceGpsExempt` (admin/HOD: **User Management → Edit student → GPS attendance permission**).

When enabled, QR and link proximity checks are skipped for that student (session/link must still be active and token valid).

## Biometric

- **Login** (each user’s own device): WebAuthn passkey/fingerprint on login page (`/auth/webauthn/*`)
- **Enrollment**: Settings → fingerprint; students `/biometric/enroll` (face template stored server-side)
- **Class attendance** (teacher/HOD device): Teacher or HOD holds the phone, camera scans **the student’s face**, server matches template and marks that student present via `POST /api/v1/biometric/match` (Pro/Enterprise `biometric` feature + `mark:attendance`). Requires an **active session** started by that teacher.
- **Not** student self-scan at class time: students use **QR on their own phone**, not face match on their phone.

| Channel | Who holds device | API |
|---------|------------------|-----|
| QR check-in | Student | `POST /attendance/qr` |
| Face check-in | Teacher or HOD | `POST /biometric/match` |
| Login fingerprint | Each user | `/auth/webauthn/*` |

Web: `/biometric/attendance` (face-api.js + camera).

## Mobile

`packages/mobile`:

- **Students** — `ScanQRScreen` → `POST /attendance/qr` with `{ qrToken, gpsCoords }` (same as web).
- **Teachers / HODs** — `FaceScanScreen`: `expo-camera` capture + face-api descriptor bridge → `POST /biometric/match` (same as web). Start session on web first (`teacherId` = logged-in teacher/HOD).

## Deploy notes

After pull:

```bash
cd packages/backend && npx prisma migrate deploy
npm run build -w @sams/backend
npm run build -w @sams/frontend
# restart API + reload nginx (no-cache SPA — see nginx/sams.conf)
```

## Manual test script (Denis)

See `docs/DENIS-ATTENDANCE-MANUAL-TEST.md`.

## Suspend / unsuspend

Unchanged by attendance work — frontend clears auth on `SCHOOL_SUSPENDED` (commit `6753c1d0`). After unsuspend, users sign in again.
