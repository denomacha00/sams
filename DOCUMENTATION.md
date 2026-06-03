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
- Biometric (face recognition) attendance
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
│   └── super-admin/     # React SPA (super admin panel)
├── nginx/               # NGINX configuration
├── ecosystem.config.js  # PM2 process manager config
└── .github/workflows/   # CI/CD pipeline
```

---

## 3. Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, Zustand |
| Backend | Node.js, Express, TypeScript, Socket.io |
| Database | PostgreSQL with Prisma ORM |
| Cache | Redis (rate limiting, session events) |
| AI | Groq (Llama 3) + OpenRouter (fallback) |
| Payments | M-Pesa Daraja API (STK Push) |
| SMS | Africa's Talking |
| Email | Nodemailer (SMTP) |
| Biometric | face-api.js + AES-256-GCM encryption |
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
- Generates registration links for teachers
- Sends notifications to department or classes within it
- Can assign class rep on Class Roster for department classes

### TEACHER
- Starts attendance sessions
- Marks attendance (QR, manual, biometric)
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

---

## 5. Features

### 5.1 Attendance Methods

**QR Code Scanning**
- Teacher starts a session → QR code generated (JWT, 30s expiry)
- QR refreshes every 30 seconds via cron job
- Student scans → GPS verified → attendance recorded
- Real-time broadcast to all connected clients

**Manual Marking**
- Teacher selects students and marks status
- Statuses: PRESENT, LATE, EXCUSED, ABSENT
- Optional note (max 500 chars)
- Supports bulk marking

**Biometric (Face Recognition)**
- AES-256-GCM encrypted face descriptors
- Per-school encryption keys (HKDF derived)
- Euclidean distance matching with confidence threshold
- Gated to Professional/Enterprise plans

### 5.2 Offline Support
- Service Worker caches static assets (cache-first)
- API GET requests cached (network-first with fallback)
- POST/PUT requests queued in IndexedDB when offline
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
- **Inbox / Sent** folders on the Notifications page
- In-app delivery (real-time via Socket.io) and optional **SMS** channel (School Admin and HOD only)
- Email via Nodemailer (password reset, OTP, optional copies)
- **Send scope:** school, department, or class (role-dependent)
  - **School Admin:** entire school, any department/class, optional role filter
  - **HOD:** own department and classes within it
  - **Teacher:** own class(es)
- **Edit/delete:** only the **original sender** can edit or delete their outbound copy (prevents editing admin/HOD messages via inbox row IDs). Non–school-admins have a **24-hour** edit window; school admins are not limited by that window.
- **Class rep replies:** students flagged as class rep may reply only to messages where `senderRole` is `TEACHER` (threaded reply API)
- **HOD** cannot edit messages sent by school admin (must be sender)
- SMS via Africa's Talking (server env — see [§12](#12-sms-otp--africas-talking)); Super Admin portal has **no** school-level AT settings
- Daily cron: low attendance alerts, license expiry reminders

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

### Health
- `GET /health` — DB/Redis status, `sms` (configured/sandbox/username), `email`, `otp` flags (no secrets)

### Notifications (SMS admin)
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
- `POST /api/v1/sessions` — Start session
- `GET /api/v1/sessions` — List sessions
- `GET /api/v1/sessions/:id/qr` — Get current QR token
- `POST /api/v1/sessions/:id/end` — End session

### Attendance
- `POST /api/v1/attendance/qr` — QR scan attendance
- `POST /api/v1/attendance/manual` — Manual marking
- `POST /api/v1/attendance/biometric` — Biometric attendance
- `PUT /api/v1/attendance/:id` — Update record
- `GET /api/v1/attendance` — List records
- `POST /api/v1/attendance/sync` — Offline sync

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
- `PATCH /api/v1/notifications/:id/read` — Mark as read
- `POST /api/v1/notifications/send` — Send notification

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
- `POST /api/v1/super/schools/:id/suspend` — Suspend school
- `POST /api/v1/super/schools/:id/unsuspend` — Unsuspend school
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
- At runtime the backend loads **`DOCUMENTATION.md`** from the repo root (truncated excerpt, ~8–10k chars) and injects it into the OpenAI/Groq system prompt for how-to and feature questions (`systemDocumentation.ts`).
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

### Groq/OpenRouter Engine (For everything else)
- Primary (Groq): `OPENAI_API_KEY`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_MODEL=llama-3.3-70b-versatile`
- Fallback (OpenRouter, optional): `OPENAI_FALLBACK_KEY`, `OPENAI_FALLBACK_URL=https://openrouter.ai/api/v1`, `OPENAI_FALLBACK_MODEL=meta-llama/llama-3.1-8b-instruct:free`
- Do not use decommissioned Groq IDs (`llama3-70b-8192`, etc.); runtime migrates some, but set the model explicitly on the VPS.
- Verify on server without wiping keys: `bash scripts/verify-ai-env.sh`
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
```bash
cd /var/www/sams
nvm use   # Node 20 per .nvmrc
bash scripts/deploy-production.sh
bash scripts/post-deploy-verify.sh   # smoke check (also at end of deploy)
```

