# Implementation Plan: role-registration-and-hod-class-teacher

## Overview

This plan covers two bug fixes and a set of new features spanning the Prisma schema, Express backend routes, and React frontend. Tasks are ordered so each step builds on the previous: schema first, then backend endpoints, then frontend pages and wiring.

## Tasks

- [x] 1. Prisma schema — add `classTeacherId` to `Class` model and inverse relation on `User`
  - [x] 1.1 Update `packages/backend/prisma/schema.prisma`
    - Add nullable `classTeacherId String?` field to the `Class` model
    - Add `classTeacher User? @relation("ClassTeacher", fields: [classTeacherId], references: [id])` to `Class`
    - Add `classesAsTeacher Class[] @relation("ClassTeacher")` inverse relation to the `User` model
    - _Requirements: 3.1, 3.2_

  - [x] 1.2 Create migration SQL file
    - Create `packages/backend/prisma/migrations/20250606000000_add_class_teacher/migration.sql`
    - SQL: `ALTER TABLE "classes" ADD COLUMN "classTeacherId" TEXT;`
    - SQL: `ALTER TABLE "classes" ADD CONSTRAINT "classes_classTeacherId_fkey" FOREIGN KEY ("classTeacherId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;`
    - _Requirements: 3.3_

  - [x] 1.3 Run `prisma generate` to regenerate the Prisma client
    - Execute `npx prisma generate` inside `packages/backend`
    - Verify the generated client includes `classTeacherId` on the `Class` type and `classesAsTeacher` on the `User` type
    - _Requirements: 3.1, 3.2_

- [x] 2. Backend — bug fix: `GET /registration-links/:token` department name resolution
  - [x] 2.1 Fix the `GET /registration-links/:token` handler in `packages/backend/src/routes/users.ts`
    - After the existing `if (link.classId)` block, add an `else if (link.departmentId)` branch
    - In that branch, query `prisma.department.findUnique({ where: { id: link.departmentId }, select: { name: true } })`
    - Set `departmentName = dept?.name ?? undefined`
    - Leave the existing class-path branch and the response shape unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

  - [ ]* 2.2 Write property test for department name resolution (Property 1)
    - **Property 1: Department name resolution for teacher links**
    - Generate random `(departmentId, departmentName)` pairs; create a link with that `departmentId` and no `classId`; resolve the token; assert `response.departmentName === department.name`
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 2.3 Write property test for class-path precedence (Property 2)
    - **Property 2: Class-path department name takes precedence**
    - Generate random `(class, department, linkDepartment)` where `class.departmentId !== linkDepartment.id`; resolve the token; assert `response.departmentName === class.department.name`
    - **Validates: Requirements 2.3**

- [x] 3. Backend — new endpoint: `GET /departments/:id/teachers`
  - [x] 3.1 Add the `GET /:id/teachers` handler to `departmentsRouter` in `packages/backend/src/routes/departments.ts`
    - Reject `TEACHER` and `STUDENT` callers with 403
    - Look up the department; return 404 if it does not belong to `req.schoolId`
    - Reject `HOD` callers whose `req.user.departmentId !== req.params.id` with 403
    - Query `prisma.user.findMany` filtered by `schoolId`, `departmentId`, and `role: 'TEACHER'`
    - Select `id`, `fullName`, `email`, `phone` and return the array
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 3.2 Write property test for teacher list filtering (Property 5)
    - **Property 5: GET /departments/:id/teachers returns only teachers from that department**
    - Generate random department with M teachers and K non-teachers; call the endpoint; assert every returned item has `role === 'TEACHER'` and `departmentId === requested id`
    - **Validates: Requirements 4.1, 4.6**

  - [ ]* 3.3 Write property test for HOD cross-department 403 (Property 6)
    - **Property 6: HOD cannot access other departments' teacher lists**
    - Generate random HOD and random department id ≠ HOD's `departmentId`; call the endpoint; assert 403
    - **Validates: Requirements 4.3**

  - [ ]* 3.4 Write property test for TEACHER/STUDENT always forbidden (Property 7 — teacher list half)
    - **Property 7: TEACHER and STUDENT roles are always forbidden from teacher list endpoint**
    - Generate random TEACHER or STUDENT user; call `GET /departments/:id/teachers`; assert 403
    - **Validates: Requirements 4.5**

