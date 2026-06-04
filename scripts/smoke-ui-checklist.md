# SAMS UI route checklist (manual)

Automated API smokes: `scripts/smoke-test-local.sh`, `scripts/post-deploy-verify.sh`.  
This file lists **frontend routes** from `packages/frontend/src/main.tsx` for role-based manual checks.

## Public (no login)

| Path | Page |
|------|------|
| `/login` | Login |
| `/forgot-password` | Forgot password (OTP + link) |
| `/reset-password` | Reset password (token from email) |
| `/activate` | School activation |
| `/register/:token` | Self-registration |

## Any authenticated user

| Path | Page |
|------|------|
| `/dashboard` | Dashboard |
| `/attend/:token` | Link attendance |
| `/timetable` | Timetable view |
| `/reports` | Reports |
| `/ai` | AI assistant |
| `/profile` | Profile |
| `/settings` | Settings |
| `/notifications` | Notifications |
| `/biometric/enroll` | Biometric enroll |

## TEACHER, HOD, SCHOOL_ADMIN

| Path | Page |
|------|------|
| `/sessions` | Sessions |
| `/attendance` | Manual attendance |
| `/biometric/attendance` | Biometric attendance |
| `/class/students` | Class students |
| `/class-roster` | Class roster |
| `/admin/knowledge` | Knowledge base |
| `/admin/links` | Registration links |

## STUDENT only

| Path | Page |
|------|------|
| `/sessions/scan` | QR scan |

## SCHOOL_ADMIN + HOD

| Path | Page |
|------|------|
| `/admin` | Admin dashboard |
| `/admin/users` | User management |
| `/admin/timetable` | Timetable admin |
| `/admin/departments` | Departments |
| `/risk-scores` | Risk scores |

## HOD only

| Path | Page |
|------|------|
| `/hod/department` | Department management |

## Super Admin (separate app)

`packages/super-admin` — platform portal at `super.smart-managment.com` (SUPER_ADMIN role).

## Suggested manual pass (per deploy)

1. Login as **SCHOOL_ADMIN** → `/admin`, `/settings`, send test notification if configured.
2. Login as **TEACHER** → `/sessions`, start session, `/attendance`.
3. Login as **STUDENT** → `/sessions/scan`, `/timetable`.
4. **Forgot password** → OTP tab; confirm clear error if SMTP off (no HTTP 500).
5. **AI** → open `/ai`; if old threads exist after key rotation, confirm memory notice banner.