### Upgrading Node.js to 20 on Ubuntu VPS

SAMS requires **Node.js 20+** (see repo `.nvmrc`). If `node -v` shows v18 or lower, upgrade before the next deploy.

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

Or run the idempotent helper (installs via nvm when Node < 20):

```bash
cd /var/www/sams
bash scripts/upgrade-node20.sh
bash scripts/deploy-production.sh
```

Ensure the same shell user that runs `pm2` uses nvm default 20 (`which node` should point under `~/.nvm/`). After upgrading, `bash scripts/post-deploy-verify.sh` should report `OK Node v20.x.x`.

### VPS helper scripts
| Script | Purpose |
|--------|---------|
| `scripts/deploy-production.sh` | Pull main, `npm ci`, build all packages, migrate, PM2 reload |
| `scripts/post-deploy-verify.sh` | Dist artifacts, PM2, `/health`, `.env` presence |
| `scripts/upgrade-node20.sh` | Idempotent Node 20 via nvm when current version < 20 |
| `scripts/set-production-env.sh` | JWT/QR secrets, `APP_URL`, `CORS`, OTP flags from AT key presence (does not touch `OPENAI_*`) |
| `scripts/verify-ai-env.sh` | Check Groq/OpenRouter keys and model IDs; masks secrets; does not modify `.env` |
| `scripts/configure-production-at.sh` | Interactive AT sandbox vs production (no committed secrets) |

### PM2 and environment
- `ecosystem.config.js` sets `env_file: './packages/backend/.env'` so **all** backend variables (AT, SMTP, JWT, etc.) load from that file.
- Use `pm2 reload ecosystem.config.js --env production` after `.env` changes.
- Do **not** commit `packages/backend/.env`; use `packages/backend/.env.example` as the template.

> Use `pm2 reload` (not `pm2 restart`) for zero-downtime deploys. The backend signals PM2 with `process.send('ready')` after startup, and `wait_ready: true` in ecosystem.config.js ensures the old instance is only killed after the new one is healthy.

### CI/CD Pipeline
- GitHub Actions on push to main
- Runs tests with PostgreSQL + Redis containers
- Builds all packages
- Deploys via SSH to VPS

### Production 100% checklist

Use this after deploy or any production change:

| Step | How to confirm |
|------|----------------|
| Deploy + verify passed | `bash scripts/deploy-production.sh` exits 0; `bash scripts/post-deploy-verify.sh` shows all critical checks passed |
| Node 20+ | `node -v` → v20.x; verify script shows `OK Node` (not WARN) |
| Production AT configured | `curl -s http://127.0.0.1:3001/health` → `"sms":{"configured":true,"sandbox":false}`; not sandbox username |
| Test SMS | School admin → **Settings** → **SMS · Africa's Talking** → **Send test SMS** to a real number |
| Login works | Sign in at https://app.smart-managment.com with a known account |
| Class rep roster works | Class rep role can view assigned class roster / attendance as expected |
| OTP login (optional) | Leave `OTP_LOGIN_ENABLED=false` until ready; then enable in `.env` and `pm2 reload` |

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
"sms": { "configured": true, "sandbox": false, "username": "yourapp" },
"otp": { "loginEnabled": false, "passwordResetEnabled": true }
```

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
