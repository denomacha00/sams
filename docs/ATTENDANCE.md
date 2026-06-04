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

- **Login**: WebAuthn passkey/fingerprint on login page (`/auth/webauthn/*`) — any user with a registered credential
- **Enrollment**: Settings → fingerprint; students `/biometric/enroll`
- **Class attendance**: `POST /api/v1/biometric/match` (requires Pro/Enterprise `biometric` feature + `mark:attendance`)

## Mobile

`packages/mobile` — `ScanQRScreen` calls `POST /attendance/qr` with `{ qrToken, gpsCoords }` (same contract as web).

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
