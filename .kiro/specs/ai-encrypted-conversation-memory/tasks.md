# Implementation Plan: AI Encrypted Conversation Memory

## Overview

This plan implements per-user encrypted conversation memory for the SAMS AI assistant. The implementation follows a bottom-up approach: database schema first, then encryption service, memory service, token budget manager, action intent detector, AI service integration, and finally API routes. Each step builds on the previous one and produces working, testable code.

## Tasks

- [x] 1. Database schema and Prisma models
  - [x] 1.1 Add ConversationThread and ConversationRecord models to Prisma schema
    - Add `ConversationThread` model with fields: id, userId, schoolId, title, createdAt, updatedAt
    - Add `ConversationRecord` model with fields: id, userId, schoolId, threadId, encryptedMessage (Bytes), encryptedResponse (Bytes), iv (Bytes), authTag (Bytes), createdAt
    - Add relation fields to existing `User` and `School` models (conversationThreads, conversationRecords)
    - Add composite indexes: `[userId, schoolId]` and `[userId, updatedAt]` on ConversationThread; `[userId, schoolId, threadId]`, `[userId, schoolId, createdAt]`, `[threadId, createdAt]` on ConversationRecord
    - Set `onDelete: Cascade` for User relations and thread→records relation
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 1.2 Generate and apply Prisma migration
    - Run `npx prisma migrate dev --name add-conversation-memory` to generate the migration
    - Verify the generated SQL creates the correct tables, indexes, and foreign keys
    - Run `npx prisma generate` to update the Prisma client
    - _Requirements: 8.5, 8.7_

- [x] 2. Encryption service
  - [x] 2.1 Implement ConversationEncryptionService
    - Create `packages/backend/src/services/conversationEncryption.ts`
    - Implement `deriveUserKey(userId, masterKey?)` using HKDF (SHA-256) with salt "sams-conversation-encryption-v1" and info `user:${userId}`
    - Implement `encrypt(plaintext, userId)` using AES-256-GCM with random 12-byte IV
    - Implement `decrypt(encrypted, userId)` that verifies auth tag and returns plaintext
    - Implement `decryptWithFallback(encrypted, userId)` that tries current key, then CONVERSATION_MASTER_KEY_PREVIOUS
    - Implement `reEncrypt(encrypted, userId)` for key rotation re-encryption
    - Implement `validateConfig()` that throws if CONVERSATION_MASTER_KEY is missing or < 32 chars
    - Export singleton instance
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 2.2 Write property test: Encryption Isolation (Property 1)
    - **Property 1: Encryption Isolation**
    - For any two distinct user IDs, `deriveUserKey(id1) !== deriveUserKey(id2)`
    - Use fast-check to generate arbitrary string pairs and verify key uniqueness
    - **Validates: Requirements 2.2, 3.2**

  - [ ]* 2.3 Write property test: Roundtrip Integrity (Property 2)
    - **Property 2: Roundtrip Integrity**
    - For any random string (1–10,000 chars) and any userId, `decrypt(encrypt(plaintext, userId), userId) === plaintext`
    - Use fast-check to generate arbitrary plaintext strings and user IDs
    - **Validates: Requirements 2.1, 2.6**

  - [ ]* 2.4 Write property test: IV Uniqueness (Property 10)
    - **Property 10: IV Uniqueness**
    - For any plaintext and userId, two successive encrypt() calls produce different IVs
    - Use fast-check to verify no IV reuse across multiple encryption operations
    - **Validates: Requirements 2.3**

  - [ ]* 2.5 Write unit tests for ConversationEncryptionService
    - Test validateConfig() throws when CONVERSATION_MASTER_KEY is missing or too short
    - Test key rotation: encrypt with key A, set key B as current and A as previous, verify decryptWithFallback works
    - Test auth tag tampering detection (modify ciphertext, verify decrypt throws)
    - Test reEncrypt produces valid ciphertext decryptable with current key
    - _Requirements: 2.5, 2.7, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 3. Checkpoint - Ensure encryption service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Token budget manager
  - [x] 4.1 Implement TokenBudgetManager
    - Create `packages/backend/src/services/ai/tokenBudgetManager.ts`
    - Implement `estimateTokens(text)` using chars/4 heuristic
    - Implement `trimToFitBudget(records, maxTokens)` that removes oldest records first until total ≤ maxTokens
    - Implement `formatAsMessages(records)` that converts to alternating user/assistant message pairs
    - Export singleton instance
    - _Requirements: 6.3, 9.1_

  - [ ]* 4.2 Write property test: Token Budget Compliance (Property 4)
    - **Property 4: Token Budget Compliance**
    - For any list of records and any maxTokens value, `trimToFitBudget(records, maxTokens)` output never exceeds maxTokens
    - Use fast-check to generate arbitrary record lists with varying message lengths
    - **Validates: Requirements 6.3**

  - [ ]* 4.3 Write unit tests for TokenBudgetManager
    - Test estimateTokens returns correct approximation
    - Test trimToFitBudget with empty records, single record exceeding budget, multiple records fitting
    - Test formatAsMessages produces correct alternating user/assistant pairs
    - Test edge case: all records exceed budget returns empty array
    - _Requirements: 6.3_

