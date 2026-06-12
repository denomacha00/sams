# SAMS Attendance & Biometric — Core Reference

Last verified: 2026-06-12 (HOD teacher parity, GPS controls, link generation, biometric dashboard entry, student GPS permission, fingerprint reader bridge guard).

## Roles & permissions

| Permission | TEACHER | HOD | SCHOOL_ADMIN | STUDENT |
|------------|---------|-----|--------------|---------|
| `start:session` | yes | yes | no* | no |
| `mark:attendance` | yes | yes | no* | no |
| QR scan (`POST /attendance/qr`) | no | no | no | yes (authenticated) |
| Link sign-in (`POST /attendance/link`) | no | no | no | yes |
| Link generate (`POST /attendance/link/generate`) | yes | yes | no* | no |

\* Admins use manual overrides via other tooling; core teacher flows use teacher/HOD permissions.

HODs can start sessions for timetable entries in their own department. In the timetable editor, HODs do not choose another department; the UI locks edits to their assigned department and the backend enforces the same scope.

## Session start (QR)

`POST /api/v1/sessions`

- `timetableEntryId` (required)
- `requireGps` (default `true`) — when `false`, session anchor is not stored and QR scans skip radius checks
- `locationRadiusM` (10–10000, default 100) — used when `requireGps` is true
- `location` `{ lat, lng }` — required when `requireGps` is true (teacher device GPS)

## Link attendance

`POST /api/v1/attendance/link/generate` — teacher/HOD sets `requireGps` and `gpsRadiusM` for a share link when the active session has a GPS anchor.

Current link behavior:

- If the session has a teacher GPS anchor, the link may require GPS and use `gpsRadiusM`.
- If the session has no GPS anchor, SAMS still creates the link quickly and downgrades `requireGps` to `false` instead of failing with a GPS-anchor error.
- Link attendance is authenticated and class-scoped; a student from another class cannot use the link.

Students open `/attend/:token` (web, logged in).

## Student GPS permission

Field: `User.attendanceGpsExempt` (admin/HOD: **User Management → Edit student → GPS attendance permission**).

When enabled, QR and link proximity checks are skipped for that student (session/link must still be active and token valid).

## Biometric

- **Login** (each user’s own device): WebAuthn passkey/fingerprint on login page (`/auth/webauthn/*`)
- **Enrollment**: Settings → fingerprint; students `/biometric/enroll` (face template stored server-side)
- **Class attendance** (teacher/HOD device): Teacher or HOD holds the phone, camera scans **the student’s face**, server matches template and marks that student present via `POST /api/v1/biometric/match` (Pro/Enterprise `biometric` feature + `mark:attendance`). Requires an **active session** started by that teacher.
- **Fingerprint attendance** (external reader only): `/fingerprint/attendance` stays locked until `window.SAMS_FINGERPRINT_READER` is installed by a supported reader bridge and reports ready. A normal checkbox click is not accepted as device proof.
- **Not** student self-scan at class time: students use **QR on their own phone**, not face match on their phone.

| Channel | Who holds device | API |
|---------|------------------|-----|
| QR check-in | Student | `POST /attendance/qr` |
| Face check-in | Teacher or HOD | `POST /biometric/match` |
| Fingerprint check-in | Teacher or HOD with supported bridge | `POST /attendance/fingerprint` |
| Login fingerprint | Each user | `/auth/webauthn/*` |

Web: `/biometric/attendance` (face-api.js + camera).

WebAuthn fingerprint/passkey sign-in is discoverable for new registrations. Cross-device sign-in depends on the user's passkey provider syncing the passkey to that device; local fingerprints cannot be copied to a random phone by the web app.

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

Offline replay note: only `/api/v1/attendance/sync` is queued by the service worker. Do not replay start/end session, login, or link-generation requests after the timetable window.

## Manual test script (Denis)

See `docs/DENIS-ATTENDANCE-MANUAL-TEST.md`.

## Suspend / unsuspend

Unchanged by attendance work — frontend clears auth on `SCHOOL_SUSPENDED` (commit `6753c1d0`). After unsuspend, users sign in again.
