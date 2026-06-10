# SAMS — Smart Attendance Management System
## Complete System Documentation

**Version:** 1.0.0  
**Developer:** Denis Macharia  
**Contact:** +254 703 285 246 | denis@smart-managment.com  
**Main app:** https://app.smart-managment.com  
**Super Admin:** https://super.smart-managment.com  
**Marketing site:** https://smart-managment.com  
**Repository:** https://github.com/denomacha00/sams  
**Server:** 185.143.228.182  

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [User Roles & Permissions](#4-user-roles--permissions)
5. [Features](#5-features)
6. [Database Schema](#6-database-schema)
7. [API Endpoints](#7-api-endpoints)
8. [AI Assistant](#8-ai-assistant)
9. [Deployment](#9-deployment)
10. [Security](#10-security)
11. [Configuration](#11-configuration)
12. [SMS, OTP & Africa's Talking](#12-sms-otp--africas-talking)

---

## 1. System Overview

SAMS is a multi-school enterprise platform designed for Kenyan educational institutions to streamline attendance tracking, school management, and student monitoring. It supports multiple schools on a single platform with complete data isolation between tenants.

### Key Capabilities
- QR Code-based attendance with 30-second token rotation
- GPS-verified attendance (prevents proxy attendance)
- Face attendance (biometric face recognition; fingerprint/passkey is account login only)
- Manual attendance marking by teachers
- Offline-first with automatic sync when connectivity restores
- Real-time WebSocket updates across all connected devices
- AI-powered assistant (answers any question + manages school data)
- Dropout risk scoring and early warning system
- M-Pesa payment integration for license management
- SMS and email notifications
- PDF/Excel report generation
- Automatic timetable generation (conflict-free)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NGINX (Reverse Proxy)                  │
│  app.smart-managment.com → Frontend (React SPA)          │
│  API: same-origin /api → Backend (port 3001)           │
│  super.smart-managment.com → Super Admin Panel           │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────┐
│                Express.js Backend (Port 3001)             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │  Routes  │ │ Services │ │Middleware│ │  Jobs    │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │Socket.io │ │ Prisma   │ │  Redis   │                │
│  └──────────┘ └──────────┘ └──────────┘                │
└─────────────────────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────┐
│  PostgreSQL Database  │  Redis Cache  │  File Storage    │
└─────────────────────────────────────────────────────────┘
```

### Monorepo Structure
```
sams/
├── packages/
│   ├── shared/          # Shared types, enums, utilities
│   ├── backend/         # Express API server
│   ├── frontend/        # React SPA (main app)
│   ├── super-admin/     # React SPA (super admin panel)
│   └── mobile/          # Expo React Native app (optional deploy)
├── nginx/               # NGINX configuration
├── ecosystem.config.js  # PM2 process manager config
└── .github/workflows/   # CI/CD pipeline
```

### Mobile app (separate from web deploy)

Native client **`packages/mobile`** (display name **SAMS**) uses the same `/api/v1` JWT API. It is **not** built or deployed by `scripts/deploy-production.sh` — web and API stay online while mobile is developed or released via Expo/EAS.

- Architecture and roadmap: **`docs/MOBILE-APP.md`**
- Run locally: **`packages/mobile/README.md`** (`npx expo start`, `EXPO_PUBLIC_API_URL`)

---

## 3. Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, Zustand |
| Mobile | Expo SDK 52+, React Native, TypeScript, expo-secure-store |
| Backend | Node.js, Express, TypeScript, Socket.io |
| Database | PostgreSQL with Prisma ORM |
| Cache | Redis (rate limiting, session events) |
| AI | Groq (Llama 3) + OpenRouter (fallback) |
| Payments | M-Pesa Daraja API (STK Push) |
| SMS | Africa's Talking |
| Email | Nodemailer (SMTP) |
| Biometric | face-api.js + AES-256-GCM encryption for face attendance; WebAuthn fingerprint/passkey is login only |
| Deployment | PM2, NGINX, GitHub Actions CI/CD |
| Offline | Service Worker, IndexedDB |

---

## 4. User Roles & Permissions

### SUPER_ADMIN
- Manages all schools on the platform
- Generates license keys
- Suspends/unsuspends schools
- Views system-wide analytics and revenue
- Has AI assistant with action execution

### SCHOOL_ADMIN
- Full school management
- Creates departments, classes, users
- Generates registration links
- Views school-wide reports
- Manages timetables
- Sends notifications to entire school

### HOD (Head of Department)
- Manages their department timetable (create/edit entries; school admin can view only)
- Views department reports and risk scores
- Creates and edits classes inside their own department
- Generates registration links for teachers
- Sends notifications to department or classes within it
- Can assign class rep on Class Roster for department classes
- Can start/end attendance sessions and mark attendance for classes in their department when the timetable has a current slot

### TEACHER
- Starts attendance sessions
- Marks attendance (QR, manual, face scan)
- Views class reports
- Generates registration links for students
- Sends notifications to class
- Views timetable

### STUDENT
- Scans QR codes for attendance
- Views own attendance records and reports
- Views timetable
- Receives notifications (inbox; read-only unless also class rep)

### CLASS_REP (flag on a student, not a separate role)
- A student with `isClassRep: true` for their class (at most one per class)
- Can **reply** to messages from their class teacher in Notifications (inbox)
- Cannot send school-wide or department broadcasts; cannot edit others' messages
- Assigned by **School Admin** (User Management) or **Teacher/HOD** (Class Roster page)

### School app navigation (HOD / School Admin)

- **`/dashboard`** is the single command center with role-grouped quick actions.
- **`/admin`** redirects to `/dashboard` (no duplicate admin home).
- Admin tools stay on **`/admin/users`**, **`/admin/timetable`**, **`/admin/departments`**, **`/admin/links`**, **`/admin/knowledge`**; back links return to `/dashboard`.

---

## 5. Features

### 5.1 Attendance Methods

**QR Code Scanning**
- Teacher starts a session → QR code generated (JWT, 30s expiry)
- Sessions are timetable-locked: they can only start in the scheduled slot window and stale active sessions are closed/rejected after the slot grace window.
- QR refreshes every 30 seconds via cron job
- Student scans → GPS verified → attendance recorded
- Real-time broadcast to all connected clients
- Session screens clear themselves when the backend broadcasts that a session ended.

**Manual Marking**
- Teacher selects students and marks status
- Statuses: PRESENT, LATE, EXCUSED, ABSENT
- Optional note (max 500 chars)
- Supports bulk marking

**Face Attendance (Biometric Face Recognition)**
- AES-256-GCM encrypted face descriptors
- Per-school encryption keys (HKDF derived)
- Euclidean distance matching with confidence threshold
- Gated to Professional/Enterprise plans
- Teacher/HOD uses their device camera to scan enrolled students. Fingerprint/passkey is not used for attendance; it is only for account sign-in.

### 5.2 Offline Support
- Service Worker caches static assets (cache-first)
- API GET requests cached (network-first with fallback)
- Only `POST /api/v1/attendance/sync` is queued for offline replay; live actions such as login, start/end session, and link generation must return immediately and are not replayed later.
- Auto-sync within 30 seconds of connectivity restoration
- Conflict resolution: newer timestamp wins

### 5.3 AI Assistant
- Floating chat widget on all pages
- Answers SAMS questions (local engine, no API needed)
- Answers ANY question (Groq/OpenRouter for general knowledge)
- Can generate/remake timetables
- Can execute admin actions (Super Admin)
- Voice input via Web Speech API
- Handles misspellings via AI fallback

### 5.4 Timetable Generation
- AI-powered conflict-free generation
- Generates for whole school or specific class
- Respects: teacher availability, department grouping, daily limits
- 8 periods/day (08:00–14:20), Mon–Fri
- Breaks: 10:00–10:20 (tea), 12:20–13:00 (lunch)
- Remake support (delete and regenerate)

### 5.5 Risk Scoring
- Formula: score = A×0.4 + G×0.4 + P×0.2
- A = attendance risk (inverse of attendance %)
- G = grade risk (placeholder, defaults to 50)
- P = pattern risk (consecutive absences × 20)
- Levels: LOW (<25), MEDIUM (25-50), HIGH (50-75), CRITICAL (≥75)
- Auto-recomputed after every attendance record
- Notifications sent on level change

### 5.6 Payments (M-Pesa)
- STK Push initiation
- Callback handling (IP-whitelisted)
- Plan tier upgrade on successful payment
- Invoice generation
- Audit logging

### 5.7 Notifications & Messaging
- **Alerts / Inbox / Sent / Send** workspace on the Notifications page
- In-app delivery is the active school notification channel (real-time via Socket.io). SMS is hidden from the frontend notification composer for now and reserved for OTP/password-reset flows until live AT capacity is ready.
- Attachments are supported for in-app messages: images, videos, PDFs, Office/text files, and links in message text, with authenticated open/download routes so recipient and sender can access them without public 404s.
- Super Admin can send official **SAMS update** notifications from the Super Admin portal to all schools or one selected school, with role filters (all users, admins, HODs, teachers, students). These arrive in school Alerts with a distinct platform color/badge and support the same attachment types. Super Admin can edit or delete sent platform update batches.
- Email via Nodemailer (password reset, OTP, optional copies)
- **Send scope:** school, department, or class (role-dependent)
  - **School Admin:** entire school, any department/class, optional role filter
  - **HOD:** own department and classes within it
  - **Teacher:** own class(es)
- **Edit/delete:** only the **original sender** can edit or delete their outbound copy (prevents editing admin/HOD messages via inbox row IDs). Non–school-admins have a **24-hour** edit window; school admins are not limited by that window.
- **Class rep replies:** students flagged as class rep may reply only to messages where `senderRole` is `TEACHER` (threaded reply API)
- **HOD** cannot edit messages sent by school admin (must be sender)
- SMS via Africa's Talking remains server-side only for OTP/password reset/app onboarding modes; Super Admin portal has **no** school-level AT settings
- Daily cron: low attendance alerts, license expiry reminders, and optional **student morning schedule** in-app reminders (`STUDENT_DAILY_SCHEDULE_REMINDERS`, `APP_TIMEZONE`)
- **Student daily schedule (zero-cost):** Each school day at 06:00 server cron, active students with a class and timetable slots **today** (per `APP_TIMEZONE`, default `Africa/Nairobi`) receive one in-app notification titled **Today's classes** listing time, subject, and teacher. No SMS or push. Disable with `STUDENT_DAILY_SCHEDULE_REMINDERS=false`.

### 5.8 Class Representative
- Toggle per student: User Management (school admin) or **Class Roster** (`/class-roster`, teachers for their class, HODs for department classes)
- API: `PATCH /api/v1/users/:id/class-rep` with `{ isClassRep: true|false }`
- Enabling a new rep clears the previous rep in the same class

### 5.9 Reports
- Student, Class, Department, School level reports
- Attendance percentage calculation
- PDF export (pdfkit)
- Excel export (exceljs)
- CSV export
- Role-based access control on all reports

### 5.10 Authentication Flows

**Standard login**
- Identifier: username, email, phone, or ADM number + password
- Optional school code (not required for sign-in)
- JWT access (15 min) + refresh (30 days)

**OTP login** (optional, `OTP_LOGIN_ENABLED=true`)
- After valid password, server sends 6-digit code via SMS and/or email
- User completes login on `/login` with `POST /api/v1/auth/verify-otp`
- Keep disabled in production until SMS and SMTP are verified

**Password reset — link mode**
- `/forgot-password` → school code + identifier
- Secure token (1 hour) emailed/SMS'd; user opens `/reset-password?token=...`

**Password reset — OTP mode** (default when `OTP_PASSWORD_RESET_ENABLED=true`)
- Forgot Password → **OTP code** tab
- `POST /api/v1/auth/forgot-password-otp` then `POST /api/v1/auth/reset-password-otp` with code + new password
- Requires email and/or phone on the user record; sandbox SMS only reaches AT-whitelisted numbers

**Registration links**
- Admins generate time-limited links; recipients self-register at `/register/:token`

**Biometric**
- Face enrollment and session attendance (plan-gated); descriptors encrypted per school

### 5.11 Super Admin Panel
- Accessible at `super.smart-managment.com`
- Separate React SPA (`packages/super-admin`)
- Host-restricted: only accessible via `super.smart-managment.com` (configurable via `SUPER_ADMIN_HOST`)
- Features: license management, school management, system analytics, revenue, audit logs, AI knowledge base, AI action execution
- AI assistant can execute admin actions via natural language

**Bootstrap (first deploy or recovery):**

```bash
cd packages/backend
# Ensure .env includes SUPER_ADMIN_HOST=super.smart-managment.com
npm run create-super-admin
# Optional password reset: SUPER_ADMIN_FORCE_RESET=true npm run create-super-admin
pm2 reload ecosystem.config.js --env production
```

Sign in at `https://super.smart-managment.com` (panel sends school code `SUPERADMIN` automatically). Do not set `VITE_API_BASE_URL` to the API subdomain — use same-origin `/api` via nginx.

### Production deploy (hands-off — Super Admin + app stay solid)

`dist/` folders are **not in git**. Every deploy **must rebuild** the main app and Super Admin UI.

**Automatic (recommended):** Push to `main` on GitHub. Actions runs tests, then SSH runs `scripts/deploy-production.sh` on the VPS (builds everything, verifies JS bundles exist, reloads PM2/nginx).

**Manual from phone/SSH** (one command):

```bash
cd /var/www/sams && bash scripts/deploy-production.sh
```

**Manual from GitHub** (no PC): Repo → Actions → **CI/CD Deploy** → **Run workflow**.

Never run only `git pull` on the server without a build — that is what causes blank app / blank Super Admin.

### 5.12 School Admin Settings
- Route: `/settings` (school admin only)
- **SMS · Africa's Talking:** read-only status from server (`GET /api/v1/notifications/sms-status`), sandbox vs production indicator, **Send test SMS**
- **Email (SMTP):** status + test email (credentials live in server `.env`, not per-school DB)
- AT credentials are **platform-level** on the VPS (`packages/backend/.env`), not configured in Super Admin

---

## 6. Database Schema

### Core Models
- **School** — Multi-tenant root entity
- **User** — All roles (username, phone, email, ADM unique identifiers)
- **Department** — Organizational unit within school
- **Class** — Student grouping within department
- **TimetableEntry** — Schedule entries
- **AttendanceSession** — Active attendance taking session
- **AttendanceRecord** — Individual attendance marks
- **RegistrationLink** — Self-registration tokens
- **LicenseKey** — School activation keys (SHA-256 hashed)
- **RefreshToken** — JWT refresh token storage (bcrypt hashed)
- **BiometricTemplate** — Encrypted face descriptors
- **RiskScore** — Computed dropout risk scores
- **AuditLog** — Immutable event log
- **Payment** — M-Pesa transaction records
- **Notification** — In-app messages

### Plan Tiers
| Tier | Students | Features |
|------|----------|----------|
| TRIAL | 50 | Basic attendance |
| BASIC | 500 | + API access |
| PROFESSIONAL | 2,000 | + Biometric, AI |
| ENTERPRISE | Unlimited | + Custom branding |

---

## 7. API Endpoints

### Authentication
- `POST /api/v1/auth/login` — Login; may return `requiresOtp` when OTP login enabled
- `POST /api/v1/auth/verify-otp` — Complete login with OTP challenge + code
- `POST /api/v1/auth/resend-login-otp` — Resend login OTP (cooldown applies)
- `POST /api/v1/auth/refresh` — Refresh token pair
- `POST /api/v1/auth/logout` — Invalidate refresh token
- `POST /api/v1/auth/forgot-password` — Password reset link via email/SMS
- `POST /api/v1/auth/reset-password` — Set password from reset token
- `POST /api/v1/auth/forgot-password-otp` — Send 6-digit reset code
- `POST /api/v1/auth/reset-password-otp` — Reset password with OTP code
- `DELETE /api/v1/auth/webauthn/credentials` - Disable fingerprint/passkey sign-in for the current user

### Health
- `GET /health` — DB/Redis status, `sms` (configured/sandbox/username), `email`, `otp` flags (no secrets)

### SMS admin probes
- `GET /api/v1/notifications/sms-status` — School admin: AT config status
- `POST /api/v1/notifications/test-sms` — School admin: send test SMS

### School Activation
- `POST /api/v1/activate` — Activate school with license key

### Users
- `GET/POST /api/v1/users` — List/create users
- `GET/PUT/DELETE /api/v1/users/:id` — CRUD single user
- `PATCH /api/v1/users/:id/class-rep` — Assign/remove class representative (student)

### Registration Links
- `POST /api/v1/registration-links` — Generate link
- `GET /api/v1/registration-links/:token` — Resolve link
- `POST /api/v1/registration-links/:token/register` — Self-register

### Timetable
- `GET/POST /api/v1/timetable` — List/create entries
- `PUT/DELETE /api/v1/timetable/:id` — Update/delete entry

### Sessions
- Session listing and attendance APIs close/reject stale active sessions past the timetable window.
- `POST /api/v1/sessions` — Start session
- `GET /api/v1/sessions` — List sessions
- `GET /api/v1/sessions/:id/qr` — Get current QR token
- `POST /api/v1/sessions/:id/end` — End session

### Attendance
- `POST /api/v1/attendance/qr` — QR scan attendance
- `POST /api/v1/attendance/manual` — Manual marking
- `POST /api/v1/attendance/biometric` — Face attendance record after biometric face match
- `PUT /api/v1/attendance/:id` — Update record
- `GET /api/v1/attendance` — List records
- `POST /api/v1/attendance/sync` — Offline sync
- `DELETE /api/v1/biometric/me` - Remove the current user's face enrollment

### Reports
- `GET /api/v1/reports/student/:id` — Student report
- `GET /api/v1/reports/class/:classId` — Class report
- `GET /api/v1/reports/department/:deptId` — Department report
- `GET /api/v1/reports/school` — School report
- `GET /api/v1/reports/export` — Export PDF/Excel

### Risk Scores
- `GET /api/v1/risk-scores` — List risk scores
- `GET /api/v1/risk-scores/:studentId` — Student risk score

### AI
- `POST /api/v1/ai/query` — Text query
- `POST /api/v1/ai/voice` — Voice query

### Notifications
- `GET /api/v1/notifications` — Get user notifications
- `GET /api/v1/notifications/sent` - Get messages sent by the current user
- `PATCH /api/v1/notifications/:id/read` — Mark as read
- `POST /api/v1/notifications/send` - Send in-app notification/message, optionally with attachments
- `GET /api/v1/notifications/attachments/:id` - Authenticated attachment open/download for sender or recipient
- `PUT /api/v1/notifications/:id` / `DELETE /api/v1/notifications/:id` - Edit/delete sender's outbound message copy where policy allows
- `GET /api/v1/super/notifications/sent` - Super Admin sent platform updates
- `POST /api/v1/super/notifications/send` - Super Admin official in-app update to all schools or one school, optionally with attachments
- `PATCH /api/v1/super/notifications/:id` / `DELETE /api/v1/super/notifications/batch/:batchId` - Super Admin edit/delete platform update batches

### Payments
- `POST /api/v1/payments/initiate` — Initiate M-Pesa STK Push
- `POST /api/v1/payments/callback` — M-Pesa callback
- `GET /api/v1/payments` — List payments
- `GET /api/v1/payments/:id/invoice` — Get invoice

### Super Admin
- `POST /api/v1/super/licenses` — Generate license
- `GET /api/v1/super/licenses` — List all license keys
- `POST /api/v1/super/licenses/:id/revoke` — Revoke a license
- `GET /api/v1/super/schools` — List all schools
- `GET /api/v1/super/schools/:id` — Get school details
- `POST /api/v1/super/schools/:id/suspend` — Suspend school (revokes all refresh tokens for that school)
- `POST /api/v1/super/schools/:id/unsuspend` — Unsuspend school (users must sign in again; old refresh tokens are not restored)
- `POST /api/v1/super/schools/:id/extend` — Extend license
- `DELETE /api/v1/super/schools/:id` — Delete school and all data
- `GET /api/v1/super/analytics` — System stats
- `GET /api/v1/super/revenue` — Revenue breakdown
- `GET /api/v1/super/audit-logs` — Query audit logs
- `GET/POST/PUT/DELETE /api/v1/super/ai-knowledge` — Manage AI knowledge base
- `POST /api/v1/super/ai-action` — AI-executed admin actions

---

## 8. AI Assistant

### Documentation context injection
- At runtime the backend loads **`DOCUMENTATION.md`** from the repo root (truncated excerpt, ~8-10k chars) and injects it into the OpenAI-compatible system prompt for how-to and feature questions (`systemDocumentation.ts`).
- Keep this file accurate after feature changes; `post-deploy-verify.sh` warns if it is missing on the VPS.
- Super Admin can also maintain an **AI knowledge base** via the super-admin API for extra school-neutral facts.

### Local Engine (No API needed)
Handles SAMS-specific queries via regex pattern matching:
- About SAMS, features, developer info
- Attendance statistics
- Absent students
- Risk scores
- Top students
- Class comparison
- Timetable generation/viewing
- Student counts
- Active sessions
- System stats (Super Admin)
- Admin how-to guides

### OpenRouter/Groq Engine (For everything else)
- Typical production primary: **OpenRouter** via `OPENAI_API_KEY`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, `OPENAI_MODEL=meta-llama/llama-3.3-70b-instruct` (or the approved model set in `secrets/providers.env`).
- Typical fallback: **Groq** via `OPENAI_FALLBACK_KEY`, `OPENAI_FALLBACK_URL=https://api.groq.com/openai/v1`, `OPENAI_FALLBACK_MODEL=llama-3.3-70b-versatile`.
- AI actions and conversation memory still depend on provider credits/rate limits; if both providers are out of credits/quota, local DB-backed answers continue but general LLM answers fail gracefully.
- Conversation memory is encrypted server-side and the frontend remembers thread ids per signed-in account, so role/account switching in one browser does not mix chat threads.
- Do not use decommissioned Groq IDs (`llama3-70b-8192`, etc.); runtime migrates some, but set the model explicitly on the VPS.
- Verify on server without wiping keys: `bash scripts/verify-secrets.sh`
- Answers any general knowledge question
- Handles misspellings and natural language
- No plan tier restriction

### Super Admin AI Actions
Can execute via natural language:
- Generate license keys
- Suspend/unsuspend schools
- Extend licenses
- Get school info
- Get system statistics
- Run a safe system readiness diagnostic from live database/configuration signals (AI config, memory, active/stale sessions, schools/users/licenses). It does not run arbitrary shell commands.

### School AI Actions
School AI is scoped to the logged-in role and school:
- **School Admin:** school/class/department in-app notifications, user/class/department actions, registration links, password resets, school stats.
- **HOD:** department/class in-app notifications, department stats, registration links, teacher assignment, department class creation, and department attendance session start/end/manual marking.
- **Teacher:** class in-app messages, registration links, session start/end, manual attendance marking, and class roster lookups.
- **Student:** own attendance, timetable, teachers, HOD, department/class info, reminders, and class rep info.
- Destructive actions require confirmation where configured; AI never bypasses route/service RBAC.

---

## 9. Deployment

### Server Setup
- VPS: 185.143.228.182 (Ubuntu)
- Node.js v20+ (see repo `.nvmrc`; run `nvm use` on the VPS)
- PostgreSQL 15
- Redis 7
- PM2 process manager
- NGINX reverse proxy with SSL

### Production URLs

| Surface | URL |
|---------|-----|
| Main app | https://app.smart-managment.com |
| Super Admin | https://super.smart-managment.com |
| API (browser) | Same-origin `https://app.smart-managment.com/api/...` via nginx |
| Health (on VPS) | `http://127.0.0.1:3001/health` |

### Deploy Commands

**If `node -v` is v18 or lower:** upgrade **before** deploy or go-live. Deploying on Node 18 can leave PM2 showing `sams-api` online while `GET http://127.0.0.1:3001/health` returns connection refused (process exits before bind or native/runtime mismatch). After upgrading, run `npm ci` and a full deploy so binaries match Node 20.

- **Ubuntu VPS without nvm:** `bash scripts/install-node20-ubuntu.sh` (NodeSource apt)
- **Per-user nvm:** `bash scripts/upgrade-node20.sh`

```bash
cd /var/www/sams
nvm use   # Node 20 per .nvmrc
bash scripts/deploy-production.sh
bash scripts/post-deploy-verify.sh   # smoke check (also at end of deploy)
```

### Upgrading Node.js to 20 on Ubuntu VPS

SAMS requires **Node.js 20+** (see repo `.nvmrc`). If `node -v` shows v18 or lower, **upgrade before deploy** — do not run `deploy-production.sh` on Node 18. Post-deploy verify will warn and `/health` may refuse connections until Node 20 and a rebuild.

**Install nvm (once per server user)** if `command -v nvm` fails:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# reload shell so nvm is on PATH:
source ~/.bashrc   # or: source ~/.nvm/nvm.sh
```

**Install and default Node 20:**

```bash
nvm install 20
nvm use 20
nvm alias default 20
node -v   # expect v20.x.x
```

**Rebuild and redeploy** (from app root):

```bash
cd /var/www/sams
npm ci
bash scripts/deploy-production.sh
```

**Option A — NodeSource (system Node, no nvm):**

```bash
cd /var/www/sams
bash scripts/install-node20-ubuntu.sh   # sudo apt via deb.nodesource.com
node -v   # v20.x.x; which node → /usr/bin/node
npm ci
bash scripts/go-live.sh
```

**Option B — nvm (per deploy user):**

```bash
cd /var/www/sams
bash scripts/upgrade-node20.sh
bash scripts/deploy-production.sh
```

Ensure the same shell user that runs `pm2` uses Node 20 (`which node` → `/usr/bin/node` or `~/.nvm/`). After upgrading, `bash scripts/post-deploy-verify.sh` should report `OK Node v20.x.x`.

### VPS helper scripts
| Script | Purpose |
|--------|---------|
| `scripts/deploy-production.sh` | Pull main, `npm ci`, build all packages, migrate, PM2 reload |
| `scripts/post-deploy-verify.sh` | Dist artifacts, PM2, `/health` (incl. AI/SMS block), optional AI/login smoke |
| `scripts/smoke-test-local.sh` | Local dev curl smoke (`/health`, auth + timetable when creds set) |
| `scripts/check-conversation-keys.sh` | Optional: `CONVERSATION_MASTER_KEY` + `_PREVIOUS` for AI thread decrypt |
| `docs/MOBILE-APP.md` | Mobile architecture, zero-downtime web, phased roadmap |
| `scripts/smoke-production.sh` | Lightweight curl smoke on VPS |
| `scripts/smoke-role-checks.md` | Curl examples + manual checks by role |
| `scripts/go-live.sh` | Backup secrets, pull main, build, migrate, readiness gate, restart, verify |
| `scripts/install-node20-ubuntu.sh` | Node 20 via NodeSource apt (no nvm) |
| `scripts/upgrade-node20.sh` | Idempotent Node 20 via nvm when current version < 20 |
| `scripts/set-production-env.sh` | JWT/QR secrets, `APP_URL`, `CORS`, OTP flags from AT key presence (does not touch `OPENAI_*`) |
| `scripts/verify-secrets.sh` | Check merged provider env (AI, AT, SMTP, M-Pesa); masks values |
| `scripts/verify-ai-env.sh` | Deprecated alias → `verify-secrets.sh --ai-only` |
| `scripts/backup-secrets.sh` | Backup all provider keys from merged env to `secrets/providers.env.backup.*` (chmod 600) |
| `scripts/backup-production.sh` | Full VPS backup: secrets + PostgreSQL dump + optional uploads → `backups/production-*` |
| `docs/SAMS-OPS-RUNBOOK.md` | Super Admin ops blueprint (symptom → fix → commands); auto-injected into Super Admin AI |
| `docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md` | Deep developer & ops book for Denis (architecture, failure modes, commands); auto-injected into Super Admin AI |
| `scripts/backup-ai-secrets.sh` | Deprecated alias → `backup-secrets.sh` |
| `scripts/configure-production-at.sh` | Interactive AT production setup (refuses sandbox when `NODE_ENV=production`) |
| `scripts/production-readiness-check.sh` | Fails on weak JWT (under 64 chars) and missing biometric key; sandbox SMS is a warning when all SMS-dependent production features are disabled/app-only |

### PM2 and environment
- `packages/backend/bin/pm2-start.js` loads `packages/backend/.env`, then **overlays** gitignored provider secrets (see below).
- Use `bash scripts/restart-api.sh` or `pm2 reload ecosystem.config.js --env production` after env changes.
- Do **not** commit `packages/backend/.env`; use `packages/backend/.env.example` as the template.

### Secrets on VPS

All third-party API keys and other sensitive credentials live **outside git** so `git pull` and `scripts/deploy-production.sh` never overwrite them. Deploy runs `git reset --hard origin/main` for tracked files only; **`packages/backend/.env` and `secrets/providers.env` are backed up and restored** around that reset so a mistakenly tracked `.env` cannot wipe your JWT. If the API crash-loops with `[STARTUP] JWT_SECRET must be … 64+ chars`, run `bash scripts/set-production-env.sh` then `bash scripts/restart-api.sh`.

| File | Purpose |
|------|---------|
| `packages/backend/.env` | Main VPS config (DB URL, JWT placeholders, feature flags, non-secret defaults) |
| `/var/www/sams/secrets/providers.env` | **Recommended on VPS** — Groq, AT, SMTP, M-Pesa, optional JWT/crypto |
| `packages/backend/.env.secrets` | Dev/local overlay (same merge rules as `providers.env`) |
| `secrets/providers.env` | Same as VPS path when repo root is `/var/www/sams` |

Template (committed, no real keys): **`secrets/providers.env.example`**.

Load order (later wins for the same key): `.env` → `.env.secrets` → `secrets/providers.env` → `/var/www/sams/secrets/providers.env`. Legacy `secrets/ai.env` is still read if present (migrate to `providers.env`).

**Before every deploy or risky `.env` edit:**

```bash
cd /var/www/sams
bash scripts/backup-secrets.sh
```

**First-time VPS setup:**

```bash
cd /var/www/sams
mkdir -p secrets
cp secrets/providers.env.example secrets/providers.env
chmod 600 secrets/providers.env
nano secrets/providers.env   # paste real keys (Groq gsk_..., AT, SMTP, etc.)
bash scripts/verify-secrets.sh
bash scripts/backup-secrets.sh
bash scripts/restart-api.sh
```

Keep placeholders in `.env` if you prefer; `providers.env` overrides them at runtime. Keys are **not** in git — recover from provider consoles or `secrets/providers.env.backup.*` after `backup-secrets.sh`.

#### AI (OpenRouter / Groq)

Put `OPENAI_*` and optional `OPENAI_FALLBACK_*` in `secrets/providers.env`. Verify AI only: `bash scripts/verify-secrets.sh --ai-only` (or deprecated `verify-ai-env.sh`). Do not use decommissioned Groq model IDs; see `.env.example`.

> Use `pm2 reload` (not `pm2 restart`) for zero-downtime deploys. The backend signals PM2 with `process.send('ready')` after startup, and `wait_ready: true` in ecosystem.config.js ensures the old instance is only killed after the new one is healthy.

### CI/CD Pipeline
- GitHub Actions on push to main
- Runs tests with PostgreSQL + Redis containers
- Builds all packages
- Deploys via SSH to VPS

### Real school go-live (SMS + biometric)

Use this when onboarding **licensed production schools** (not dev/sandbox). Email and M-Pesa can wait; SMS and biometric must work end-to-end.

| Requirement | What to configure |
|-------------|-------------------|
| **SMS (Africa's Talking)** | Production API key + live `AT_USERNAME` (never `sandbox`) in `secrets/providers.env` |
| **Biometric** | `BIOMETRIC_MASTER_KEY` (32+ chars, `openssl rand -base64 48`) in merged env |
| **License** | School on **Professional** or **Enterprise** (Super Admin → school → plan tier) |
| **Attendance flow** | Teacher starts an **active session** before `/biometric/attendance` face scan |
| **Students** | Enroll face via registration, Settings, or `/biometric/enroll` (Pro+ gate) |

**One-shot deploy (after secrets are configured):**

```bash
cd /var/www/sams
bash scripts/go-live.sh
```

**First-time secrets (before go-live):**

```bash
cd /var/www/sams

# 1) Production AT (interactive; merges AT_* into secrets/providers.env)
bash scripts/configure-production-at.sh   # choose mode 2 — production only

# 2) Biometric master key (once per server; never commit)
# Add to secrets/providers.env: BIOMETRIC_MASTER_KEY="<openssl rand -base64 48>"
chmod 600 secrets/providers.env

# 3) Super Admin: set school plan to Professional or Enterprise

bash scripts/verify-secrets.sh          # must PASS; missing BIOMETRIC_MASTER_KEY blocks biometric go-live
bash scripts/go-live.sh                 # or: production-readiness-check + restart-api + post-deploy-verify
curl -s http://127.0.0.1:3001/health | grep -E '"mode":"production"|"sandbox":false'
```

**Browser sign-off:**

1. **SCHOOL_ADMIN** → Settings → **Send test SMS** to a real Kenyan number (not AT sandbox whitelist only).
2. **Student** (Pro school) → enroll face (Settings or `/biometric/enroll`).
3. **Teacher** → start attendance session → **Face attendance** → scan enrolled student → attendance recorded.

**NGINX:** HTTPS on `app.*` and `api.*` unchanged; no sandbox-specific proxy rules. Ensure `CORS_ORIGIN` matches your app URL.

**Do not:** commit `secrets/providers.env`, `.env` with real keys, or use `AT_USERNAME=sandbox` when `NODE_ENV=production`.

---

### App-only production mode (current safe mode)

Use this while school notifications should remain in-app only and live SMS capacity/sender approval is not ready yet:

```bash
cd /var/www/sams
bash scripts/ready-app-only-production.sh
bash scripts/post-deploy-verify.sh
```

Expected `/health`: `sms.sandbox: true` may remain, but `otp.loginEnabled: false`, `otp.passwordResetEnabled: false`, and post-deploy verify reports sandbox SMS as a warning, not a critical failure. Forgot-password self-service via SMS is disabled in this mode; use admin password reset or configure SMTP/live AT before relying on self-service reset.

---

### Production go-live checklist

Use this for first production launch or after any risky change (secrets, AT mode, Node upgrade).

#### 1. Deploy

```bash
cd /var/www/sams
# Node 20+ required (install-node20-ubuntu.sh or upgrade-node20.sh)
bash scripts/go-live.sh
# Or CI-style reset deploy:
# bash scripts/backup-secrets.sh && bash scripts/deploy-production.sh
```

Optional deeper smoke (AI uses provider quota):

```bash
VERIFY_AI_QUERY=1 bash scripts/post-deploy-verify.sh
bash scripts/smoke-production.sh
```

#### 2. Secrets (never in git)

| Action | Command |
|--------|---------|
| Backup before edits | `bash scripts/backup-secrets.sh` |
| Verify merged keys | `bash scripts/verify-secrets.sh` |
| AI only | `bash scripts/verify-secrets.sh --ai-only` |
| Apply after `providers.env` change | `bash scripts/restart-api.sh` |

First-time: copy `secrets/providers.env.example` → `secrets/providers.env`, `chmod 600`, paste keys, then verify.

#### 3. Smoke tests

| Check | How |
|-------|-----|
| Automated | `bash scripts/post-deploy-verify.sh` — all critical OK |
| Health | `curl -s http://127.0.0.1:3001/health` — `status: ok`, `checks.database` + `checks.redis` true |
| AI block | Same `/health` → `ai.configured: true`, no `modelMismatch` |
| SMS / AT production | `"sms":{"configured":true,"sandbox":false}` |
| Guest AI (optional) | `VERIFY_AI_QUERY=1 bash scripts/smoke-production.sh` |
| Login (optional) | `VERIFY_LOGIN_IDENTIFIER` + `VERIFY_LOGIN_PASSWORD` in env, then smoke script |
| By role (browser) | See `scripts/smoke-role-checks.md` |

#### 4. Africa's Talking — production (not sandbox)

```bash
bash scripts/configure-production-at.sh   # interactive; writes to providers.env
bash scripts/verify-secrets.sh
bash scripts/restart-api.sh
curl -s http://127.0.0.1:3001/health | grep -q '"sandbox":false' && echo "AT production OK"
```

Confirm with **SCHOOL_ADMIN** → Settings → **Send test SMS** to a real Kenyan number.

#### 5. Rotate keys (incident or scheduled)

1. `bash scripts/backup-secrets.sh`
2. Generate new keys in provider consoles (Groq, AT, JWT, etc.)
3. Update `secrets/providers.env` only (or `.env` for non-provider vars)
4. `bash scripts/verify-secrets.sh` then `bash scripts/restart-api.sh`
5. `bash scripts/post-deploy-verify.sh` and sign out/in all admin sessions (JWT rotation)

#### 6. Sign-off

| Step | Confirm |
|------|---------|
| Node 20+ | `node -v` → v20.x; verify shows `OK Node` |
| Deploy + verify | Both scripts exit 0 |
| AT production | Health `sandbox: false`; test SMS delivered |
| Login | https://app.smart-managment.com with known admin |
| Class rep | Roster + teacher-message reply per `smoke-role-checks.md` |
| OTP (optional) | Keep `OTP_LOGIN_ENABLED=false` until ready; `pm2 reload` after enable |

---

## 10. Security

- **Authentication**: JWT (15min access + 30day refresh tokens)
- **Password Storage**: bcrypt (cost 12)
- **Rate Limiting**: 100 req/min/IP (global), 5 attempts/15min (login)
- **Account Lockout**: After 5 failed login attempts
- **Multi-tenant Isolation**: All queries scoped to schoolId
- **RBAC**: Role-based permission middleware
- **HTTPS**: Enforced via NGINX + Let's Encrypt
- **Biometric Encryption**: AES-256-GCM with per-school derived keys
- **License Keys**: SHA-256 hashed (raw key never stored)
- **Audit Logging**: Immutable, append-only event log
- **M-Pesa Callback**: IP-whitelisted (Safaricom IPs only)
- **CORS**: Configurable origin whitelist
- **Helmet**: Security headers (HSTS, X-Frame-Options, etc.)

---

## 11. Configuration

Full annotated template: **`packages/backend/.env.example`**. Copy to `packages/backend/.env` on the VPS and never commit real secrets.

### Core
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for OTP codes, rate limits, sessions |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | 64+ char random strings (required in production) |
| `QR_SECRET` | QR session JWT signing |
| `LICENSE_SECRET` | License key HMAC |
| `NODE_ENV` | `production` on VPS |
| `PORT` | Default `3001` |
| `APP_URL` | `https://app.smart-managment.com` (reset links, emails) |
| `CORS_ORIGIN` | Exact frontend origin in production |
| `UPLOADS_DIR` | e.g. `/var/www/sams/uploads` |

### Africa's Talking & OTP
See [§12](#12-sms-otp--africas-talking) for setup steps. Key variables: `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID`, `AT_SANDBOX_SENDER_ID`, `SMS_WELCOME_ON_REGISTER`, `OTP_LOGIN_ENABLED`, `OTP_PASSWORD_RESET_ENABLED`, `OTP_TTL_SECONDS`, `OTP_LENGTH`, `OTP_RESEND_COOLDOWN_SECONDS`.

### Email, AI, M-Pesa, Super Admin, Biometric
See `.env.example` for `SMTP_*`, `OPENAI_*`, `MPESA_*`, `SUPER_ADMIN_*`, `BIOMETRIC_*`, `CONVERSATION_MASTER_KEY`, and notification job thresholds.

For production provider keys, use **`secrets/providers.env`** (template: `secrets/providers.env.example`) instead of committing them into `.env`. See [Secrets on VPS](#secrets-on-vps).

---

## 12. SMS, OTP & Africa's Talking

SAMS uses [Africa's Talking](https://africastalking.com) for SMS: OTP codes, password reset texts, notification broadcasts, welcome SMS on phone registration, and cron alerts.

### Sandbox vs production

| | Sandbox | Production |
|---|---------|------------|
| `AT_USERNAME` | `sandbox` | Your **live** app username from AT dashboard |
| `AT_API_KEY` | Sandbox key (often `atsk_...`) | Production API key |
| Delivery | **Only** numbers whitelisted in AT dashboard → SMS → phone numbers | Any valid Kenyan number (balance permitting) |
| Sender | `AT_SANDBOX_SENDER_ID` or default `AFRICASTKNG` | Approved `AT_SENDER_ID` (e.g. `SAMS`) |
| Detection | `username === 'sandbox'` → `sandbox: true` in health/API | `sandbox: false` |

There is **no** `AT_SANDBOX=true` environment variable; sandbox mode is inferred from `AT_USERNAME=sandbox`.

### OTP: login vs password reset

| Feature | Env flag | Default | Notes |
|---------|----------|---------|-------|
| Password reset OTP | `OTP_PASSWORD_RESET_ENABLED` | `true` when AT configured | Forgot Password → OTP tab |
| Login OTP (2-step) | `OTP_LOGIN_ENABLED` | `false` | Password first, then SMS/email code |
| Code TTL | `OTP_TTL_SECONDS` | `900` (15 min) | Stored in Redis |
| Resend cooldown | `OTP_RESEND_COOLDOWN_SECONDS` | `60` | Per user/purpose |

`scripts/set-production-env.sh` sets `OTP_PASSWORD_RESET_ENABLED=true` only when a real `AT_API_KEY` is present.

### VPS setup (production AT)

1. Create production app and API key at https://account.africastalking.com  
2. Request **sender ID** approval for `AT_SENDER_ID` (e.g. `SAMS`).  
3. On the server:
   ```bash
   cd /var/www/sams
   bash scripts/configure-production-at.sh   # guided; does not store secrets in git
   # or edit packages/backend/.env manually
   pm2 reload ecosystem.config.js --env production
   curl -s http://127.0.0.1:3001/health
   ```
4. Sign in as **school admin** → **Settings** → **SMS · Africa's Talking** → **Send test SMS** to a real number.  
5. When stable, keep `OTP_LOGIN_ENABLED=false` until you intentionally enable 2-step login.

### School admin Settings UI

- Shows configured / sandbox / production badge, username, sender ID (no API key).  
- Test SMS uses `POST /api/v1/notifications/test-sms` (school admin only).  
- Super Admin portal does **not** configure AT; all schools share the same server credentials.

### Welcome SMS

When `SMS_WELCOME_ON_REGISTER` is not `false`, adding or registering a phone sends a short confirmation SMS (`phoneOnboardingService`) so users know the number works before OTP.

### Health endpoint

`GET /health` returns:
```json
"sms": {
  "configured": true,
  "sandbox": false,
  "mode": "production",
  "username": "yourapp",
  "senderId": "SAMS"
},
"otp": { "loginEnabled": false, "passwordResetEnabled": true }
```

`mode` is `production`, `sandbox`, or `unconfigured`. For real SMS schools, `/health` must show `"mode":"production"` and `"sandbox":false`. In app-only mode, sandbox SMS is a warning only when all SMS-dependent production features are disabled.

### Common errors

| Code | Meaning |
|------|---------|
| `SMS_NOT_CONFIGURED` | Missing `AT_API_KEY` / placeholder key |
| `OTP_NOT_CONFIGURED` | OTP enabled but neither SMS nor SMTP configured |
| `OTP_CONTACT_MISSING` | User has no email or phone |
| `OTP_DELIVERY_FAILED` | AT/SMTP rejected send (check sandbox whitelist) |
| `OTP_RESEND_COOLDOWN` | Wait before resending |

---

## License

Proprietary software developed by Denis Macharia.  
© 2025 SAMS — Smart Attendance Management System.  
All rights reserved.