- [x] 5. Conversation memory service
  - [x] 5.1 Implement ConversationMemoryService
    - Create `packages/backend/src/services/conversationMemoryService.ts`
    - Implement `createThread(userId, schoolId, title?)` — creates a new ConversationThread
    - Implement `getThreads(userId, schoolId, page?, pageSize?)` — paginated thread listing
    - Implement `deleteThread(userId, schoolId, threadId)` — cascade deletes thread and records
    - Implement `deleteAllUserData(userId, schoolId)` — deletes all threads and records for user
    - Implement `persistRecord(userId, schoolId, threadId, message, response)` — encrypts and stores
    - Implement `getThreadRecords(userId, schoolId, threadId, page?, pageSize?)` — decrypts and returns records
    - Implement `getContextWindow(userId, schoolId, threadId?, maxRecords?)` — retrieves and decrypts recent records for AI prompt
    - Implement `resolveThread(userId, schoolId, threadId?)` — finds active thread or creates new one
    - Implement `enforceRecordLimit(userId, schoolId)` — deletes oldest if > 500 records
    - Implement `purgeExpiredRecords()` — deletes records older than 90 days
    - All queries scoped by userId AND schoolId
    - Graceful degradation: skip records that fail decryption, log to AuditLog
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.1, 3.3, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.4, 8.7, 9.1, 9.2, 9.3, 9.5, 9.6_

  - [ ]* 5.2 Write property test: Data Scoping (Property 3)
    - **Property 3: Data Scoping**
    - For any userId and schoolId, `getContextWindow(userId, schoolId)` only returns records where record.userId === userId AND record.schoolId === schoolId
    - Use fast-check to generate user/school ID combinations and verify isolation
    - **Validates: Requirements 3.1, 3.4**

  - [ ]* 5.3 Write property test: Record Limit Enforcement (Property 5)
    - **Property 5: Record Limit Enforcement**
    - After any `persistRecord()` call, the total count of records for that userId never exceeds 500
    - Use fast-check to simulate sequences of persist operations and verify the invariant
    - **Validates: Requirements 9.2, 9.3**

  - [ ]* 5.4 Write property test: Thread Ownership (Property 8)
    - **Property 8: Thread Ownership**
    - For any thread operation, the thread.userId must match the authenticated user's sub claim
    - Verify that getThreads, deleteThread, getThreadRecords never return/modify threads belonging to other users
    - **Validates: Requirements 4.8, 3.3**

  - [ ]* 5.5 Write unit tests for ConversationMemoryService
    - Test createThread creates with correct fields
    - Test resolveThread returns existing thread or creates new one
    - Test persistRecord encrypts and stores correctly
    - Test getContextWindow returns decrypted records in chronological order
    - Test enforceRecordLimit deletes oldest when at 500
    - Test deleteThread cascade deletes records
    - Test deleteAllUserData removes everything for user
    - Test records that fail decryption are skipped gracefully
    - _Requirements: 1.1, 1.6, 1.7, 1.8, 4.1, 4.2, 4.6, 4.7, 5.4_

- [x] 6. Checkpoint - Ensure memory service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Action intent detector
  - [x] 7.1 Implement ActionIntentDetector
    - Create `packages/backend/src/services/ai/actionIntentDetector.ts`
    - Implement `detect(question, userRole)` — classifies message as informational or action request
    - Only activate for SUPER_ADMIN role; return `{isAction: false}` for all other roles
    - Map natural language to supported actions: generate_license, suspend_school, unsuspend_school, extend_license, get_school_info, get_system_stats
    - Extract parameters (school names, plan tiers, days) from natural language using keyword/pattern matching
    - Implement `isDestructiveAction(action)` — returns true for suspend_school
    - Flag destructive actions with `requiresConfirmation: true`
    - Validate extracted parameters against the ai-action schema
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 11.7, 11.11, 11.12_

  - [ ]* 7.2 Write unit tests for ActionIntentDetector
    - Test role gating: non-SUPER_ADMIN always returns isAction: false
    - Test action classification for various natural language inputs (e.g., "suspend Greenfield Academy", "generate a license for Basic plan")
    - Test parameter extraction accuracy
    - Test destructive action flagging
    - Test ambiguous inputs default to isAction: false
    - _Requirements: 11.1, 11.2, 11.3, 11.11_

