# SAMS — Smart Attendance Management System
## Complete System Documentation

**Version:** 1.0.0  
**Developer:** Denis Macharia  
**Contact:** +254 703 285 246 | denis@smart-managment.com  
**Live URL:** https://smart-managment.com  
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
│  app.sams.ke → Frontend | api.sams.ke → Backend          │
│  super.sams.ke → Super Admin Panel                       │
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
- Manages their department
- Views department reports and risk scores
- Generates registration links for teachers
- Sends notifications to department

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
- Receives notifications

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

### 5.7 Notifications
- In-app notifications (real-time via Socket.io)
- SMS via Africa's Talking
- Email via Nodemailer
- Scope-based sending: school, department, class
- Daily cron: low attendance alerts, license expiry reminders

### 5.8 Reports
- Student, Class, Department, School level reports
- Attendance percentage calculation
- PDF export (pdfkit)
- Excel export (exceljs)
- CSV export
- Role-based access control on all reports

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
- `POST /api/v1/auth/login` — Login (username/phone/email/ADM + password)
- `POST /api/v1/auth/refresh` — Refresh token pair
- `POST /api/v1/auth/logout` — Invalidate refresh token
- `POST /api/v1/auth/forgot-password` — Generate temp password

### School Activation
- `POST /api/v1/activate` — Activate school with license key

### Users
- `GET/POST /api/v1/users` — List/create users
- `GET/PUT/DELETE /api/v1/users/:id` — CRUD single user

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
- `GET /api/v1/super/schools` — List all schools
- `POST /api/v1/super/schools/:id/suspend` — Suspend school
- `POST /api/v1/super/schools/:id/extend` — Extend license
- `GET /api/v1/super/analytics` — System stats
- `GET /api/v1/super/revenue` — Revenue breakdown
- `POST /api/v1/super/ai-action` — AI-executed admin actions

---

## 8. AI Assistant

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
- Primary: Groq (llama3-70b-8192)
- Fallback: OpenRouter (meta-llama/llama-3.1-8b-instruct:free)
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
- Node.js v18
- PostgreSQL 15
- Redis 7
- PM2 process manager
- NGINX reverse proxy with SSL

### Deploy Commands
```bash
cd /var/www/sams
git pull origin main
npm ci
npx prisma generate --schema=packages/backend/prisma/schema.prisma
npm run build --workspaces --if-present
pm2 restart sams-api
```

### CI/CD Pipeline
- GitHub Actions on push to main
- Runs tests with PostgreSQL + Redis containers
- Builds all packages
- Deploys via SSH to VPS

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

### Environment Variables (.env)
```
DATABASE_URL=postgresql://user:pass@localhost:5432/sams_db
REDIS_URL=redis://localhost:6379
JWT_SECRET=<64+ char secret>
JWT_REFRESH_SECRET=<64+ char secret>
QR_SECRET=<secret for QR JWT signing>
LICENSE_SECRET=<HMAC secret for license keys>
OPENAI_API_KEY=<Groq API key>
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=llama3-70b-8192
OPENAI_FALLBACK_KEY=<OpenRouter API key>
OPENAI_FALLBACK_URL=https://openrouter.ai/api/v1
OPENAI_FALLBACK_MODEL=meta-llama/llama-3.1-8b-instruct:free
BIOMETRIC_MASTER_KEY=<master key for biometric encryption>
MPESA_CONSUMER_KEY=<Daraja consumer key>
MPESA_CONSUMER_SECRET=<Daraja consumer secret>
MPESA_SHORTCODE=<business shortcode>
MPESA_PASSKEY=<Daraja passkey>
MPESA_CALLBACK_URL=https://smart-managment.com/api/v1/payments/callback
AT_API_KEY=<Africa's Talking API key>
AT_USERNAME=<Africa's Talking username>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email>
SMTP_PASS=<app password>
```

---

## License

Proprietary software developed by Denis Macharia.  
© 2025 SAMS — Smart Attendance Management System.  
All rights reserved.