- [x] 4. Backend — new endpoint: `POST /classes/:id/assign-teacher`
  - [x] 4.1 Add the `POST /:id/assign-teacher` handler to `classesRouter` in `packages/backend/src/routes/departments.ts`
    - Reject `TEACHER` and `STUDENT` callers with 403
    - Validate `teacherId` present in body; return 400 if missing
    - Look up the class; return 404 if not in `req.schoolId`
    - Look up the teacher; return 404 if not in `req.schoolId` or not role `TEACHER`
    - For `HOD`: return 403 if `cls.departmentId !== req.user.departmentId` or `teacher.departmentId !== req.user.departmentId`
    - Call `prisma.class.update` with `{ classTeacherId: teacherId }` and include `classTeacher: { select: { fullName: true } }`
    - Return the updated class with `classTeacherName: updated.classTeacher?.fullName ?? null`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [ ]* 4.2 Write property test for HOD cross-department teacher assignment (Property 8)
    - **Property 8: HOD cannot assign a teacher from outside their department**
    - Generate random HOD and random teacher whose `departmentId !== HOD.departmentId`; call assign-teacher; assert 403
    - **Validates: Requirements 5.3**

  - [ ]* 4.3 Write property test for HOD cross-department class assignment (Property 9)
    - **Property 9: HOD cannot assign a teacher to a class outside their department**
    - Generate random HOD and random class whose `departmentId !== HOD.departmentId`; call assign-teacher; assert 403
    - **Validates: Requirements 5.4**

  - [ ]* 4.4 Write property test for TEACHER/STUDENT always forbidden (Property 7 — assign-teacher half)
    - **Property 7: TEACHER and STUDENT roles are always forbidden from assign-teacher endpoint**
    - Generate random TEACHER or STUDENT user; call `POST /classes/:id/assign-teacher`; assert 403
    - **Validates: Requirements 5.6**

- [x] 5. Backend — enrich `GET /classes` to include `classTeacherName`
  - [x] 5.1 Update the `GET /` handler in `classesRouter` in `packages/backend/src/routes/departments.ts`
    - Add `classTeacher: { select: { fullName: true } }` to the `include` clause of `prisma.class.findMany`
    - Map the result to add `classTeacherName: c.classTeacher?.fullName ?? null` on each class object
    - Return the enriched array
    - _Requirements: 3.4, 3.5_

  - [ ]* 5.2 Write property test for GET /classes always includes teacher fields (Property 4)
    - **Property 4: GET /classes always includes teacher fields**
    - Generate random school with N classes (some with teachers, some without); call `GET /classes`; assert every item has both `classTeacherId` and `classTeacherName` fields (null or populated)
    - **Validates: Requirements 3.4, 3.5**

  - [ ]* 5.3 Write property test for assignment reflected in GET /classes (Property 3)
    - **Property 3: Class teacher assignment is reflected in GET /classes**
    - Generate random `(class, teacher)` in the same school; call assign-teacher; call `GET /classes`; assert the class entry has the correct `classTeacherId` and `classTeacherName`
    - **Validates: Requirements 3.4, 5.9**

