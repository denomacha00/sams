# Technical Design: Link-Based Attendance & Separate Settings

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
├─────────────────────────────────────────────────────────────────┤
│  SessionPage.tsx          │  ProfilePage.tsx (NEW)               │
│  ├─ QR Code display       │  ├─ Avatar upload                   │
│  ├─ Link Generation (NEW) │  ├─ Name/Email/Phone edit           │
│  └─ Link Share UI (NEW)   │  └─ Account info display            │
│                           │                                      │
│  LinkAttendancePage (NEW) │  SettingsPage.tsx (REFACTORED)       │
│  ├─ GPS capture           │  ├─ Change Password                 │
│  ├─ Token validation      │  ├─ Fingerprint/WebAuthn            │
│  └─ Status display        │  ├─ Face Enrollment                 │
│                           │  └─ Notification preferences         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Express + Prisma)                    │
├─────────────────────────────────────────────────────────────────┤
│  routes/attendance.ts                                            │
│  ├─ POST /api/v1/attendance/link/generate  (teacher)            │
│  ├─ POST /api/v1/attendance/link           (student)            │
│  └─ GET  /api/v1/attendance/link/:token/info (public metadata)  │
│                                                                  │
│  services/attendanceService.ts                                   │
│  ├─ generateAttendanceLink(sessionId, expiryMin)                │
│  └─ recordLinkAttendance(studentId, token, gpsCoords)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Database (PostgreSQL)                         │
├─────────────────────────────────────────────────────────────────┤
│  AttendanceSession (existing)                                    │
│  ├─ currentLinkToken    String?   (NEW field)                   │
│  ├─ linkExpiresAt       DateTime? (NEW field)                   │
│  └─ locationRadiusM     Int       (existing, reused for link)   │
│                                                                  │
│  AttendanceRecord.method: "QR"|"MANUAL"|"BIOMETRIC"|"LINK"(NEW) │
└─────────────────────────────────────────────────────────────────┘
```

---

## Feature 1: Link-Based Attendance

### Database Changes

Add two fields to `AttendanceSession`:

```prisma
model AttendanceSession {
  // ... existing fields ...
  currentLinkToken   String?    // JWT token for link attendance
  linkExpiresAt      DateTime?  // When the current link expires
}
```

No new tables needed — the link is just another method on the existing session.

### Backend API Design

#### POST /api/v1/attendance/link/generate
**Auth:** Teacher (requirePermission('start:session'))
**Purpose:** Generate a shareable attendance link for an active session.

```typescript
// Request body
{
  sessionId: string;
  expiryMinutes: number; // 1-60, default 5
}

// Response
{
  linkToken: string;
  linkUrl: string;        // Full URL: {FRONTEND_URL}/attend/{linkToken}
  expiresAt: string;      // ISO timestamp
  sessionId: string;
}
```

**Logic:**
1. Validate session exists, is active, belongs to teacher
2. Generate JWT: `{ sessionId, type: 'LINK', nonce, iat, exp: now + expiryMinutes*60 }`
3. Store token + expiry on session record
4. Return full shareable URL

#### POST /api/v1/attendance/link
**Auth:** Authenticated student
**Purpose:** Record attendance via link token.

```typescript
// Request body
{
  linkToken: string;
  gpsCoords: { lat: number; lng: number; }
}

// Response (success)
{
  id: string;
  status: "PRESENT" | "LATE";
  method: "LINK";
  scannedAt: string;
}
```

**Logic:**
1. Verify JWT signature and expiry
2. Extract sessionId from token
3. Fetch session, validate isActive
4. Check GPS proximity (haversineDistance vs locationRadiusM)
5. Check duplicate (sessionId + studentId unique)
6. Classify status (PRESENT vs LATE based on lateThresholdMin)
7. Create AttendanceRecord with method="LINK"
8. Broadcast via WebSocket

#### GET /api/v1/attendance/link/:token/info
**Auth:** Authenticated user
**Purpose:** Get link metadata (session subject, class name) for the attendance page UI.

```typescript
// Response
{
  valid: boolean;
  sessionId?: string;
  subject?: string;
  className?: string;
  teacherName?: string;
  expiresAt?: string;
  error?: string; // "EXPIRED" | "SESSION_ENDED" | "INVALID"
}
```

### Frontend: Link Generation (Teacher Side)

Add to `SessionPage.tsx`:
- "Share Link" button next to QR code
- Modal/panel with:
  - Expiry time selector (dropdown: 5, 10, 15, 30, 60 minutes)
  - Distance display (uses session's locationRadiusM)
  - Generated link with copy button
  - Share button (Web Share API if available)
  - Link status indicator (active/expired)
  - Regenerate button

### Frontend: Link Attendance Page (Student Side)

New page: `LinkAttendancePage.tsx` at route `/attend/:token`

Flow:
1. Page loads → calls GET `/attendance/link/:token/info` to show session details
2. If user not logged in → redirect to `/login?redirect=/attend/:token`
3. Request GPS permission
4. Show session info (subject, teacher, class)
5. "Mark Attendance" button → POST `/attendance/link` with token + GPS
6. Show success/error result

This route should be **semi-public** (inside AuthGuard but accessible to all authenticated users).

### Token Design

```typescript
interface LinkTokenPayload {
  sessionId: string;
  type: 'LINK';       // Distinguishes from QR tokens
  nonce: string;      // Unique per generation
  iat: number;
  exp: number;        // Teacher-configured expiry
}
```

Uses same `QR_SECRET` for signing. The `type: 'LINK'` field prevents QR tokens from being used as link tokens and vice versa.

---

## Feature 2: Separate Settings from Profile

### Frontend Route Changes

```typescript
// main.tsx additions
import ProfilePage from './pages/ProfilePage';

// Inside AuthGuard routes:
<Route path="/profile" element={<ProfilePage />} />
<Route path="/settings" element={<SettingsPage />} />  // already exists
```

### ProfilePage.tsx (NEW)

Contains (extracted from current SettingsPage):
- Avatar upload with camera icon
- Full name, email, phone form
- Role display badge
- Account information section (role, school, status, app version)
- "Update Profile" submit button

### SettingsPage.tsx (REFACTORED)

Keeps only:
- **Security section:** Change Password form
- **Biometrics section:** Fingerprint/WebAuthn registration (all roles), Face enrollment (students only)
- **Preferences section:** (future) Notification preferences, theme toggle

Removes:
- Avatar upload
- Name/email/phone editing
- Account info display

### Navigation Updates

The DashboardPage sidebar/navigation needs two separate items:
- 👤 Profile → `/profile`
- ⚙️ Settings → `/settings`

Both accessible to all authenticated roles.

---

## Shared Package Changes

Update `@sams/shared` to include "LINK" in attendance method types if there's a shared type/enum for it. The `AttendanceRecord.method` field is currently a plain string, so no enum change needed in Prisma — just ensure frontend displays "Link" properly.

---

## Security Considerations

1. **Link tokens** use the same HMAC signing as QR tokens — cannot be forged
2. **GPS validation** is server-side — client cannot bypass distance check
3. **One-use-per-student** enforced by unique constraint (sessionId + studentId)
4. **Session must be active** — ended sessions reject link attendance
5. **Token expiry** — configurable by teacher, enforced by JWT exp claim
6. **Authentication required** — anonymous users cannot use attendance links