- [x] 8. AI service integration
  - [x] 8.1 Modify AIService to support conversation memory and action detection
    - Update `packages/backend/src/services/aiService.ts`
    - Extend `AIServiceResponse` interface with `threadId?`, `pendingAction?`, `requiresConfirmation?`
    - Update `query()` method signature to accept `options?: { threadId?, confirmAction?, pendingAction? }`
    - Add conversation history retrieval via ConversationMemoryService.getContextWindow()
    - Add token budget trimming via TokenBudgetManager
    - Add record persistence after successful AI response via safelyPersist()
    - Add Super Admin action detection flow (detect → confirm → execute)
    - Implement graceful degradation: if memory service fails, proceed without history
    - Skip history injection for local regex engine queries
    - _Requirements: 1.1, 1.2, 1.6, 5.1, 5.2, 5.3, 5.5, 5.6, 6.1, 6.4, 6.5, 6.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.8, 11.9_

  - [x] 8.2 Modify openaiEngine to accept conversation history
    - Update `packages/backend/src/services/ai/openaiEngine.ts`
    - Add new exported function `openaiQueryWithHistory(user, question, history)` that injects history messages between system prompt and user question
    - Keep existing `openaiQuery()` function unchanged for backward compatibility
    - Format history as alternating user/assistant messages in the chat completion messages array
    - _Requirements: 6.1, 6.2, 6.5_

  - [ ]* 8.3 Write property test: Graceful Degradation (Property 6)
    - **Property 6: Graceful Degradation**
    - If getContextWindow() throws, the AI query still returns a valid response (answer is non-empty string)
    - Mock ConversationMemoryService to throw and verify AIService still returns a response
    - **Validates: Requirements 1.6, 6.6**

  - [ ]* 8.4 Write property test: Persistence Independence (Property 9)
    - **Property 9: Persistence Independence**
    - If persistRecord() fails, the AI response is still returned to the user
    - Mock persistRecord to throw and verify the response is still delivered
    - **Validates: Requirements 1.6**

  - [ ]* 8.5 Write unit tests for enhanced AIService
    - Test query with threadId retrieves history and injects into prompt
    - Test query without threadId resolves to most recent thread
    - Test guest users get no history injection or persistence
    - Test Super Admin action detection and confirmation flow
    - Test Super Admin action execution after confirmation
    - Test local engine queries skip history injection
    - _Requirements: 1.2, 1.4, 6.4, 11.3, 11.4, 11.5_

- [x] 9. Checkpoint - Ensure AI service integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. API routes for conversation management
  - [x] 10.1 Add conversation management endpoints to ai.ts router
    - Update `packages/backend/src/routes/ai.ts`
    - Add `GET /api/v1/ai/conversations` — list threads (paginated, default 50, max 100)
    - Add `GET /api/v1/ai/conversations/:threadId` — get decrypted records for thread (paginated, default 100, max 200)
    - Add `POST /api/v1/ai/conversations` — create new thread (validate title: 1–200 chars)
    - Add `DELETE /api/v1/ai/conversations/:threadId` — delete thread and records
    - Add `DELETE /api/v1/ai/conversations` — delete all user conversation data
    - All endpoints require authentication (return 401 if unauthenticated)
    - Return 404 for threadId not found or not owned by user
    - Scope all operations by authenticated user's sub and schoolId
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 10.2 Update the AI query endpoint to accept threadId and confirmAction params
    - Modify `POST /api/v1/ai/query` in `packages/backend/src/routes/ai.ts`
    - Accept optional `threadId`, `confirmAction`, and `pendingAction` fields in request body
    - Pass options to `aiService.query(user, question, { threadId, confirmAction, pendingAction })`
    - Include `threadId`, `pendingAction`, and `requiresConfirmation` in response when present
    - _Requirements: 10.8, 11.3, 11.4_

  - [ ]* 10.3 Write unit tests for conversation API endpoints
    - Test GET /conversations returns paginated threads for authenticated user
    - Test GET /conversations/:threadId returns decrypted records
    - Test POST /conversations creates thread with valid title
    - Test DELETE /conversations/:threadId removes thread and records
    - Test DELETE /conversations removes all user data
    - Test 401 for unauthenticated requests
    - Test 404 for non-existent or non-owned threadId
    - Test POST /query with threadId passes it to AIService
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [x] 11. Environment configuration and validation
  - [x] 11.1 Add CONVERSATION_MASTER_KEY to environment configuration
    - Add `CONVERSATION_MASTER_KEY` to `packages/backend/.env.example` with a placeholder value and comment
    - Add `CONVERSATION_MASTER_KEY_PREVIOUS` (optional) to `.env.example`
    - Add encryption config validation call in application startup (`packages/backend/src/index.ts`)
    - Ensure the app logs a warning but continues if CONVERSATION_MASTER_KEY is not set (conversation memory disabled gracefully)
    - _Requirements: 2.5, 7.1, 7.6_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, matching the existing codebase
- All encryption uses Node.js built-in `crypto` module (no additional dependencies)
- The existing `openaiQuery()` function is preserved for backward compatibility

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "4.2", "4.3"] },
    { "id": 4, "tasks": ["5.1", "7.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "5.5", "7.2"] },
    { "id": 6, "tasks": ["8.1", "8.2"] },
    { "id": 7, "tasks": ["8.3", "8.4", "8.5"] },
    { "id": 8, "tasks": ["10.1", "10.2", "11.1"] },
    { "id": 9, "tasks": ["10.3"] }
  ]
}
```
