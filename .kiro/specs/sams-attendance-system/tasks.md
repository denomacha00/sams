# Implementation Plan: SAMS (Smart Attendance Management System)

## Overview

This plan converts the SAMS design into incremental coding tasks for a React + TypeScript + Vite + TailwindCSS frontend, a Node.js + Express + TypeScript backend, PostgreSQL + Prisma ORM database, Socket.io real-time layer, and supporting integrations (M-Pesa, Africa's Talking, Nodemailer, OpenAI, face-api.js). Tasks are ordered so each step builds on the previous, ending with full integration. All 35 correctness properties from the design are covered by property-based tests using `fast-check` + `vitest`.

---

## Tasks

- [x] 1. Initialize monorepo and shared package
  - Create the root `package.json` with npm workspaces pointing to `packages/shared`, `packages/backend`, `packages/frontend`, `packages/super-admin`
  - Create `turbo.json` with pipeline definitions for `build`, `test`, `lint`
  - Scaffold `packages/shared/src/types/` with all enums (`PlanTier`, `UserRole`, `AttendanceStatus`, `RiskLevel`, `AuditEventType`, `PaymentStatus`) and shared DTOs
  - Scaffold `packages/shared/src/utils/` directory with placeholder exports
  - Configure `tsconfig.json` at root and per-package with path aliases
  - _Requirements: 2.1, 3.1, 20.1_

- [x] 2. Implement license key codec and shared utilities
  - [x] 2.1 Implement `encodeLicenseKey` and `decodeLicenseKey` in `packages/shared/src/utils/licenseKey.ts`
    - Encode schoolName (≤20 chars), planTier, expiresAt into base64url + HMAC-SHA256 checksum
    - Format output as `XXXX-YYYY-XXXX-XXXX`
    - Return `null` from decode on HMAC mismatch or malformed input
    - _Requirements: 1.4, 1.8_
  - [ ]* 2.2 Write property test for license key round-trip (Property 1)
    - **Property 1: License Key Round-Trip Encoding**
    - **Validates: Requirements 1.8**
    - Use `fc.string`, `fc.constantFrom` (plan tiers), `fc.date` as arbitraries; assert decoded fields equal encoded fields
  - [ ]* 2.3 Write property test for malformed key rejection (Property 4)
    - **Property 4: Malformed Key Rejection**
    - **Validates: Requirements 1.4**
    - Generate arbitrary strings that do not match `XXXX-YYYY-XXXX-XXXX`; assert `decodeLicenseKey` returns `null`
  - [x] 2.4 Implement GPS distance utility `haversineDistance(lat1, lng1, lat2, lng2): number` in shared utils
    - _Requirements: 5.8_
  - [x] 2.5 Implement attendance status classifier `classifyAttendanceStatus(scanTime, sessionStart, lateThresholdMin): AttendanceStatus`
    - PRESENT if `delta <= threshold`, LATE if `threshold < delta <= 2*threshold`, ABSENT otherwise
    - _Requirements: 5.5, 5.6, 5.7_
  - [ ]* 2.6 Write property test for attendance status assignment by timing (Property 17)
    - **Property 17: Attendance Status Assignment by Timing**
    - **Validates: Requirements 5.5, 5.6, 5.7**
    - Use `fc.integer` for delta and threshold; assert status matches the three-branch rule
  - [ ]* 2.7 Write property test for attendance percentage formula (Property 27)
    - **Property 27: Attendance Percentage Formula**
    - **Validates: Requirements 10.5**
    - Use `fc.nat` for totalPresent and totalExpected (totalPresent ≤ totalExpected); assert result equals `(present/expected)*100` rounded to 2 dp
  - [ ]* 2.8 Write property test for risk score formula (Property 28)
    - **Property 28: Risk Score Formula**
    - **Validates: Requirements 11.1**
    - Use `fc.float({min:0,max:100})` for A, G, P; assert score equals `A*0.4 + G*0.4 + P*0.2`
  - [ ]* 2.9 Write property test for risk level classification (Property 29)
    - **Property 29: Risk Level Classification**
    - **Validates: Requirements 11.2**
    - Use `fc.float({min:0,max:100})` for score; assert level matches LOW/MEDIUM/HIGH/CRITICAL boundaries

- [x] 3. Set up backend project and database schema
  - [x] 3.1 Scaffold `packages/backend` with Express + TypeScript, install all dependencies (`express`, `prisma`, `@prisma/client`, `jsonwebtoken`, `bcrypt`, `zod`, `socket.io`, `ioredis`, `express-rate-limit`, `rate-limit-redis`, `helmet`, `cors`, `qrcode`, `nodemailer`, `openai`, `africastalking`, `axios`, `pdfkit`, `exceljs`, `node-cron`, `cuid2`, `fast-check`, `vitest`, `supertest`)
    - _Requirements: 20.1_
  - [x] 3.2 Write the full Prisma schema in `packages/backend/prisma/schema.prisma`
    - Include all models: `LicenseKey`, `School`, `User`, `RefreshToken`, `Department`, `Class`, `TimetableEntry`, `AttendanceSession`, `AttendanceRecord`, `RegistrationLink`, `BiometricTemplate`, `RiskScore`, `AuditLog`, `Payment`
    - Include all enums, indexes, and unique constraints as specified in the design
    - _Requirements: 2.1, 3.6, 5.1, 7.8, 11.1, 13.4, 16.2_
  - [x] 3.3 Run initial Prisma migration (`prisma migrate dev --name init`) and generate client
    - _Requirements: 20.1_
  - [x] 3.4 Create `packages/backend/src/index.ts` entry point wiring Express app, Socket.io server, Redis client, and PM2-compatible graceful shutdown
    - _Requirements: 20.1, 20.5_
  - [x] 3.5 Implement global middleware stack: `helmet`, `cors`, HTTPS redirect, `express.json`, request-ID injection, `globalRateLimiter` (Redis-backed, 100 req/min/IP)
    - _Requirements: 19.1, 19.4, 19.6_
  - [ ]* 3.6 Write property test for API rate limiting (Property 33)
    - **Property 33: API Rate Limiting**
    - **Validates: Requirements 19.6**
    - Simulate >100 requests from same IP within 60 s window using supertest; assert 101st returns 429

- [x] 4. Implement authentication service and middleware
  - [x] 4.1 Implement `AuthService` in `packages/backend/src/services/authService.ts`
    - `login(schoolCode, identifier, password)`: look up school by code, find user by email or admissionNumber, check `isLocked`, compare bcrypt hash, enforce 5-attempt/15-min lockout window, generate JWT access token (15 min) and refresh token (30 days), store hashed refresh token in `RefreshToken` table
    - `refresh(refreshToken)`: verify JWT, look up hashed token in DB, issue new token pair
    - `logout(userId, refreshToken)`: delete `RefreshToken` record
    - `lockAccount(userId)`: set `isLocked = true`, notify School Admin via `NotificationService`
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 19.2, 19.5_
  - [x] 4.2 Implement `authenticate` JWT middleware in `packages/backend/src/middleware/auth.ts`
    - Verify `Authorization: Bearer` header, decode payload, attach `req.user`; return 401 on missing/expired token
    - _Requirements: 3.7_
  - [x] 4.3 Implement `requirePermission` and `enforceSchoolScope` RBAC middleware in `packages/backend/src/middleware/rbac.ts`
    - Map roles to permissions as per design; return 403 on violation; inject `req.schoolId` from JWT
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 2.2, 2.3_
  - [x] 4.4 Implement `loginRateLimiter` middleware (5 attempts / 15 min, skip successful requests)
    - _Requirements: 19.5_
  - [x] 4.5 Wire auth routes: `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`
    - Validate request bodies with zod schemas
    - _Requirements: 3.7, 3.8_
  - [ ]* 4.6 Write property test for JWT claims completeness (Property 9)
    - **Property 9: JWT Claims Completeness**
    - **Validates: Requirements 3.6**
    - Generate arbitrary user records; assert issued token contains `sub`, `schoolId`, `role`, and conditional `departmentId`/`classId`
  - [ ]* 4.7 Write property test for refresh token round-trip (Property 10)
    - **Property 10: Refresh Token Round-Trip**
    - **Validates: Requirements 3.8**
    - Assert refreshed token carries identical `schoolId`, `role`, `departmentId`, `classId` as original
  - [ ]* 4.8 Write property test for single role assignment (Property 8)
    - **Property 8: Single Role Assignment**
    - **Validates: Requirements 3.1**
    - Generate arbitrary user creation payloads; assert each user has exactly one role
  - [ ]* 4.9 Write property test for login rate limiting (Property 32)
    - **Property 32: Login Rate Limiting**
    - **Validates: Requirements 19.5**
    - Simulate 6 consecutive failed logins; assert 6th returns 401 and account `isLocked = true`
  - [ ]* 4.10 Write property test for password hashing non-reversibility (Property 31)
    - **Property 31: Password Hashing Non-Reversibility**
    - **Validates: Requirements 19.2**
    - Use `fc.string` for passwords; assert `hash !== password` and `bcrypt.compare(password, hash) === true`

- [x] 5. Implement school activation and license service
  - [x] 5.1 Implement `ActivationService` in `packages/backend/src/services/activationService.ts`
    - Validate key format (`XXXX-YYYY-XXXX-XXXX` regex), decode payload, verify HMAC, check expiry, check `usedAt` is null
    - Hash raw key with bcrypt before storing; never store raw key
    - Create `School` record, create `School Admin` user with hashed password, mark `LicenseKey.usedAt`
    - Enforce `schoolCode` uniqueness; return `SCHOOL_CODE_TAKEN` on collision
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 19.7_
  - [x] 5.2 Wire activation route: `POST /api/v1/activate` with zod validation
    - _Requirements: 1.1_
  - [ ]* 5.3 Write property test for license key non-exposure (Property 2)
    - **Property 2: License Key Non-Exposure**
    - **Validates: Requirements 1.5, 19.7**
    - Assert API response body, error messages, and audit log entries do not contain the raw key string
  - [ ]* 5.4 Write property test for license key idempotence rejection (Property 3)
    - **Property 3: License Key Idempotence Rejection**
    - **Validates: Requirements 1.2**
    - Activate with a key once; attempt second activation with same key; assert rejection and no new school record
  - [ ]* 5.5 Write property test for school code uniqueness (Property 5)
    - **Property 5: School Code Uniqueness**
    - **Validates: Requirements 1.6, 1.7**
    - Register two schools with same code; assert second is rejected with `SCHOOL_CODE_TAKEN`

- [x] 6. Implement multi-school data isolation and RBAC enforcement
  - [x] 6.1 Apply `enforceSchoolScope` middleware globally to all `/api/v1` data routes
    - Inject `req.schoolId` from JWT into every Prisma query via a shared query helper
    - _Requirements: 2.2_
  - [x] 6.2 Implement cross-school access guard: for every resource fetch by ID, verify `resource.schoolId === req.schoolId`; return 403 otherwise
    - _Requirements: 2.3_
  - [x] 6.3 Implement HOD department scope guard: for HOD role, verify target user's `departmentId === req.user.departmentId` on manage operations
    - _Requirements: 3.3_
  - [x] 6.4 Implement student privacy guard: for Student role, verify `targetStudentId === req.user.sub` on attendance record access
    - _Requirements: 3.5_
  - [ ]* 6.5 Write property test for school ID scoping invariant (Property 6)
    - **Property 6: School ID Scoping Invariant**
    - **Validates: Requirements 2.1, 2.2**
    - Generate requests with JWT for school A; assert all returned records have `schoolId === A`
  - [ ]* 6.6 Write property test for cross-school access rejection (Property 7)
    - **Property 7: Cross-School Access Rejection**
    - **Validates: Requirements 2.3**
    - Attempt to access resource from school B using school A JWT; assert 403
  - [ ]* 6.7 Write property test for HOD scope enforcement (Property 11)
    - **Property 11: HOD Scope Enforcement**
    - **Validates: Requirements 3.3**
    - HOD attempts to manage user in different department; assert 403
  - [ ]* 6.8 Write property test for student privacy enforcement (Property 12)
    - **Property 12: Student Privacy Enforcement**
    - **Validates: Requirements 3.5**
    - Student A attempts to read student B's records; assert 403

- [x] 7. Implement user management and registration link service
  - [x] 7.1 Implement `UserService` CRUD in `packages/backend/src/services/userService.ts`
    - `createUser`, `updateUser`, `deleteUser`, `listUsers` — all scoped to `schoolId`
    - Hash passwords with bcrypt (cost 12) on create/update
    - Enforce plan tier student count limits via `LicenseService.checkStudentLimit`
    - _Requirements: 3.2, 4.9, 12.1, 12.6, 19.2_
  - [x] 7.2 Implement `RegistrationLinkService` in `packages/backend/src/services/registrationLinkService.ts`
    - `generateLink(creatorId, role)`: embed correct scope IDs based on creator role; set expiry (7–365 days) and maxUses (classSize + 10%)
    - `resolveLink(token)`: return metadata; reject if expired or at max uses
    - `registerViaLink(token, fullName, admissionNumber)`: validate link, check duplicate admission number, create Student user
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [x] 7.3 Wire user routes: `GET/POST /api/v1/users`, `GET/PUT/DELETE /api/v1/users/:id`
    - Wire registration link routes: `POST /api/v1/registration-links`, `GET /api/v1/registration-links/:token`, `POST /api/v1/registration-links/:token/register`
    - _Requirements: 4.1–4.9_
  - [ ]* 7.4 Write property test for registration link context embedding (Property 13)
    - **Property 13: Registration Link Context Embedding**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Generate links for each creator role; assert embedded IDs match creator's scope exactly
  - [ ]* 7.5 Write property test for registration link max-use enforcement (Property 14)
    - **Property 14: Registration Link Max-Use Enforcement**
    - **Validates: Requirements 4.5, 4.6**
    - Use `fc.nat({min:1,max:20})` for maxUses N; register N times successfully; assert N+1th is rejected
  - [ ]* 7.6 Write property test for duplicate admission number rejection (Property 15)
    - **Property 15: Duplicate Admission Number Rejection**
    - **Validates: Requirements 4.8**
    - Register student with admission number X; attempt second registration with same X in same school; assert rejection

- [x] 8. Implement timetable service
  - [x] 8.1 Implement `TimetableService` in `packages/backend/src/services/timetableService.ts`
    - `createEntry`: validate required fields, detect overlaps for same teacher/class/room on same day+time, reject with `TIMETABLE_CONFLICT`
    - `updateEntry`, `deleteEntry` (soft-delete: do not cascade to historical sessions)
    - `listEntries`: scoped to `schoolId`, filterable by teacher/class/day
    - _Requirements: 17.1, 17.2, 17.4, 17.5_
  - [x] 8.2 Wire timetable routes: `GET/POST /api/v1/timetable`, `PUT/DELETE /api/v1/timetable/:id`
    - Restrict create/update/delete to `SCHOOL_ADMIN` role
    - _Requirements: 17.4_

- [x] 9. Implement attendance session and QR code service
  - [x] 9.1 Implement `SessionService` in `packages/backend/src/services/sessionService.ts`
    - `startSession(teacherId, timetableEntryId, location)`: validate timetable entry belongs to teacher at current time, create `AttendanceSession`, generate initial QR token (JWT, 30 s expiry, random nonce), store in session record
    - `endSession(sessionId, teacherId)`: set `isActive=false`, `endedAt`, broadcast `session:ended` via Socket.io
    - `generateQRCode(sessionId)`: sign JWT `{sessionId, nonce, iat, exp: iat+30}` with `QR_SECRET`
    - `refreshQRCode(sessionId)`: generate new nonce, update DB, broadcast `qr:refresh` via Socket.io
    - `getActiveQR(sessionId)`: return current token or null
    - _Requirements: 5.1, 5.2, 9.4, 17.3_
  - [x] 9.2 Implement server-side QR refresh cron job in `packages/backend/src/jobs/qrRefresh.ts`
    - Every 30 seconds, find all active sessions and call `SessionService.refreshQRCode`
    - _Requirements: 5.2_
  - [x] 9.3 Wire session routes: `POST /api/v1/sessions`, `GET /api/v1/sessions/:id`, `GET /api/v1/sessions/:id/qr`, `POST /api/v1/sessions/:id/end`, `GET /api/v1/sessions`
    - _Requirements: 5.1, 5.2_
  - [ ]* 9.4 Write property test for QR code uniqueness across sessions (Property 16)
    - **Property 16: QR Code Uniqueness Across Sessions**
    - **Validates: Requirements 5.1**
    - Generate N concurrent sessions; assert all N QR tokens are distinct strings

- [x] 10. Implement attendance recording service
  - [x] 10.1 Implement `AttendanceService.recordQRScan` in `packages/backend/src/services/attendanceService.ts`
    - Verify QR JWT signature and expiry (reject if >30 s old with `QR_EXPIRED`)
    - Validate GPS coordinates within session radius using `haversineDistance` (reject with `GPS_OUT_OF_RANGE`)
    - Check for duplicate scan (`DUPLICATE_SCAN`)
    - Classify status using `classifyAttendanceStatus`
    - Insert `AttendanceRecord`, broadcast via Socket.io, trigger risk score recomputation
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.10_
  - [x] 10.2 Implement `AttendanceService.recordManual`
    - Validate status is one of `PRESENT | LATE | EXCUSED | ABSENT`; reject others with 400
    - Accept optional note ≤500 chars; reject longer notes with validation error
    - Check for duplicate; if updating existing record, overwrite and log to AuditLog
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - [x] 10.3 Implement `AttendanceService.recordBiometric`
    - Accept `{sessionId, studentId, confidence}`; check confidence ≥ threshold; mark PRESENT or reject
    - _Requirements: 7.5, 7.6_
  - [x] 10.4 Implement `AttendanceService.updateRecord`
    - Overwrite status and note; write AuditLog entry with previous and new status, actorId, timestamp
    - _Requirements: 6.5_
  - [x] 10.5 Wire attendance routes: `POST /api/v1/attendance/qr`, `POST /api/v1/attendance/manual`, `POST /api/v1/attendance/biometric`, `PUT /api/v1/attendance/:id`, `GET /api/v1/attendance`
    - _Requirements: 5.3, 6.1, 7.5_
  - [ ]* 10.6 Write property test for GPS radius enforcement (Property 18)
    - **Property 18: GPS Radius Enforcement**
    - **Validates: Requirements 5.8**
    - Generate coordinates outside session radius; assert scan is rejected and no record created
  - [ ]* 10.7 Write property test for duplicate scan rejection (Property 19)
    - **Property 19: Duplicate Scan Rejection**
    - **Validates: Requirements 5.10**
    - Submit two scans for same student+session; assert second is rejected and first record unchanged
  - [ ]* 10.8 Write property test for manual attendance status validation (Property 20)
    - **Property 20: Manual Attendance Status Validation**
    - **Validates: Requirements 6.2**
    - Use `fc.string` to generate arbitrary status values; assert only the four valid values are accepted
  - [ ]* 10.9 Write property test for reason note length enforcement (Property 21)
    - **Property 21: Reason Note Length Enforcement**
    - **Validates: Requirements 6.3**
    - Use `fc.string({minLength:501})` for note; assert rejection; use `fc.string({maxLength:500})` and assert acceptance
  - [ ]* 10.10 Write property test for attendance update audit trail (Property 22)
    - **Property 22: Attendance Update Audit Trail**
    - **Validates: Requirements 6.5**
    - Update a record; assert AuditLog entry contains previous status, new status, actorId, and timestamp

- [x] 11. Implement offline sync service (backend)
  - [x] 11.1 Implement `AttendanceService.syncOfflineRecords` in `packages/backend/src/services/attendanceService.ts`
    - Accept batch of `OfflineAttendanceRecord[]`
    - For each record, check if server record exists for same `sessionId + studentId`
    - Apply conflict resolution: retain record with newer `scannedAt` timestamp
    - Log every conflict resolution decision to AuditLog with both record values and resolution
    - Return `{synced: string[], conflicts: ConflictResult[]}`
    - _Requirements: 8.2, 8.3, 8.4_
  - [x] 11.2 Wire sync route: `POST /api/v1/attendance/sync`
    - _Requirements: 8.2_
  - [ ]* 11.3 Write property test for offline conflict resolution (Property 25)
    - **Property 25: Offline Conflict Resolution**
    - **Validates: Requirements 8.3**
    - Generate pairs of (offline, server) records with arbitrary timestamps; assert newer timestamp wins
  - [ ]* 11.4 Write property test for conflict resolution audit logging (Property 26)
    - **Property 26: Conflict Resolution Audit Logging**
    - **Validates: Requirements 8.4**
    - After sync with conflicts, assert AuditLog entries contain both record values and resolution decision

- [x] 12. Implement real-time WebSocket layer
  - [x] 12.1 Implement Socket.io server in `packages/backend/src/sockets/attendanceSocket.ts`
    - Authenticate via handshake token (verify JWT)
    - Handle `session:join` event: verify teacher owns session, join `session:{sessionId}` room, replay missed events from Redis list since `lastSeen`
    - Handle `qr:subscribe` event: join `qr:{sessionId}` room
    - Implement `broadcastAttendanceUpdate`, `broadcastQRRefresh`, `broadcastSessionEnd` emitters
    - Store attendance events in Redis list `events:{sessionId}` with 2-hour TTL
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 12.2 Integrate Socket.io broadcasts into `AttendanceService` (emit on record create/update) and `SessionService` (emit on QR refresh and session end)
    - _Requirements: 9.1, 9.2_

- [x] 13. Implement report service
  - [x] 13.1 Implement `ReportService` in `packages/backend/src/services/reportService.ts`
    - `getStudentReport(studentId, dateRange)`: scoped to student's own records
    - `getClassReport(classId, dateRange)`: aggregated for all students in class
    - `getDepartmentReport(departmentId, dateRange)`: aggregated across all classes in department
    - `getSchoolReport(schoolId, dateRange)`: aggregated across all departments
    - All methods compute attendance percentage as `(totalPresent / totalExpected) * 100` rounded to 2 dp
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7_
  - [x] 13.2 Implement `ReportService.exportReport(reportId, format)` returning a `Buffer`
    - PDF export using `pdfkit`; Excel export using `exceljs`
    - _Requirements: 10.6_
  - [x] 13.3 Wire report routes: `GET /api/v1/reports/student/:id`, `GET /api/v1/reports/class/:classId`, `GET /api/v1/reports/department/:deptId`, `GET /api/v1/reports/school`, `GET /api/v1/reports/:reportId/export`
    - Enforce role-based scope on each route
    - _Requirements: 10.7_

- [x] 14. Implement dropout risk scoring service
  - [x] 14.1 Implement `RiskService` in `packages/backend/src/services/riskService.ts`
    - `computeRiskScore(studentId)`: fetch attendance weight (% present), grade weight (normalized), pattern weight (consecutive absences/late streaks); compute `score = A*0.4 + G*0.4 + P*0.2`; classify into LOW/MEDIUM/HIGH/CRITICAL
    - `getRiskScores(scope)`: return scores scoped to school or department
    - Upsert `RiskScore` record after computation
    - If risk level changes, trigger `NotificationService` alert to Teacher and HOD
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [x] 14.2 Implement post-save hook in `AttendanceService` to call `RiskService.computeRiskScore` after every record create/update
    - _Requirements: 11.4_
  - [x] 14.3 Wire risk score routes: `GET /api/v1/risk-scores`, `GET /api/v1/risk-scores/:studentId`
    - _Requirements: 11.3_

- [x] 15. Implement plan tier feature gating (license service)
  - [x] 15.1 Implement `LicenseService` in `packages/backend/src/services/licenseService.ts`
    - `checkStudentLimit(schoolId)`: query student count; compare against tier limits (Trial:50, Basic:500, Pro:2000, Enterprise:∞); throw `PLAN_LIMIT_REACHED` if at limit
    - `checkFeatureAccess(schoolId, feature)`: return boolean based on plan tier (biometric/AI gated to Pro+, custom branding to Enterprise)
    - `checkLicenseExpiry(schoolId)`: set `isReadOnly=true` and notify admin if expired
    - `suspendSchool(schoolId)`: set `isSuspended=true`, revoke all active sessions
    - `extendLicense(schoolId, newExpiry)`: update `licenseExpiresAt`, clear `isReadOnly`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 15.3, 15.4_
  - [x] 15.2 Add `licenseGuard` middleware that checks `isSuspended` and `isReadOnly` on every authenticated request
    - _Requirements: 12.7, 15.3_
  - [ ]* 15.3 Write property test for plan tier student count enforcement (Property 30)
    - **Property 30: Plan Tier Student Count Enforcement**
    - **Validates: Requirements 12.1, 12.6**
    - For each tier limit N, register N students successfully; assert N+1th registration is rejected

- [x] 16. Implement M-Pesa payment service
  - [x] 16.1 Implement `PaymentService` in `packages/backend/src/services/paymentService.ts`
    - `initiateSTKPush(schoolId, phone, amount, planTier)`: generate Daraja password (base64 of shortCode+passKey+timestamp), POST to Daraja STK push endpoint, insert `Payment` record with `status=PENDING`, log `PAYMENT_INITIATED` to AuditLog
    - `handleCallback(callbackData)`: parse `Body.stkCallback`; on `ResultCode===0` update Payment to SUCCESS, update School planTier and licenseExpiresAt, generate invoice, send email receipt; on failure update to FAILED, send failure email
    - `getInvoice(paymentId)`: return invoice record
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - [x] 16.2 Wire payment routes: `POST /api/v1/payments/initiate`, `POST /api/v1/payments/callback` (IP-whitelisted, no auth), `GET /api/v1/payments`, `GET /api/v1/payments/:id/invoice`
    - _Requirements: 13.1, 13.4_

- [x] 17. Implement notification service
  - [x] 17.1 Implement `NotificationService` in `packages/backend/src/services/notificationService.ts`
    - `sendSMS(phone, message, retryCount=0)`: call Africa's Talking SDK; on failure retry up to 3 times with 60 s delay; log each attempt as `SMS_RETRY` in AuditLog
    - `sendEmail(to, subject, html)`: use Nodemailer transporter
    - `sendInApp(userId, notification)`: emit Socket.io event to user's personal room
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_
  - [x] 17.2 Implement notification triggers cron job in `packages/backend/src/jobs/notifications.ts`
    - Daily: check students below attendance threshold → SMS + in-app
    - Daily: check licenses expiring within 7 days → email School Admin
    - _Requirements: 18.1, 18.2_

- [x] 18. Implement audit logging service
  - [x] 18.1 Implement `AuditService` in `packages/backend/src/services/auditService.ts`
    - `log(event)`: insert `AuditLog` record with all required fields (eventType, actorId, actorRole, schoolId, timestamp, resourceSnapshot); use `autoincrement()` for sequenceNum
    - `query(filters)`: filter by schoolId, eventType, date range; return ordered by sequenceNum
    - Never expose a delete or update endpoint for AuditLog
    - _Requirements: 16.1, 16.2, 16.3, 16.4_
  - [ ]* 18.2 Write property test for AuditLog immutability (Property 34)
    - **Property 34: AuditLog Immutability**
    - **Validates: Requirements 16.3**
    - Attempt DELETE and PUT on AuditLog entries via API; assert both return error and entry is unchanged
  - [ ]* 18.3 Write property test for AuditLog required fields (Property 35)
    - **Property 35: AuditLog Required Fields**
    - **Validates: Requirements 16.1, 16.2**
    - Trigger each auditable event; assert created entry contains all required fields

- [x] 19. Checkpoint — backend core complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Implement biometric service (backend encryption layer)
  - [x] 20.1 Implement `biometricEncryption.ts` in `packages/backend/src/services/`
    - `encryptDescriptor(descriptor: Float32Array, schoolKey: Buffer): EncryptedTemplate` using AES-256-GCM
    - `decryptDescriptor(template: EncryptedTemplate, schoolKey: Buffer): Float32Array`
    - _Requirements: 7.8, 19.3_
  - [x] 20.2 Implement `BiometricService` in `packages/backend/src/services/biometricService.ts`
    - `enrollTemplate(studentId, descriptor)`: encrypt descriptor, store `BiometricTemplate` record
    - `matchDescriptor(descriptor, classId)`: decrypt all class templates, compute Euclidean distances, return top match with confidence
    - `getEncryptedTemplates(classId)`: return encrypted templates for offline caching
    - _Requirements: 7.4, 7.5, 7.6, 7.8_
  - [x] 20.3 Wire biometric routes: `POST /api/v1/biometric/enroll`, `GET /api/v1/biometric/templates/:classId`
    - Gate behind `LicenseService.checkFeatureAccess('biometric')` (Pro/Enterprise only)
    - _Requirements: 7.1, 12.4_
  - [ ]* 20.4 Write property test for biometric confidence threshold (Property 23)
    - **Property 23: Biometric Confidence Threshold**
    - **Validates: Requirements 7.5, 7.6**
    - Use `fc.float({min:0,max:1})` for confidence; assert PRESENT when ≥ threshold, rejection when < threshold
  - [ ]* 20.5 Write property test for biometric template encryption (Property 24)
    - **Property 24: Biometric Template Encryption**
    - **Validates: Requirements 7.8, 19.3**
    - Encrypt a descriptor; assert stored bytes differ from raw descriptor; decrypt and assert equality with original

- [x] 21. Implement AI assistant service
  - [x] 21.1 Implement local query engine in `packages/backend/src/services/ai/localEngine.ts`
    - Regex-based intent detection for: attendance percentage, absent students, risk scores, top students, class comparison
    - Query builder that enforces role-based scoping (Teacher → classId, Student → studentId, HOD → departmentId)
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [x] 21.2 Implement OpenAI engine in `packages/backend/src/services/ai/openaiEngine.ts`
    - Build system prompt with user scope context
    - Define function-calling tools: `query_attendance`, `query_risk_scores`, `query_reports`
    - Dispatch function calls to scoped DB queries; return formatted response
    - Gate behind `LicenseService.checkFeatureAccess('ai')` (Pro/Enterprise only)
    - _Requirements: 14.5, 12.4_
  - [x] 21.3 Implement `AIService` router in `packages/backend/src/services/aiService.ts`
    - Route to local engine for Trial/Basic; route to OpenAI engine for Pro/Enterprise
    - Handle out-of-scope queries with standard "not available" message
    - _Requirements: 14.1, 14.7_
  - [x] 21.4 Wire AI routes: `POST /api/v1/ai/query`, `POST /api/v1/ai/voice`
    - _Requirements: 14.1, 14.6_

- [x] 22. Implement Super Admin panel backend routes
  - [x] 22.1 Implement Super Admin routes in `packages/backend/src/routes/superAdmin.ts`
    - `POST /super/licenses`: generate license key using `encodeLicenseKey`, store bcrypt hash, return raw key once
    - `GET /super/schools`, `GET /super/schools/:id`: list/get schools with aggregated stats
    - `POST /super/schools/:id/suspend`: call `LicenseService.suspendSchool`
    - `POST /super/schools/:id/unsuspend`: clear `isSuspended`
    - `POST /super/schools/:id/extend`: call `LicenseService.extendLicense`
    - `GET /super/revenue`: aggregate payment totals by plan tier
    - `GET /super/audit-logs`: proxy to `AuditService.query` with filters
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
  - [x] 22.2 Restrict all `/super/*` routes to `SUPER_ADMIN` role; ensure they are only mounted when `HOST === super.sams.ke`
    - _Requirements: 15.1, 2.4_

- [x] 23. Checkpoint — all backend services complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 24. Set up frontend project
  - [x] 24.1 Scaffold `packages/frontend` with Vite + React + TypeScript + TailwindCSS
    - Install dependencies: `react`, `react-dom`, `react-router-dom`, `zustand`, `axios`, `socket.io-client`, `idb`, `qrcode`, `face-api.js`, `@types/*`
    - Configure `vite.config.ts` with proxy to `api.sams.ke` for development
    - Configure TailwindCSS with custom theme (school branding support)
    - _Requirements: 20.1, 20.3_
  - [x] 24.2 Implement API client in `packages/frontend/src/services/apiClient.ts`
    - Axios instance with base URL, `Authorization: Bearer` header injection from Zustand store
    - Interceptor for 401 → auto-refresh token flow
    - _Requirements: 3.7, 3.8_
  - [x] 24.3 Implement Zustand auth store in `packages/frontend/src/store/authStore.ts`
    - State: `user`, `accessToken`, `refreshToken`, `isAuthenticated`
    - Actions: `login`, `logout`, `refreshToken`
    - Persist to `localStorage` (non-sensitive fields only)
    - _Requirements: 3.6, 3.8_
  - [x] 24.4 Implement React Router setup in `packages/frontend/src/main.tsx` with route guards based on role
    - Public routes: `/activate`, `/login`, `/register/:token`
    - Protected routes: `/dashboard`, `/sessions`, `/attendance`, `/reports`, `/ai`, `/settings`
    - _Requirements: 3.1, 3.2_

- [x] 25. Implement frontend authentication pages
  - [x] 25.1 Implement `LoginPage` at `packages/frontend/src/pages/LoginPage.tsx`
    - Form: schoolCode, identifier (email or admission number), password
    - Call `POST /api/v1/auth/login`; store tokens; redirect to role-appropriate dashboard
    - Display account-locked and rate-limit error messages
    - _Requirements: 3.6, 19.5_
  - [x] 25.2 Implement `ActivationPage` at `packages/frontend/src/pages/ActivationPage.tsx`
    - Form: license key, school name, school code, admin email, admin password
    - Call `POST /api/v1/activate`; display success with school code; redirect to login
    - _Requirements: 1.1, 1.6_
  - [x] 25.3 Implement `RegisterPage` at `packages/frontend/src/pages/RegisterPage.tsx`
    - Resolve link token on mount; pre-fill school/department/class; form: full name, admission number
    - Call `POST /api/v1/registration-links/:token/register`
    - _Requirements: 4.7_

- [x] 26. Implement IndexedDB offline store and service worker
  - [x] 26.1 Implement `offlineStore.ts` in `packages/frontend/src/services/offlineStore.ts` using `idb`
    - Define `SAMSDatabase` schema with stores: `pendingAttendance`, `biometricTemplates`, `sessionCache`, `studentCache`
    - Implement `saveAttendanceRecord`, `getPendingRecords`, `markSynced`, `saveBiometricTemplate`, `getTemplatesForClass`
    - _Requirements: 8.1, 8.5_
  - [x] 26.2 Implement `syncService.ts` in `packages/frontend/src/services/syncService.ts`
    - `syncPendingRecords()`: fetch pending from IndexedDB, POST to `/api/v1/attendance/sync`, mark synced
    - `onConnectivityRestored()`: register `window.addEventListener('online', ...)` to trigger sync within 30 s
    - _Requirements: 8.2, 5.9, 6.4_
  - [x] 26.3 Implement Service Worker in `packages/frontend/public/sw.js`
    - Cache-first for static assets (`sams-static-v1`)
    - Network-first with IndexedDB fallback for API GET requests (`sams-api-v1`)
    - Queue POST/PUT requests in IndexedDB when offline; replay on reconnect
    - _Requirements: 8.1, 8.5_
  - [x] 26.4 Register Service Worker in `packages/frontend/src/workers/swRegistration.ts`
    - _Requirements: 8.1_

- [x] 27. Implement QR attendance frontend
  - [x] 27.1 Implement `SessionPage` at `packages/frontend/src/pages/SessionPage.tsx` (Teacher view)
    - Start session form: select timetable entry, capture GPS coordinates
    - Display live QR code rendered with `qrcode` library from JWT string
    - Subscribe to `qr:refresh` Socket.io event to update QR display every 30 s
    - Real-time attendance list updated via `attendance:update` Socket.io events
    - End session button
    - _Requirements: 5.1, 5.2, 9.1, 9.2_
  - [x] 27.2 Implement `QRScanPage` at `packages/frontend/src/pages/QRScanPage.tsx` (Student view)
    - Camera-based QR scanner using browser APIs
    - Capture GPS coordinates on scan
    - POST to `/api/v1/attendance/qr`; if offline, save to IndexedDB via `offlineStore`
    - Display success/error feedback
    - _Requirements: 5.3, 5.4, 5.9_

- [x] 28. Implement manual attendance frontend
  - [x] 28.1 Implement `ManualAttendancePage` at `packages/frontend/src/pages/ManualAttendancePage.tsx`
    - Fetch student list for teacher's class from `/api/v1/users?role=STUDENT&classId=...`
    - Render each student with status selector (PRESENT/LATE/EXCUSED/ABSENT) and optional note field (≤500 chars)
    - Submit marks individually or in bulk; if offline, save to IndexedDB
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 29. Implement biometric attendance frontend
  - [x] 29.1 Implement `BiometricEnrollPage` at `packages/frontend/src/pages/BiometricEnrollPage.tsx`
    - Load `face-api.js` models (SSD MobileNet, face landmark, face recognition)
    - Capture video frame, run `detectSingleFace().withFaceLandmarks().withFaceDescriptor()`
    - Perform liveness detection (blink/head-turn challenge)
    - Encrypt descriptor with AES-256-GCM using school key before sending
    - POST encrypted descriptor to `/api/v1/biometric/enroll`
    - Gate UI behind plan tier check (Pro/Enterprise only)
    - _Requirements: 7.2, 7.3, 7.8, 12.4_
  - [x] 29.2 Implement `BiometricAttendancePage` at `packages/frontend/src/pages/BiometricAttendancePage.tsx`
    - Load cached templates from IndexedDB (or fetch from `/api/v1/biometric/templates/:classId`)
    - Decrypt templates client-side; run face detection on live video frame
    - Compute Euclidean distances; find best match with confidence score
    - If confidence ≥ threshold: POST to `/api/v1/attendance/biometric`; if offline, save to IndexedDB
    - If confidence < threshold: show retry prompt
    - _Requirements: 7.4, 7.5, 7.6, 7.7_

- [x] 30. Implement reports and risk score frontend
  - [x] 30.1 Implement `ReportsPage` at `packages/frontend/src/pages/ReportsPage.tsx`
    - Role-aware: Student sees personal report; Teacher sees class report; HOD sees department report; Admin sees school report
    - Date range picker; attendance percentage display per student
    - Export button (PDF/Excel) calling `/api/v1/reports/:reportId/export`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [x] 30.2 Implement `RiskScorePage` at `packages/frontend/src/pages/RiskScorePage.tsx`
    - Display risk scores with color-coded risk levels (LOW=green, MEDIUM=yellow, HIGH=orange, CRITICAL=red)
    - Filterable by risk level; scoped to HOD/Admin role
    - _Requirements: 11.2, 11.3_

- [x] 31. Implement AI assistant frontend
  - [x] 31.1 Implement `AIAssistantPage` at `packages/frontend/src/pages/AIAssistantPage.tsx`
    - Chat interface with text input and send button
    - Voice input button using `useVoiceQuery` hook (Web Speech API, `lang='en-KE'`)
    - POST to `/api/v1/ai/query` or `/api/v1/ai/voice`; display response in chat bubble
    - Show "not available" message for out-of-scope queries
    - _Requirements: 14.1, 14.6, 14.7_
  - [x] 31.2 Implement `useVoiceQuery` hook in `packages/frontend/src/hooks/useVoiceQuery.ts`
    - Initialize `SpeechRecognition` with `lang='en-KE'`; on result, call `submitQuery(transcript)`
    - _Requirements: 14.6_

- [x] 32. Implement Super Admin panel frontend
  - [x] 32.1 Scaffold `packages/super-admin` with Vite + React + TypeScript + TailwindCSS
    - Separate build output deployed to `super.sams.ke`
    - _Requirements: 15.1, 20.3_
  - [x] 32.2 Implement Super Admin dashboard pages
    - `LicenseGeneratorPage`: form to generate license key (school name, plan tier, expiry); display generated key once
    - `SchoolsListPage`: table of all schools with plan tier, student count, status; suspend/unsuspend/extend actions
    - `RevenuePage`: aggregated revenue stats by plan tier
    - `AuditLogPage`: filterable audit log viewer (by school, date range, event type)
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6_

- [x] 33. Checkpoint — all frontend pages complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 34. Write integration tests
  - [ ]* 34.1 Write integration tests for M-Pesa payment flow
    - Mock Daraja STK push and callback using `msw`; assert Payment record transitions and school plan update
    - _Requirements: 13.1, 13.2, 13.3_
  - [ ]* 34.2 Write integration tests for WebSocket real-time feed
    - Use `socket.io-client` to connect as Teacher; trigger attendance record creation; assert `attendance:update` event received within 2 s
    - Assert event replay on reconnect
    - _Requirements: 9.1, 9.2, 9.3_
  - [ ]* 34.3 Write integration tests for offline sync timing
    - Save records to IndexedDB; simulate connectivity restore; assert sync completes within 30 s
    - _Requirements: 8.2_
  - [ ]* 34.4 Write integration tests for SMS/email notification delivery
    - Mock Africa's Talking and Nodemailer; trigger attendance threshold breach; assert SMS and email sent
    - Assert retry logic on SMS failure (up to 3 retries, 60 s interval)
    - _Requirements: 18.1, 18.6_
  - [ ]* 34.5 Write integration tests for timetable conflict detection
    - Create overlapping timetable entries for same teacher/class/room; assert `TIMETABLE_CONFLICT` error
    - _Requirements: 17.2_
  - [ ]* 34.6 Write integration tests for plan tier feature gating
    - Assert biometric endpoint returns 403 for Trial/Basic schools
    - Assert AI endpoint returns 403 for Trial/Basic schools
    - _Requirements: 12.2, 12.4_

- [x] 35. Configure deployment infrastructure
  - [x] 35.1 Write NGINX configuration in `nginx/sams.conf`
    - Virtual hosts for `sams.ke`, `api.sams.ke`, `super.sams.ke` with SSL, WebSocket upgrade headers, SPA fallback, static asset caching, and rate limiting
    - HTTP → HTTPS 301 redirect for all hosts
    - IP allowlist for `super.sams.ke`
    - _Requirements: 20.1, 20.3, 19.1, 15.1_
  - [x] 35.2 Write PM2 ecosystem config in `ecosystem.config.js`
    - `sams-api` app: 2 cluster instances, auto-restart on crash, log paths
    - _Requirements: 20.1, 20.5_
  - [x] 35.3 Write GitHub Actions CI/CD pipeline in `.github/workflows/deploy.yml`
    - `test` job: checkout, setup Node 20, `npm ci`, `npm run test --workspaces`, `npm run build --workspaces`
    - `deploy` job (needs test): SSH to VPS, `git pull`, `npm ci`, `npm run build`, `prisma migrate deploy`, `pm2 reload`, `nginx -t && systemctl reload nginx`
    - _Requirements: 20.2_

- [x] 36. Final checkpoint — full system integration
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP delivery
- Each task references specific requirements for full traceability
- Property-based tests use `fast-check` with a minimum of 100 iterations per property
- Unit tests use `vitest`; integration tests use `supertest` + `socket.io-client` + `msw`
- All 35 correctness properties from the design document are covered by property test sub-tasks
- Checkpoints at tasks 19, 23, 33, and 36 ensure incremental validation at major milestones
- The biometric and AI features are gated behind Pro/Enterprise plan tier checks — implement the gate before the feature pages
- The Super Admin panel (`super.sams.ke`) must never be linked from `sams.ke` or `api.sams.ke`
- Offline sync must complete within 30 seconds of connectivity restoration per Requirements 8.2, 5.9, 6.4

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["2.1", "3.1", "3.2"]
    },
    {
      "id": 1,
      "tasks": ["2.2", "2.3", "2.4", "2.5", "3.3", "3.4"]
    },
    {
      "id": 2,
      "tasks": ["2.6", "2.7", "2.8", "2.9", "3.5", "3.6"]
    },
    {
      "id": 3,
      "tasks": ["4.1", "4.2", "4.3", "4.4"]
    },
    {
      "id": 4,
      "tasks": ["4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "5.1"]
    },
    {
      "id": 5,
      "tasks": ["5.2", "5.3", "5.4", "5.5", "6.1", "6.2", "6.3", "6.4"]
    },
    {
      "id": 6,
      "tasks": ["6.5", "6.6", "6.7", "6.8", "7.1", "8.1"]
    },
    {
      "id": 7,
      "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "8.2", "15.1", "15.2"]
    },
    {
      "id": 8,
      "tasks": ["9.1", "9.2", "9.3", "9.4", "15.3", "18.1"]
    },
    {
      "id": 9,
      "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "17.1", "17.2"]
    },
    {
      "id": 10,
      "tasks": ["10.6", "10.7", "10.8", "10.9", "10.10", "11.1", "11.2", "12.1", "16.1"]
    },
    {
      "id": 11,
      "tasks": ["11.3", "11.4", "12.2", "13.1", "13.2", "14.1", "14.2", "14.3", "16.2", "18.2", "18.3"]
    },
    {
      "id": 12,
      "tasks": ["20.1", "20.2", "20.3", "21.1", "21.2", "21.3", "21.4", "22.1", "22.2"]
    },
    {
      "id": 13,
      "tasks": ["20.4", "20.5", "24.1", "24.2", "24.3", "24.4"]
    },
    {
      "id": 14,
      "tasks": ["25.1", "25.2", "25.3", "26.1", "26.2", "26.3", "26.4"]
    },
    {
      "id": 15,
      "tasks": ["27.1", "27.2", "28.1", "29.1", "29.2", "30.1", "30.2", "31.1", "31.2", "32.1"]
    },
    {
      "id": 16,
      "tasks": ["32.2", "34.1", "34.2", "34.3", "34.4", "34.5", "34.6"]
    },
    {
      "id": 17,
      "tasks": ["35.1", "35.2", "35.3"]
    }
  ]
}
```
