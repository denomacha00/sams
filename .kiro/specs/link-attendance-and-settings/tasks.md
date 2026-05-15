# Tasks: Link-Based Attendance & Separate Settings

## Task 1: Database schema update for link attendance [REQ-1, REQ-3]
- [x] Add `currentLinkToken String?` field to AttendanceSession model in schema.prisma
- [x] Add `linkExpiresAt DateTime?` field to AttendanceSession model in schema.prisma
- [x] Create a new Prisma migration for these fields
- [x] Run `npx prisma generate` to update the Prisma client

## Task 2: Backend - Link generation endpoint [REQ-1, REQ-3] [depends:1]
- [x] Add `generateAttendanceLink` method to `attendanceService.ts` that creates a JWT with `{ sessionId, type: 'LINK', nonce, iat, exp }` using QR_SECRET
- [x] Add validation schema for link generation request (sessionId: string, expiryMinutes: number 1-60)
- [x] Add `POST /api/v1/attendance/link/generate` route in `attendance.ts` with `requirePermission('start:session')`
- [x] The endpoint validates session exists, is active, belongs to teacher's school
- [x] Store the generated token and expiry on the AttendanceSession record
- [x] Return `{ linkToken, linkUrl, expiresAt, sessionId }` where linkUrl = `${FRONTEND_URL}/attend/${linkToken}`

## Task 3: Backend - Link attendance recording endpoint [REQ-2, REQ-3] [depends:1]
- [x] Add `recordLinkAttendance` method to `attendanceService.ts`
- [x] Add validation schema for link attendance request (linkToken: string, gpsCoords: { lat, lng })
- [x] Add `POST /api/v1/attendance/link` route (authenticated, no special permission)
- [x] Verify JWT signature and expiry, extract sessionId
- [x] Validate token has `type: 'LINK'` to prevent QR token reuse
- [x] Fetch session, check isActive
- [x] Validate GPS proximity using `haversineDistance` against session locationLat/Lng/RadiusM
- [x] Check duplicate via sessionId + studentId unique constraint
- [x] Classify status (PRESENT/LATE) using `classifyAttendanceStatus`
- [x] Create AttendanceRecord with method="LINK"
- [x] Broadcast via WebSocket and trigger risk score recomputation

## Task 4: Backend - Link info endpoint [REQ-2] [depends:1]
- [x] Add `GET /api/v1/attendance/link/:token/info` route (authenticated)
- [x] Verify the token JWT, extract sessionId
- [x] Fetch session with class and teacher info
- [x] Return `{ valid, sessionId, subject, className, teacherName, expiresAt }` or `{ valid: false, error }` if expired/invalid/ended

## Task 5: Frontend - Link generation UI on Session page [REQ-1, REQ-4] [depends:2]
- [x] Add "Share Link" button to `SessionPage.tsx` next to QR code display
- [x] Create a link generation panel/modal with expiry time selector (5, 10, 15, 30, 60 min dropdown)
- [x] Display the session's distance setting (locationRadiusM) as info text
- [x] Call `POST /api/v1/attendance/link/generate` when teacher clicks generate
- [x] Show the generated link with a "Copy" button (navigator.clipboard.writeText)
- [x] Add "Share" button using Web Share API (navigator.share) with fallback to copy
- [x] Show link status (active with countdown timer / expired)
- [x] Add "Regenerate" button to create a new link

## Task 6: Frontend - Link Attendance page for students [REQ-2] [depends:3,4]
- [x] Create `LinkAttendancePage.tsx` component
- [x] Add route `/attend/:token` inside AuthGuard in `main.tsx`
- [x] On mount, call `GET /api/v1/attendance/link/:token/info` to display session details
- [x] If user not authenticated, redirect to `/login?redirect=/attend/:token`
- [x] Request GPS permission using `navigator.geolocation.getCurrentPosition`
- [x] Display session info: subject, teacher name, class name, expiry countdown
- [x] "Mark Attendance" button calls `POST /api/v1/attendance/link` with token + GPS coords
- [x] Show success state (green checkmark, status PRESENT/LATE)
- [x] Show error states: expired link, out of range (with distance), already recorded, session ended
- [x] Style consistently with existing SAMS dark theme

## Task 7: Frontend - Create ProfilePage (split from Settings) [REQ-5, REQ-7] [depends:0]
- [x] Create `ProfilePage.tsx` with avatar upload, full name/email/phone form, and account info section
- [x] Extract the profile-related code from current `SettingsPage.tsx` into `ProfilePage.tsx`
- [x] Add `/profile` route in `main.tsx` inside AuthGuard
- [x] Ensure the profile update API call (`PATCH /users/me`) works from the new page
- [x] Style consistently with existing SAMS dark theme (glassmorphism cards)

## Task 8: Frontend - Refactor SettingsPage (remove profile, keep security) [REQ-6, REQ-7] [depends:7]
- [x] Remove profile editing (name, email, phone, avatar) from `SettingsPage.tsx`
- [x] Remove account info section from `SettingsPage.tsx`
- [x] Keep: Change Password, Fingerprint/WebAuthn registration, Face Enrollment (students)
- [x] Add section headers: "Security", "Biometrics"
- [x] Add a link/button at top: "Edit your profile →" pointing to `/profile`
- [x] Ensure all existing functionality (password change, fingerprint, face enroll) still works

## Task 9: Frontend - Navigation update for Profile & Settings [REQ-7] [depends:7,8]
- [x] Update DashboardPage sidebar/navigation to show separate "Profile" and "Settings" items
- [x] Profile item: user icon, links to `/profile`
- [x] Settings item: gear icon, links to `/settings`
- [x] Highlight active page in navigation
- [x] Ensure navigation works for all roles (student, teacher, HOD, admin)
