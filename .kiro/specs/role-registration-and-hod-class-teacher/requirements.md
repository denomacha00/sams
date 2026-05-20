# Requirements Document

## Introduction

This spec covers a set of bug fixes and new features for the SAMS (Smart Attendance Management System) project. The changes span five areas:

1. **Bug fix** — The `/admin/links` route in `main.tsx` blocks `TEACHER` users due to a missing role in the `AuthGuard` `allowedRoles` list.
2. **Bug fix** — The `GET /registration-links/:token` backend endpoint does not resolve `departmentName` for teacher-targeted links (links that carry a `departmentId` but no `classId`), so the `RegisterPage` cannot display the department to the registrant.
3. **New feature** — HODs need a Department Management page where they can view all teachers in their department and assign a class teacher to any class in their department. The `Class` model requires a new `classTeacherId` field, and new backend endpoints are needed to support this.
4. **New feature** — Teachers need working access to the Registration Links page so they can generate student registration links for their class (the UI already exists but is blocked by bug #1).
5. **New feature** — Students need a reliable, prominent path to scan a QR code and mark their attendance. The `QRScanPage` exists and is routed correctly; this requirement ensures the end-to-end flow is verified and the student dashboard surfaces the action clearly.

## Glossary

- **SAMS**: Smart Attendance Management System — the application being modified.
- **AuthGuard**: A React component in `main.tsx` that wraps routes and redirects unauthenticated or unauthorised users.
- **SCHOOL_ADMIN**: A user role with full school-level administrative access.
- **HOD**: Head of Department — a user role scoped to a single department within a school.
- **TEACHER**: A user role scoped to a department and optionally a class within a school.
- **STUDENT**: A user role scoped to a class within a department.
- **RegistrationLink**: A database record containing a one-time-use or limited-use token that allows self-registration into a specific role, school, department, and/or class.
- **Class_Teacher**: A teacher designated as the primary responsible teacher for a specific class. Stored as `classTeacherId` on the `Class` model.
- **RegisterPage**: The public-facing React page at `/register/:token` where a new user completes self-registration using a link token.
- **RegistrationLinksPage**: The authenticated React page at `/admin/links` where SCHOOL_ADMIN, HOD, and TEACHER users manage registration links.
- **QRScanPage**: The authenticated React page at `/sessions/scan` where students scan a teacher's QR code to mark attendance.
- **Router**: The React Router configuration in `packages/frontend/src/main.tsx`.
- **RegistrationLinkService**: The backend service class in `packages/backend/src/services/registrationLinkService.ts` that handles link generation, resolution, and registration.
- **DepartmentsRouter**: The Express router in `packages/backend/src/routes/departments.ts` that handles department and class CRUD.
- **ClassesRouter**: The Express router in `packages/backend/src/routes/departments.ts` that handles class-level operations.
- **RBAC**: Role-Based Access Control — enforced via `packages/backend/src/middleware/rbac.ts`.
- **Prisma**: The ORM used to interact with the PostgreSQL database.

---

## Requirements

### Requirement 1: Teacher Access to Registration Links Page

**User Story:** As a teacher, I want to access the Registration Links page at `/admin/links`, so that I can generate student registration links for my class.

#### Acceptance Criteria

1. WHEN a user with the `TEACHER` role navigates to `/admin/links`, THE Router SHALL grant access to the `RegistrationLinksPage` component without redirecting the user away from the page.
2. WHEN a user with the `SCHOOL_ADMIN` or `HOD` role navigates to `/admin/links`, THE Router SHALL continue to grant access as before, with no regression.
3. WHEN a user with the `STUDENT` role navigates to `/admin/links`, THE Router SHALL redirect the user away from the page, denying access.
4. THE Router SHALL enforce the updated `allowedRoles` list `[SCHOOL_ADMIN, HOD, TEACHER]` on the `/admin/links` route guard.

---

### Requirement 2: Department Name Resolution for Teacher Registration Links

**User Story:** As a prospective teacher registering via a HOD-generated link, I want to see the department I am joining on the registration page, so that I can confirm I am registering for the correct department.

#### Acceptance Criteria

1. WHEN the `GET /registration-links/:token` endpoint is called with a token whose link has a `departmentId` and no `classId`, THE RegistrationLinkService SHALL fetch the department name from the `Department` table using the link's `departmentId`.
2. WHEN the `GET /registration-links/:token` endpoint is called with a token whose link has a `departmentId` and no `classId`, THE RegistrationLinkService SHALL include `departmentName` in the response payload.
3. WHEN the `GET /registration-links/:token` endpoint is called with a token whose link has both a `classId` and a `departmentId`, THE RegistrationLinkService SHALL resolve `departmentName` from the class's associated department (existing behaviour), not from the link's `departmentId` directly.
4. WHEN the `GET /registration-links/:token` endpoint is called with a token whose link has neither a `classId` nor a `departmentId`, THE RegistrationLinkService SHALL return `departmentName` as `null` or omit it from the response.
5. WHEN the `RegisterPage` receives a link metadata response that includes a non-null `departmentName`, THE RegisterPage SHALL display the department name in the registration context info panel.
6. IF the `departmentId` on the link does not correspond to any department in the database, THEN THE RegistrationLinkService SHALL return `departmentName` as `null` without throwing an error.

---

### Requirement 3: Class Model — Class Teacher Field

**User Story:** As a system, I need the `Class` model to support a designated class teacher, so that HODs can assign and track which teacher is responsible for each class.

#### Acceptance Criteria

1. THE Prisma schema SHALL include a nullable `classTeacherId` field on the `Class` model, referencing the `User` table.
2. THE Prisma schema SHALL define the relation such that a `User` can be the class teacher of zero or more classes, and a `Class` has at most one class teacher.
3. WHEN a Prisma migration is applied, THE Database SHALL add the `classTeacherId` column to the `classes` table as a nullable foreign key referencing `users.id`.
4. WHEN the `GET /classes` endpoint is called, THE ClassesRouter SHALL include `classTeacherId` and the associated teacher's `fullName` (as `classTeacherName`) in each class object in the response.
5. IF a class has no assigned class teacher, THEN THE ClassesRouter SHALL return `classTeacherId` as `null` and `classTeacherName` as `null` for that class.

---

### Requirement 4: HOD — View Teachers in Department

**User Story:** As an HOD, I want to view all teachers in my department, so that I can see who is available to be assigned as a class teacher.

#### Acceptance Criteria

1. THE DepartmentsRouter SHALL expose a `GET /departments/:id/teachers` endpoint that returns all users with the `TEACHER` role whose `departmentId` matches the requested department.
2. WHEN a user with the `HOD` role calls `GET /departments/:id/teachers` with their own department's ID, THE DepartmentsRouter SHALL return the list of teachers in that department.
3. WHEN a user with the `HOD` role calls `GET /departments/:id/teachers` with a department ID that is not their own, THE DepartmentsRouter SHALL return a `403 Forbidden` response.
4. WHEN a user with the `SCHOOL_ADMIN` role calls `GET /departments/:id/teachers`, THE DepartmentsRouter SHALL return the list of teachers for the specified department without department-scope restriction.
5. WHEN a user with the `TEACHER` or `STUDENT` role calls `GET /departments/:id/teachers`, THE DepartmentsRouter SHALL return a `403 Forbidden` response.
6. THE response from `GET /departments/:id/teachers` SHALL include at minimum each teacher's `id`, `fullName`, `email`, and `phone` fields.
7. IF the requested department does not belong to the authenticated user's school, THEN THE DepartmentsRouter SHALL return a `404 Not Found` response.

---

### Requirement 5: HOD — Assign Class Teacher

**User Story:** As an HOD, I want to assign a teacher from my department as the class teacher for a specific class, so that there is a clear point of responsibility for each class.

#### Acceptance Criteria

1. THE ClassesRouter SHALL expose a `POST /classes/:id/assign-teacher` endpoint that accepts a `teacherId` in the request body and sets that teacher as the class teacher for the specified class.
2. WHEN a user with the `HOD` role calls `POST /classes/:id/assign-teacher` with a `teacherId` of a teacher in their department, THE ClassesRouter SHALL update the `classTeacherId` field on the class and return the updated class object. WHEN a user who is not an `HOD` or `SCHOOL_ADMIN` calls this endpoint, THE ClassesRouter SHALL return a `403 Forbidden` response.
3. WHEN a user with the `HOD` role calls `POST /classes/:id/assign-teacher` with a `teacherId` of a teacher who is not in the HOD's department, THE ClassesRouter SHALL return a `403 Forbidden` response.
4. WHEN a user with the `HOD` role calls `POST /classes/:id/assign-teacher` for a class that does not belong to their department, THE ClassesRouter SHALL return a `403 Forbidden` response.
5. WHEN a user with the `SCHOOL_ADMIN` role calls `POST /classes/:id/assign-teacher`, THE ClassesRouter SHALL validate that the `teacherId` exists in the school before processing the assignment, returning `404 Not Found` if the teacher does not exist, and then allow the assignment without department restriction.
6. WHEN a user with the `TEACHER` or `STUDENT` role calls `POST /classes/:id/assign-teacher`, THE ClassesRouter SHALL return a `403 Forbidden` response.
7. IF the `teacherId` in the request body does not correspond to an existing user in the school, THEN THE ClassesRouter SHALL return a `404 Not Found` response.
8. IF the `classId` in the route parameter does not correspond to an existing class in the school, THEN THE ClassesRouter SHALL return a `404 Not Found` response.
9. WHEN a class teacher is successfully assigned, THE ClassesRouter SHALL return the updated class object including `classTeacherId` and `classTeacherName`.

---

### Requirement 6: HOD Department Management Page

**User Story:** As an HOD, I want a dedicated Department Management page in the frontend, so that I can view my department's teachers and assign class teachers to classes from a single interface.

#### Acceptance Criteria

1. THE Router SHALL expose a new protected route at `/hod/department` accessible only to users with the `HOD` role.
2. WHEN an HOD navigates to `/hod/department`, THE HOD_DepartmentPage SHALL display a list of all teachers in the HOD's department, fetched from `GET /departments/:id/teachers`.
3. WHEN an HOD navigates to `/hod/department`, THE HOD_DepartmentPage SHALL display a list of all classes in the HOD's department, fetched from `GET /departments/:id/classes`.
4. FOR each class displayed, THE HOD_DepartmentPage SHALL show the currently assigned class teacher's name if one exists, or a placeholder indicating no class teacher is assigned.
5. WHEN an HOD selects a teacher and a class and confirms the assignment, THE HOD_DepartmentPage SHALL call `POST /classes/:id/assign-teacher` and update the displayed class teacher name on success.
6. IF the assignment API call fails, THEN THE HOD_DepartmentPage SHALL display an error message to the HOD without navigating away from the page.
7. THE HOD dashboard quick actions SHALL include a link to `/hod/department` labelled "Department Management".
8. WHEN a user with the `SCHOOL_ADMIN` role views the classes list (via `GET /classes` or the Departments admin page), THE AdminDashboardPage SHALL display the `classTeacherName` for each class that has one assigned.

---

### Requirement 7: Teacher — Generate Student Registration Links

**User Story:** As a teacher, I want to generate student registration links for my class from the Registration Links page, so that I can onboard students without requiring admin intervention.

#### Acceptance Criteria

1. WHEN a `TEACHER` user accesses `/admin/links`, THE RegistrationLinksPage SHALL display only the option to generate `STUDENT`-targeted links (no HOD or TEACHER link options).
2. WHEN a `TEACHER` user opens the Generate Link modal, THE RegistrationLinksPage SHALL display a class picker populated with classes from the teacher's department, fetched from `GET /departments/:departmentId/classes`.
3. WHEN a `TEACHER` user selects a class and submits the Generate Link form, THE RegistrationLinksPage SHALL call `POST /registration-links` with `targetRole: "STUDENT"` (always forced to STUDENT regardless of any other state), the selected `classId`, and the teacher's `departmentId`.
4. WHEN the backend receives a `POST /registration-links` request from a `TEACHER` with `targetRole: "STUDENT"` and a valid `classId`, THE RegistrationLinkService SHALL create the link and return it with a `201 Created` status. IF a `TEACHER` submits a request with any `targetRole` other than `"STUDENT"`, THE RegistrationLinkService SHALL reject the request with a `400 Bad Request` response.
5. WHEN a `TEACHER` user's department has no classes, THE RegistrationLinksPage SHALL display a message instructing the teacher to ask their HOD to create classes first.
6. THE RegistrationLinksPage SHALL display all links previously created by the authenticated teacher, including their status, use count, and expiry date.

---

### Requirement 8: Student — QR Code Attendance Scanning

**User Story:** As a student, I want to scan a teacher's QR code to mark my attendance, so that my presence in class is recorded accurately and quickly.

#### Acceptance Criteria

1. WHEN a `STUDENT` user navigates to `/sessions/scan`, THE Router SHALL grant access to the `QRScanPage` without redirecting.
2. WHEN a student taps "Start Scanner" on the `QRScanPage`, THE QRScanPage SHALL request camera access from the browser.
3. WHEN the camera detects a valid QR token, THE QRScanPage SHALL call `POST /attendance/qr` with the decoded `qrToken` and the student's GPS coordinates (if available).
4. WHEN the `POST /attendance/qr` call succeeds, THE QRScanPage SHALL display a success confirmation to the student.
5. IF the device is offline when a QR code is scanned, THEN THE QRScanPage SHALL save the attendance record to the local offline store and display a message indicating the record will sync when connectivity is restored.
6. IF the `POST /attendance/qr` call returns an error (e.g. session expired, already marked), THEN THE QRScanPage SHALL display the error message returned by the server.
7. THE student dashboard quick actions SHALL include a "Scan QR" action linking to `/sessions/scan` as the first or most prominent action.
8. WHEN a student's GPS location cannot be acquired within 5 seconds, THE QRScanPage SHALL proceed with the attendance submission without GPS coordinates and display a "GPS Unavailable" indicator.
