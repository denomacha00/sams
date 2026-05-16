# Implementation Plan: HOD Registration Links

## Overview

This plan implements HOD-scoped registration link management (target role selection, class ownership validation, scoped visibility), adds a "Registration Links" quick action to the HOD dashboard, enhances the notification system with sender attribution and edit/delete capabilities, and fixes the missing `manage:timetable` permission for the HOD role.

## Tasks

- [x] 1. Fix HOD RBAC permissions and extend registration link service
  - [x] 1.1 Add `manage:timetable` permission to HOD role in RBAC middleware
    - In `packages/backend/src/middleware/rbac.ts`, update the `ROLE_PERMISSIONS` map to add `'manage:timetable'` to the HOD array so it becomes `['manage:users', 'manage:timetable', 'view:reports', 'view:risk']`
    - _Requirements: 3.3 (HOD Timetable access)_

  - [x] 1.2 Extend `generateLink` in `registrationLinkService.ts` for HOD target role validation
    - When `creatorRole === HOD`, validate that `targetRole` is either `TEACHER` or `STUDENT`; reject other values with a 400 error (`INVALID_TARGET_ROLE`)
    - If `targetRole` is not provided and creator is HOD, default to `TEACHER`
    - When `targetRole === STUDENT`, require `classId` parameter; throw 400 (`CLASS_REQUIRED`) if missing
    - Validate that the provided `classId` belongs to the HOD's department by querying the Class model; throw 403 if it belongs to another department
    - Embed the HOD's `departmentId` on all HOD-created links
    - Update the `GenerateLinkOptions` interface to type `targetRole` as `'TEACHER' | 'STUDENT'`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.7_

  - [ ]* 1.3 Write property tests for `generateLink` HOD validation
    - **Property 1: Link creation embeds correct metadata**
    - **Property 2: Invalid target role rejection**
    - **Property 3: Class ownership enforcement**
    - **Validates: Requirements 1.2, 1.3, 1.5, 2.2, 2.7**

  - [x] 1.4 Add `getLinksForUser` method to `registrationLinkService.ts`
    - If `userRole === SCHOOL_ADMIN`: return all links for the school sorted by `createdAt` desc
    - If `userRole === HOD`: return only links where `createdById === userId` sorted by `createdAt` desc
    - Otherwise: throw 403 (`FORBIDDEN`)
    - _Requirements: 4.1, 4.3, 4.4_

  - [ ]* 1.5 Write property test for role-scoped link visibility
    - **Property 5: Role-scoped link visibility**
    - **Validates: Requirements 4.1, 4.3, 4.4**

  - [x] 1.6 Add ownership-based `deleteLink` method to `registrationLinkService.ts`
    - SCHOOL_ADMIN can delete any link in their school
    - HOD can only delete links where `createdById === requesterId`; return 403 if ownership check fails
    - Return 404 if link not found or doesn't belong to the school
    - Deletion must not affect any user accounts previously created via that link
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [ ]* 1.7 Write property tests for link deletion
    - **Property 6: Ownership-based link deletion**
    - **Property 7: Link deletion preserves registered users**
    - **Validates: Requirements 5.1, 5.2, 5.5**

