# Requirements: Link-Based Attendance & Separate Settings

## Overview
Two features for SAMS:
1. **Link-Based Attendance** — Teachers generate a shareable attendance link for their class. Students open the link to mark themselves present. Like QR code attendance, the teacher sets a maximum distance (geofence radius) and time window to prevent cheating.
2. **Separate Settings from Profile** — Split the current combined Settings/Profile page into two distinct pages for all roles: a Profile page (personal info, avatar) and a Settings page (security, preferences, biometrics).

---

## Feature 1: Link-Based Attendance

### Requirement 1: Teacher generates attendance link
**User Story:** As a teacher, I want to generate a shareable attendance link for my active session so that students can mark attendance by opening the link on their phones.

**Acceptance Criteria:**
- Given a teacher has an active attendance session, when they click "Generate Link", then a unique attendance URL is created tied to that session
- The link contains a signed token (similar to QR JWT) that identifies the session
- The teacher can copy the link to clipboard or share it via messaging apps
- The link is displayed in the session management UI alongside the QR code option
- The teacher can set the link expiry time in minutes (default: 5 min, max: 60 min)
- The teacher can set the maximum distance in meters (uses the session's existing locationRadiusM, default: 100m)

### Requirement 2: Student marks attendance via link
**User Story:** As a student, I want to open an attendance link shared by my teacher and be marked present automatically.

**Acceptance Criteria:**
- Given a student opens a valid attendance link, when their GPS location is within the allowed radius, then they are marked PRESENT or LATE (based on lateThresholdMin)
- The link page requests GPS permission from the student's browser
- If the student is outside the allowed radius, they see an error: "You are X meters away, must be within Y meters"
- If the link has expired, they see an error: "This attendance link has expired"
- If the student already has an attendance record for this session, they see: "Attendance already recorded"
- The attendance record method is stored as "LINK" to distinguish from QR/MANUAL/BIOMETRIC
- Students must be authenticated (logged in) to use the link — unauthenticated users are redirected to login first

### Requirement 3: Anti-cheating measures for link attendance
**User Story:** As a teacher, I want the link to enforce location and time restrictions so students cannot cheat by sharing the link with absent classmates.

**Acceptance Criteria:**
- The link token expires after the teacher-configured time (JWT exp claim)
- GPS coordinates are validated server-side against the session's locationLat/locationLng/locationRadiusM
- Each link token can only be used once per student (duplicate check via sessionId + studentId)
- The link token is cryptographically signed and cannot be forged
- The server validates that the session is still active when the link is used
- Optional: Teacher can regenerate a new link (invalidating the previous one) for added security

### Requirement 4: Link management in teacher UI
**User Story:** As a teacher, I want to manage my attendance links from the session page.

**Acceptance Criteria:**
- The session page shows a "Share Link" button alongside the existing QR code display
- Teacher can see the current active link status (active/expired)
- Teacher can regenerate a new link at any time
- Teacher can configure link expiry duration (minutes) before generating
- The link settings (distance, time) are shown clearly in the UI
- Link attendance records appear in the same attendance list as QR/manual records

---

## Feature 2: Separate Settings from Profile

### Requirement 5: Dedicated Profile page
**User Story:** As any user (student, teacher, HOD, admin), I want a dedicated Profile page where I can view and edit my personal information.

**Acceptance Criteria:**
- A new `/profile` route is created with its own page component
- The Profile page contains: avatar upload, full name, email, phone number, role display, account info
- The Profile page has a clean, focused layout for personal information only
- Navigation shows "Profile" as a separate menu item from "Settings"
- All roles see the same Profile page structure (with role-appropriate fields)

### Requirement 6: Dedicated Settings page
**User Story:** As any user, I want a dedicated Settings page for security and app preferences, separate from my profile.

**Acceptance Criteria:**
- The `/settings` route is updated to contain only settings-related items
- Settings page includes: Change Password, Fingerprint Registration (WebAuthn), Face Enrollment (students), Notification preferences, Theme/appearance preferences
- Settings page does NOT include profile editing (name, email, phone, avatar)
- The Settings page is organized into clear sections: Security, Biometrics, Preferences
- Navigation shows "Settings" as a separate menu item from "Profile"

### Requirement 7: Navigation update for all roles
**User Story:** As any user, I want clear navigation between Profile and Settings.

**Acceptance Criteria:**
- The sidebar/navigation menu shows both "Profile" and "Settings" as separate items
- Profile icon uses a person/user icon
- Settings icon uses a gear/cog icon
- Both pages are accessible from the dashboard
- The current active page is highlighted in navigation

---

## Technical Notes

- Link tokens should use the same JWT signing approach as QR tokens (QR_SECRET)
- Link expiry should be configurable (unlike QR which auto-refreshes every 30s)
- The `AttendanceRecord.method` field should accept "LINK" as a new value
- GPS validation reuses the existing `haversineDistance` utility from `@sams/shared`
- The link attendance endpoint should be a public-ish route (authenticated but no special permission beyond being a student in the school)
- Profile/Settings split is purely frontend — no backend API changes needed for the split itself