- [x] 6. Checkpoint — backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Frontend — bug fix: add `TEACHER` to `/admin/links` `AuthGuard` in `main.tsx`
  - [x] 7.1 Update `packages/frontend/src/main.tsx`
    - Move the `<Route path="/admin/links" element={<RegistrationLinksPage />} />` out of the `SCHOOL_ADMIN | HOD` block
    - Wrap it in its own `<Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER]} />}>` block
    - Leave `/admin`, `/admin/users`, `/admin/timetable`, `/admin/departments` in the original `SCHOOL_ADMIN | HOD` guard
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 8. Frontend — new HOD Department Management page
  - [x] 8.1 Create `packages/frontend/src/pages/hod/DepartmentManagementPage.tsx`
    - Define `Teacher` and `ClassWithTeacher` interfaces matching the API response shapes from the design
    - On mount, fetch `GET /departments/${user.departmentId}/teachers` → `setTeachers`
    - On mount, fetch `GET /departments/${user.departmentId}/classes` → `setClasses`
    - Render a two-column layout: teachers list (left) and classes list with assignment UI (right)
    - Each class row shows the class name, current `classTeacherName` (or "No class teacher assigned" placeholder), and an "Assign Teacher" button
    - The assignment form uses a teacher dropdown (`selectedTeacherId`) and calls `POST /classes/${selectedClassId}/assign-teacher`
    - On success, update the matching class in state with the new `classTeacherId` and `classTeacherName`
    - On failure, display an inline error banner without navigating away
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 8.2 Write property test for page renders all teachers and classes (Property 12)
    - **Property 12: HOD Department Management page renders all teachers and classes**
    - Generate random teacher list and class list; render `DepartmentManagementPage` with mocked API; assert a row exists for every teacher and every class
    - **Validates: Requirements 6.2, 6.3**

  - [ ]* 8.3 Write property test for class teacher name display correctness (Property 13)
    - **Property 13: Class teacher name display correctness**
    - Generate random class with non-null `classTeacherName`; render; assert the name appears in the output. Generate class with null `classTeacherName`; render; assert the placeholder "No class teacher assigned" appears
    - **Validates: Requirements 6.4, 6.8**

- [x] 9. Frontend — register `/hod/department` route and import in `main.tsx`
  - [x] 9.1 Update `packages/frontend/src/main.tsx`
    - Add `import DepartmentManagementPage from './pages/hod/DepartmentManagementPage';` at the top
    - Add a new `<Route element={<AuthGuard allowedRoles={[UserRole.HOD]} />}>` block containing `<Route path="/hod/department" element={<DepartmentManagementPage />} />`
    - _Requirements: 6.1_

- [x] 10. Frontend — add "Department Management" quick action to HOD dashboard
  - [x] 10.1 Update `packages/frontend/src/pages/DashboardPage.tsx`
    - In the `HOD` case of `getQuickActions`, add `{ to: '/hod/department', label: 'Department Management', icon: ICONS.building, gradient: 'from-indigo-500 to-blue-500' }` as the second entry (after "View Reports")
    - _Requirements: 6.7_

- [x] 11. Frontend — show `classTeacherName` in `DepartmentsPage.tsx` class rows
  - [x] 11.1 Update `packages/frontend/src/pages/admin/DepartmentsPage.tsx`
    - Extend the `ClassItem` interface with `classTeacherId: string | null` and `classTeacherName: string | null`
    - In the class row JSX (below the `Capacity: {cls.capacity}` line), add a paragraph that renders `cls.classTeacherName` when non-null, or an italic "None assigned" span when null
    - _Requirements: 6.8_

- [ ] 12. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The migration SQL uses `ON DELETE SET NULL` so deleting a teacher user clears the class teacher assignment rather than cascading a delete
- Property tests should use **fast-check** (already available in the TypeScript ecosystem) with a minimum of 100 iterations each
- The `prisma generate` step (task 1.3) must complete before any backend code that references `classTeacher` or `classesAsTeacher` is compiled
- The `/admin/links` route guard fix (task 7.1) is independent of all other tasks and can be applied at any time

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "5.1", "7.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "3.3", "3.4", "4.2", "4.3", "4.4", "5.2", "5.3", "8.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "9.1", "10.1", "11.1"] }
  ]
}
```