- [x] 2. Checkpoint - Ensure all backend service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Update registration links router for HOD-scoped operations
  - [x] 3.1 Update `registrationLinksRouter` GET endpoint to use `getLinksForUser`
    - Replace the current `findMany` with a call to `registrationLinkService.getLinksForUser(userId, userRole, schoolId)`
    - Return 403 for unauthorized roles
    - _Requirements: 4.1, 4.3, 4.4_

  - [x] 3.2 Update `registrationLinksRouter` POST endpoint for HOD target role
    - Add `targetRole: z.enum(['TEACHER', 'STUDENT']).optional()` to the `generateLinkSchema`
    - Pass `targetRole` from the validated body to `generateLink` options
    - Pass `classId` from the body when `targetRole === STUDENT`
    - _Requirements: 1.1, 1.2, 1.3, 2.2_

  - [x] 3.3 Update `registrationLinksRouter` DELETE endpoint with ownership check
    - Replace the current inline delete logic with a call to `registrationLinkService.deleteLink(linkId, requesterId, requesterRole, schoolId)`
    - Return appropriate 403/404 errors based on service response
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 4. Add Prisma migration for Notification model enhancements
  - [x] 4.1 Create Prisma migration adding `senderId`, `batchId`, and `updatedAt` fields to Notification model
    - Add `senderId String?` field to the Notification model in `schema.prisma`
    - Add `batchId String?` field to the Notification model
    - Add `updatedAt DateTime?` field to the Notification model
    - Add `@@index([batchId])` and `@@index([senderId])` indexes
    - Create migration file at `packages/backend/prisma/migrations/20250605000000_add_notification_sender/migration.sql`
    - Run `npx prisma generate` to update the client
    - _Requirements: 6.1, 7.2, 7.4_

- [x] 5. Add notification edit/delete endpoints with sender verification
  - [x] 5.1 Update notification POST `/send` endpoint to store `senderId` and `batchId`
    - Generate a `batchId` (using `createId()`) for each send operation
    - Store `senderId: req.user.sub` and `batchId` on each created notification record
    - _Requirements: 6.1, 7.2_

  - [x] 5.2 Update notification GET endpoint to include sender name
    - Join with the User table on `senderId` to resolve `fullName`
    - Return `senderName: "System"` if `senderId` is null
    - Return `senderName: "Deleted User"` if the sender user record no longer exists
    - Include `senderId`, `senderName`, `batchId`, and `updatedAt` in the response
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 5.3 Add PATCH `/notifications/:id` endpoint for editing notifications
    - Validate that the request body contains `message` (1-1000 characters)
    - Verify `senderId` matches `req.user.sub`; return 403 if not
    - Check that `createdAt` is within 24 hours of current time; return 403 (`WINDOW_EXPIRED`) if not
    - Update the `message` field and set `updatedAt` on all notifications sharing the same `batchId` and `senderId`
    - Emit a Socket.io event to affected recipients for real-time update
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6_

  - [x] 5.4 Add DELETE `/notifications/batch/:batchId` endpoint for batch deletion
    - Verify that at least one notification in the batch has `senderId === req.user.sub`; return 403 if not
    - Check that the batch's `createdAt` is within 24 hours; return 403 (`WINDOW_EXPIRED`) if not
    - Delete all notification records matching the `batchId` and `senderId`
    - _Requirements: 7.2, 7.3, 7.5_

  - [ ]* 5.5 Write property tests for notification edit/delete
    - **Property 10: Notification edit correctness**
    - **Property 11: Batch deletion completeness**
    - **Property 12: Non-sender modification rejection**
    - **Property 13: 24-hour modification window enforcement**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

- [x] 6. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Frontend: Update all dashboards with new quick actions and improved styling
  - [x] 7.1 Add "Registration Links" quick action to HOD section in `DashboardPage.tsx`
    - Add `{ to: '/admin/links', label: 'Registration Links', icon: ICONS.link, gradient: 'from-emerald-500 to-teal-500' }` to the HOD quick actions array in `getQuickActions`
    - _Requirements: 3.1, 3.2_

  - [x] 7.2 Add "Knowledge Base" quick action to HOD, SCHOOL_ADMIN, and TEACHER dashboards
    - Add `{ to: '/admin/knowledge', label: 'Knowledge Base', icon: ICONS.academic, gradient: 'from-amber-500 to-yellow-500' }` to the HOD quick actions array
    - Add `{ to: '/admin/knowledge', label: 'Knowledge Base', icon: ICONS.academic, gradient: 'from-amber-500 to-yellow-500' }` to the SCHOOL_ADMIN quick actions array
    - Add `{ to: '/admin/knowledge', label: 'Knowledge Base', icon: ICONS.academic, gradient: 'from-amber-500 to-yellow-500' }` to the TEACHER quick actions array

  - [x] 7.3 Improve dashboard UI styling and organization
    - Reorganize the quick actions grid to use a responsive layout: 2 columns on mobile, 3 columns on tablet, 4 columns on desktop
    - Add subtle hover animations (scale + glow effect) to stat cards
    - Add section headers with dividers between Stats, Quick Actions, and Activity sections
    - Improve the header with a more polished gradient and better spacing
    - Add a welcome banner with the user's name and role-specific greeting
    - Ensure consistent card heights and spacing across all dashboard sections
    - Use a more organized grid layout for the bottom section (schedule + activity side by side on desktop)

