# Implementation Plan: AI Role Actions

## Overview

Extend the SAMS AI action system from SUPER_ADMIN-only to a unified role-aware pipeline using a Role-Action Registry pattern. The implementation creates a centralized registry, migrates existing SUPER_ADMIN handlers, adds role-specific handlers for SCHOOL_ADMIN/HOD/TEACHER/STUDENT, introduces LLM fallback classification, and refactors the intent detector and AI service to use the new architecture.

## Tasks

- [x] 1. Create Role-Action Registry and types
  - [x] 1.1 Create `roleActionRegistry.ts` with types and registry structure
    - Create file at `packages/backend/src/services/ai/roleActionRegistry.ts`
    - Define `ActionDefinition`, `ActionHandler`, `ActionScope`, `ActionResult`, and `RoleActionMap` interfaces
    - Export lookup utilities: `getActionsForRole`, `findAction`, `isActionPermitted`, `getActionNames`
    - Initialize the registry object with empty arrays for each `UserRole` (to be populated by handler imports)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Implement role-specific action handlers
  - [x] 2.1 Create `superAdminHandlers.ts` — migrate existing SUPER_ADMIN logic
    - Create file at `packages/backend/src/services/ai/handlers/superAdminHandlers.ts`
    - Extract `suspend_school`, `unsuspend_school`, `generate_license`, `extend_license`, `get_school_info`, `get_system_stats` handlers from `aiService.ts`
    - Each handler must conform to the `ActionHandler` signature `(params, scope) => Promise<ActionResult>`
    - Include regex patterns and `extractParams` logic migrated from `actionIntentDetector.ts`
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 2.2 Create `schoolAdminHandlers.ts` with School Admin actions
    - Create file at `packages/backend/src/services/ai/handlers/schoolAdminHandlers.ts`
    - Implement handlers: `addUserHandler`, `removeUserHandler`, `createClassHandler`, `createDepartmentHandler`, `manageTimetableHandler`
    - Define regex patterns for each action (e.g., `/add\s+(?:a\s+)?user/i`, `/remove\s+user/i`, `/create\s+(?:a\s+)?class/i`)
    - Mark `remove_user` as destructive
    - Scope all queries to `scope.schoolId`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.3 Create `hodHandlers.ts` with HOD actions
    - Create file at `packages/backend/src/services/ai/handlers/hodHandlers.ts`
    - Implement handlers: `addTeacherHandler`, `viewDepartmentStatsHandler`
    - Define regex patterns (e.g., `/add\s+teacher/i`, `/department\s+stats/i`)
    - Scope all queries to `scope.departmentId`; return error if `departmentId` is missing
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.4 Create `teacherHandlers.ts` with Teacher actions
    - Create file at `packages/backend/src/services/ai/handlers/teacherHandlers.ts`
    - Implement handlers: `startSessionHandler`, `endSessionHandler`, `markAttendanceHandler`, `addKnowledgeHandler`
    - Define regex patterns (e.g., `/start\s+(?:a\s+)?session/i`, `/end\s+session/i`, `/mark\s+(.+?)\s+(?:as\s+)?(?:present|absent)/i`)
    - Mark `end_session` as destructive
    - Scope to `scope.classId` and `scope.schoolId`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 2.5 Create `studentHandlers.ts` with Student read-only actions
    - Create file at `packages/backend/src/services/ai/handlers/studentHandlers.ts`
    - Implement handlers: `viewAttendanceHandler`, `viewTimetableHandler`
    - All actions must have `destructive: false`
    - Scope to `scope.classId` and `scope.schoolId`
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 3. Populate the registry with handler definitions
  - [x] 3.1 Wire all handler modules into `roleActionRegistry.ts`
    - Import action definitions from each handler file
    - Populate the `roleActionRegistry` object with complete `ActionDefinition` arrays per role
    - Ensure each entry has: `action`, `description`, `destructive`, `patterns`, `extractParams`, `descriptionTemplate`, `handler`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 4. Implement LLM fallback classifier
  - [x] 4.1 Create `llmActionClassifier.ts`
    - Create file at `packages/backend/src/services/ai/llmActionClassifier.ts`
    - Implement `classifyIntent(message, candidates)` function
    - Use structured system prompt that lists only role-permitted actions as candidates
    - Parse LLM JSON response; return `null` on error or timeout
    - Apply confidence threshold of 0.7
    - Add 5-second timeout for LLM calls
    - _Requirements: 6.3, 6.4, 6.5, 6.6_

  - [ ]* 4.2 Write unit tests for `llmActionClassifier.ts`
    - Test valid classification responses
    - Test confidence threshold filtering
    - Test timeout and error handling (graceful degradation)
    - Mock the OpenAI engine
    - _Requirements: 6.3, 6.4, 6.5, 6.6_

