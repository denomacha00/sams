# Implementation Plan: Scoped AI Knowledge Base

## Overview

This plan implements hierarchically scoped knowledge entries for the SAMS AI Knowledge Base. The implementation extends the existing `AIKnowledge` model with scope fields, adds a new Knowledge Service with RBAC-enforced CRUD operations, modifies the AI engine for scoped retrieval, and provides a frontend Knowledge Management page for staff users.

## Tasks

- [x] 1. Database migration and Prisma schema update
  - [x] 1.1 Update the Prisma schema to add scope fields to AIKnowledge model
    - Add `schoolId` (required), `departmentId` (optional), `classId` (optional), `createdById` (required) fields to the `AIKnowledge` model
    - Add foreign key relations to `School`, `Department`, `Class`, and `User` models
    - Add `knowledgeEntries AIKnowledge[]` relation field to `School`, `Department`, `Class`, and `User` models
    - Add composite indexes: `[schoolId]`, `[schoolId, departmentId]`, `[schoolId, classId]`, `[createdById]`
    - Update `title` to `@db.VarChar(200)` and `category` to `@db.VarChar(50)`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Create the database migration SQL file
    - Create migration at `packages/backend/prisma/migrations/20250603000000_add_scoped_knowledge/migration.sql`
    - Include ALTER TABLE statements for new columns, foreign keys, and indexes
    - Handle existing data by setting default values for `schoolId` and `createdById` (link to first school/admin or delete orphaned entries)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. RBAC permission update
  - [x] 2.1 Add `manage:knowledge` permission to the RBAC system
    - Add `'manage:knowledge'` to the `Permission` type union in `packages/backend/src/middleware/rbac.ts`
    - Add `'manage:knowledge'` to `SCHOOL_ADMIN`, `HOD`, and `TEACHER` role permission arrays in `ROLE_PERMISSIONS`
    - Ensure `STUDENT` role does NOT have `'manage:knowledge'` permission
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2_

- [x] 3. Backend Knowledge Service implementation
  - [x] 3.1 Create the Knowledge Service file with interfaces and class structure
    - Create `packages/backend/src/services/knowledgeService.ts`
    - Define `CreateKnowledgeInput`, `KnowledgeEntryResponse`, `PaginatedKnowledgeResponse` interfaces
    - Implement `getScopeLevel()` helper that determines scope from field presence (classId → 'class', departmentId → 'department', else → 'school')
    - _Requirements: 1.5, 1.6, 1.7_

  - [x] 3.2 Implement the `create` method with role-based scope assignment
    - SCHOOL_ADMIN: set schoolId=user.schoolId, departmentId=null, classId=null
    - HOD: set schoolId=user.schoolId, departmentId=user.departmentId, classId=null
    - TEACHER: set schoolId=user.schoolId, departmentId=user.departmentId, classId=user.classId
    - Validate input (title 1-200 chars, content non-empty, category ≤50 chars)
    - _Requirements: 2.1, 2.2, 2.3, 7.1, 7.2, 7.3_

  - [x] 3.3 Implement the `update` and `delete` methods with ownership/admin authorization
    - Allow mutation if user is the creator OR user is SCHOOL_ADMIN within same school
    - Reject cross-school access with 404 (not 403) to avoid leaking existence
    - Reject HOD cross-department mutations with 403
    - Validate input on update (same rules as create)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.2_

  - [x] 3.4 Implement the `list` method with role-scoped pagination
    - SCHOOL_ADMIN: return all entries in their school
    - HOD: return school-wide + department entries
    - TEACHER: return school-wide + department + class entries
    - Include creator name and role via Prisma join on User
    - Implement offset-based pagination with page, pageSize, total, totalPages
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.1_

  - [x] 3.5 Implement the `getForAIContext` method for scoped AI retrieval
    - Build Prisma where clause with OR conditions based on user role
    - SCHOOL_ADMIN: all entries in school
    - HOD: school-wide (departmentId=null, classId=null) + department entries
    - TEACHER/STUDENT: school-wide + department + class entries
    - Return only title, content, category fields for prompt injection
    - Always filter by user's schoolId for cross-school isolation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.1, 8.3_

  - [ ]* 3.6 Write property tests for Knowledge Service
    - **Property 1: Scope Level Determination** — verify getScopeLevel returns correct level based on field presence
    - **Property 2: Role-Based Creation Scope Assignment** — verify create assigns correct scope fields per role
    - **Property 4: Ownership-Based Mutation Authorization** — verify canMutate logic for all role/ownership combinations
    - **Property 5: Cross-School Isolation** — verify all operations reject cross-school access
    - **Property 6: Scoped AI Knowledge Retrieval** — verify getForAIContext returns correct entries per role
    - **Validates: Requirements 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1-4.7, 8.1-8.3**

  - [ ]* 3.7 Write unit tests for input validation logic
    - **Property 9: Input Validation Rejection** — verify title, content, category validation rules
    - **Property 10: Cross-Reference Validation** — verify departmentId/classId belong to correct school/department
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