- [x] 8. Frontend: Update RegistrationLinksPage for HOD role
  - [x] 8.1 Update `RegistrationLinksPage.tsx` for HOD role-aware target role selection
    - Import `useAuthStore` to detect the current user's role
    - If user role is HOD: show only TEACHER and STUDENT options in the target role dropdown (remove HOD option)
    - If user role is SCHOOL_ADMIN: keep existing 3 options (STUDENT, TEACHER, HOD)
    - When HOD selects STUDENT: show class picker populated from the HOD's department classes
    - When no classes exist in the HOD's department: show disabled state with message "No classes available in your department"
    - Update the back link to navigate to `/dashboard` for HOD users instead of `/admin`
    - _Requirements: 1.1, 2.1, 2.3, 3.3, 4.5_

  - [ ]* 8.2 Write unit tests for RegistrationLinksPage role-aware behavior
    - Test that HOD sees only TEACHER/STUDENT options
    - Test that class picker appears when HOD selects STUDENT
    - Test disabled state when no classes available
    - _Requirements: 1.1, 2.1, 2.3_

- [x] 9. Frontend: Update NotificationsPage for sender display and edit/delete
  - [x] 9.1 Update NotificationsPage to display sender name and edit/delete controls
    - Display `senderName` adjacent to each notification entry, truncated to 50 characters with ellipsis if exceeding
    - Show edit and delete buttons only on notifications where `senderId` matches the current user's ID
    - Disable edit/delete buttons if the notification's `createdAt` is more than 24 hours ago (show tooltip "Modification window expired")
    - Add an edit modal with a textarea (1-1000 characters) that calls PATCH `/notifications/:id`
    - Add a delete confirmation that calls DELETE `/notifications/batch/:batchId`
    - On successful edit, update the notification in the local list without full page reload
    - On successful delete, remove all notifications with the same `batchId` from the local list
    - _Requirements: 6.5, 7.1, 7.2, 7.3, 7.5_

  - [ ]* 9.2 Write unit tests for NotificationsPage sender display and truncation
    - **Property 9: Sender name truncation**
    - Test sender name display for names under 50 chars, exactly 50 chars, and over 50 chars
    - Test edit/delete button visibility based on sender ownership
    - Test 24-hour window disabling
    - **Validates: Requirements 6.5, 7.3, 7.5**

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout (Express.js backend, React frontend), so all implementation uses TypeScript
- The existing `RegistrationLink` model already has `createdById`, `classId`, and `targetRole` fields — no schema migration needed for registration links
- The Notification model requires a migration to add `senderId`, `batchId`, and `updatedAt` fields

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.6", "7.1", "7.2", "7.3"] },
    { "id": 2, "tasks": ["1.3", "1.5", "1.7", "3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["5.1", "5.2"] },
    { "id": 4, "tasks": ["5.3", "5.4"] },
    { "id": 5, "tasks": ["5.5", "8.1"] },
    { "id": 6, "tasks": ["8.2", "9.1"] },
    { "id": 7, "tasks": ["9.2"] }
  ]
}
```