- [~] 5. Checkpoint - Ensure all handler files compile
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Refactor Action Intent Detector
  - [-] 6.1 Refactor `actionIntentDetector.ts` to be role-aware and async
    - Replace hardcoded `ACTION_PATTERNS` array with registry lookups via `getActionsForRole(role)`
    - Change `detect()` signature to `async detect(message: string, userRole: UserRole): Promise<DetectedAction>`
    - Add LLM fallback path: if no regex match, call `classifyIntent` with role-scoped candidates
    - Remove the `if (userRole !== 'SUPER_ADMIN')` guard — all roles now supported
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 6.2 Write unit tests for refactored `actionIntentDetector.ts`
    - Test regex detection for each role's patterns
    - Test LLM fallback invocation when regex fails
    - Test that LLM is NOT called when regex matches (regex-first priority)
    - Test non-action result when both regex and LLM fail
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

- [ ] 7. Refactor AI Service
  - [-] 7.1 Refactor `aiService.ts` to use unified `executeAction`
    - Replace `executeSuperAdminAction` with generic `executeAction(user, pendingAction)`
    - Move action detection from SUPER_ADMIN-only block to all authenticated users
    - Add `await` to `actionIntentDetector.detect()` call (now async)
    - Add `buildDenialResponse(role, action)` method with role-appropriate suggestions
    - Add `logDeniedAction(user, action)` for audit logging denied attempts
    - Implement authorization check via `findAction(user.role, action)` before execution
    - Build `ActionScope` from JWT claims and pass to handler
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 7.2 Write unit tests for refactored `aiService.ts`
    - Test action execution for each role
    - Test destructive action confirmation flow
    - Test denial response for out-of-scope actions
    - Test error response safety (no internal details exposed)
    - Test backward compatibility with SUPER_ADMIN actions
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 9.4, 10.1_

- [ ] 8. Add audit event types for AI actions
  - [x] 8.1 Add `AI_ACTION_EXECUTED` and `AI_ACTION_DENIED` event types
    - Update the audit service event types to include `AI_ACTION_EXECUTED` and `AI_ACTION_DENIED`
    - Ensure audit log entries include: actorId, actorRole, action type, affected resource or denial reason
    - _Requirements: 8.4, 9.5_

- [~] 9. Checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Integration wiring and backward compatibility
  - [~] 10.1 Update `ai.ts` route to pass full user payload for role detection
    - Ensure the AI route handler passes the complete `AccessTokenPayload` (including `role`, `schoolId`, `departmentId`, `classId`) to `aiService.query()`
    - Verify the confirmation flow works for all roles (not just SUPER_ADMIN)
    - _Requirements: 9.2, 10.3_

  - [ ]* 10.2 Write integration tests for end-to-end action flows
    - Test SCHOOL_ADMIN: add user → confirm → execute
    - Test HOD: view department stats (non-destructive, immediate)
    - Test TEACHER: end session → confirm → execute
    - Test STUDENT: attempt destructive action → denial response
    - Test SUPER_ADMIN: existing actions still work unchanged
    - _Requirements: 2.1, 3.2, 4.2, 5.2, 10.1, 10.3_

- [~] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The implementation language is TypeScript (matching the existing codebase)
- Existing SUPER_ADMIN action logic is migrated, not duplicated — the old `executeSuperAdminAction` method is removed after migration
- The `openaiEngine.ts` may need a minor export addition (`openaiQueryRaw`) for the LLM classifier

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 2, "tasks": ["3.1", "4.1"] },
    { "id": 3, "tasks": ["4.2", "6.1"] },
    { "id": 4, "tasks": ["6.2", "7.1", "8.1"] },
    { "id": 5, "tasks": ["7.2", "10.1"] },
    { "id": 6, "tasks": ["10.2"] }
  ]
}
```