- [~] 4. Checkpoint - Ensure Knowledge Service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Backend Knowledge Routes
  - [x] 5.1 Create the Knowledge Routes file with CRUD endpoints
    - Create `packages/backend/src/routes/knowledge.ts`
    - Implement `GET /api/v1/knowledge` — list entries (paginated, role-scoped)
    - Implement `POST /api/v1/knowledge` — create entry
    - Implement `GET /api/v1/knowledge/:id` — get single entry
    - Implement `PUT /api/v1/knowledge/:id` — update entry
    - Implement `DELETE /api/v1/knowledge/:id` — delete entry
    - Apply middleware chain: `authenticate → enforceSchoolScope → requirePermission('manage:knowledge')`
    - _Requirements: 2.1, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 5.1, 5.5_

  - [x] 5.2 Register the Knowledge Routes in the backend index.ts
    - Import `knowledgeRouter` from `./routes/knowledge`
    - Mount at `app.use('/api/v1/knowledge', knowledgeRouter)`
    - _Requirements: 6.1_

  - [ ]* 5.3 Write integration tests for Knowledge Routes
    - Test full CRUD flow: create → list → update → delete
    - Test 403 for STUDENT role attempting CRUD
    - Test 401 for unauthenticated access
    - Test cross-school isolation returns 404
    - Test pagination parameters
    - **Validates: Requirements 2.4, 2.5, 3.5, 5.5, 8.2**

- [x] 6. AI Engine modification for scoped retrieval
  - [x] 6.1 Modify `openaiEngine.ts` to use Knowledge Service for scoped retrieval
    - Import `knowledgeService` in `packages/backend/src/services/ai/openaiEngine.ts`
    - Replace the global `prisma.aIKnowledge.findMany()` call in `buildSystemPrompt` with `knowledgeService.getForAIContext(user)`
    - Maintain graceful degradation: if knowledge fetch fails, continue without knowledge context
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.3_

  - [ ]* 6.2 Write property test for scoped AI retrieval integration
    - **Property 6: Scoped AI Knowledge Retrieval** — verify buildSystemPrompt includes only entries matching user's scope
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**

- [~] 7. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Frontend Knowledge Management Page
  - [x] 8.1 Create the Knowledge Management Page component
    - Create `packages/frontend/src/pages/admin/KnowledgeManagementPage.tsx`
    - Implement knowledge entry list with table/card layout
    - Display scope level badges (school=blue, department=purple, class=green)
    - Show creator name and role for each entry
    - Implement pagination controls
    - _Requirements: 6.3, 6.7, 5.4_

  - [~] 8.2 Implement the Knowledge Form (create/edit) component
    - Add modal/drawer form with title, content, and category fields
    - Implement client-side validation (title 1-200 chars, content required, category ≤50 chars)
    - Support both create and edit modes
    - Show only edit/delete actions for entries the user is authorized to modify
    - _Requirements: 6.4, 6.5, 7.1, 7.2, 7.3_

  - [~] 8.3 Implement the delete confirmation dialog
    - Add confirmation modal before deletion
    - Show entry title in confirmation message
    - Call DELETE endpoint on confirmation
    - _Requirements: 6.6_

  - [~] 8.4 Add API service functions for knowledge endpoints
    - Create API helper functions (or add to existing API service) for:
      - `getKnowledgeEntries(page, pageSize)` → GET /api/v1/knowledge
      - `createKnowledgeEntry(input)` → POST /api/v1/knowledge
      - `updateKnowledgeEntry(id, input)` → PUT /api/v1/knowledge/:id
      - `deleteKnowledgeEntry(id)` → DELETE /api/v1/knowledge/:id
    - _Requirements: 6.3, 6.4, 6.5, 6.6_

- [ ] 9. Route registration and navigation updates
  - [x] 9.1 Register the Knowledge Management route in the frontend router
    - Add route `/admin/knowledge` in `packages/frontend/src/main.tsx`
    - Wrap with `AuthGuard` allowing `[UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER]`
    - Import `KnowledgeManagementPage` component
    - _Requirements: 6.1, 6.2_

  - [~] 9.2 Add navigation link to the Knowledge Management page
    - Add "Knowledge Base" link in the admin/staff navigation sidebar or menu
    - Show link only for SCHOOL_ADMIN, HOD, and TEACHER roles
    - Use an appropriate icon (e.g., book/knowledge icon)
    - _Requirements: 6.1, 6.2_

- [~] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementation follows existing SAMS patterns (Express + Prisma + React)
- The Knowledge Service follows the same singleton export pattern as other services (e.g., `conversationMemoryService`)
- Frontend follows existing admin page patterns (table layout, modals, AuthGuard)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.5"] },
    { "id": 3, "tasks": ["3.6", "3.7", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "8.1", "8.4"] },
    { "id": 6, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 7, "tasks": ["9.2"] }
  ]
}
```
