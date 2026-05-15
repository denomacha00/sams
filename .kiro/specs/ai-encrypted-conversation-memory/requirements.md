# Requirements Document

## Introduction

This feature adds per-user encrypted conversation memory to the SAMS AI assistant. Currently, the AI is stateless — each query is independent with no history. This enhancement enables the AI to remember past conversations for each user across sessions, with SAMS-related conversation data encrypted at rest using per-user derived keys.

The AI retains its ability to answer general knowledge questions (science, math, history, etc.) freely without encryption constraints. Encryption and data scoping apply specifically to SAMS-related interactions — attendance data, student records, timetables, risk scores, and school-specific information. For example, a student's AI should "know" that student's history and context for SAMS queries, while still being able to answer general questions openly. When answering SAMS-specific queries, the AI only uses encrypted per-user data to ensure isolation.

## Glossary

- **Conversation_Memory_Service**: The backend service responsible for storing, retrieving, and managing encrypted conversation history for each user.
- **Encryption_Service**: The service responsible for encrypting and decrypting conversation data using AES-256-GCM with per-user derived keys.
- **AI_Service**: The existing AI query pipeline that routes queries through local and OpenAI/Groq engines.
- **Conversation_Thread**: A sequence of related messages (user queries and AI responses) belonging to a single user, grouped by session or topic.
- **User_Encryption_Key**: A 32-byte AES-256-GCM key derived from the user's ID and a master secret using HKDF, unique to each user.
- **Conversation_Record**: A single stored entry containing an encrypted user message, encrypted AI response, timestamp, and metadata.
- **Context_Window**: The subset of recent conversation history injected into the AI prompt to provide conversational continuity.
- **Key_Derivation_Function**: HKDF (HMAC-based Key Derivation Function) using SHA-256, used to derive per-user encryption keys from a master secret.

## Requirements

### Requirement 1: Per-User Conversation Storage

**User Story:** As a logged-in user, I want the AI to remember my previous conversations, so that I can have contextual follow-up discussions without repeating myself.

#### Acceptance Criteria

1. WHEN an authenticated user sends a query to the AI_Service, THE Conversation_Memory_Service SHALL persist the user message and AI response as a Conversation_Record linked to the user's ID within 5 seconds of the AI response being generated.
2. WHEN an authenticated user sends a subsequent query, THE AI_Service SHALL retrieve the most recent Conversation_Records for that user (up to the Context_Window limit) ordered by timestamp descending and include them in the AI prompt.
3. THE Conversation_Memory_Service SHALL store each Conversation_Record with the user ID, school ID, timestamp, encrypted message content (maximum 2,000 characters), and encrypted response content (maximum 10,000 characters) using AES-256 encryption at rest.
4. WHEN an unauthenticated user sends a query, THE Conversation_Memory_Service SHALL NOT persist any conversation data.
5. THE Context_Window SHALL include a maximum of 20 recent Conversation_Records per user to limit prompt size and token usage.
6. IF the Conversation_Memory_Service fails to persist a Conversation_Record, THEN THE AI_Service SHALL still return the AI response to the user and SHALL log the persistence failure.
7. THE Conversation_Memory_Service SHALL retain Conversation_Records for a maximum of 90 days per user, after which records SHALL be permanently deleted.
8. THE Conversation_Memory_Service SHALL store a maximum of 500 Conversation_Records per user; WHEN this limit is reached, THE Conversation_Memory_Service SHALL delete the oldest records to accommodate new ones.

### Requirement 2: Conversation Encryption at Rest

**User Story:** As a system administrator, I want SAMS-related conversation data encrypted at rest with per-user keys, so that a database breach does not expose user-specific school data in plaintext.

#### Acceptance Criteria

1. THE Encryption_Service SHALL encrypt all Conversation_Record message and response content using AES-256-GCM before storage, regardless of content type, to prevent metadata leakage about which conversations contain SAMS data.
2. THE Encryption_Service SHALL derive a unique User_Encryption_Key for each user using HKDF with SHA-256, a fixed application-specific salt, the user's ID as the info parameter, and a master secret from the CONVERSATION_MASTER_KEY environment variable, producing a 32-byte key.
3. WHEN the Encryption_Service encrypts a Conversation_Record, THE Encryption_Service SHALL generate a cryptographically random 12-byte initialization vector for each encryption operation.
4. THE Encryption_Service SHALL store the 12-byte initialization vector and 16-byte authentication tag alongside each encrypted Conversation_Record.
5. IF the CONVERSATION_MASTER_KEY environment variable is not set or contains fewer than 32 characters, THEN THE Encryption_Service SHALL throw a configuration error at startup and prevent the application from serving conversation memory requests.
6. WHEN an authorized user requests their conversation history, THE Encryption_Service SHALL derive the user's User_Encryption_Key and decrypt the stored Conversation_Record content, returning plaintext only to the owning user's session.
7. IF decryption of a Conversation_Record fails due to an authentication tag mismatch, THEN THE Encryption_Service SHALL reject the read operation, log the integrity failure in the AuditLog, and return an error message indicating data integrity could not be verified.

### Requirement 3: User Data Isolation

**User Story:** As a user, I want my AI conversation history to be completely isolated from other users, so that no one else can access my past interactions with the AI.

#### Acceptance Criteria

1. WHEN a user requests conversation history, THE Conversation_Memory_Service SHALL only return Conversation_Records where the stored user ID matches the authenticated user's sub claim from the JWT token, and where the stored school ID matches the authenticated user's schoolId claim.
2. THE Encryption_Service SHALL derive encryption keys using the specific user's ID, ensuring that data encrypted for one user is cryptographically inaccessible to another user's derived key.
3. IF a conversation history request contains a user ID that does not match the authenticated user's sub claim, THEN THE Conversation_Memory_Service SHALL reject the request and return an authorization error indication without revealing whether records exist for the requested user ID.
4. THE AI_Service SHALL NOT include Conversation_Records from other users in any AI prompt context, limiting prompt context to a maximum of 50 Conversation_Records belonging solely to the authenticated user.
5. IF the Encryption_Service fails to derive a decryption key for the authenticated user's Conversation_Records, THEN THE Conversation_Memory_Service SHALL return an error indication and SHALL NOT fall back to returning unencrypted data or data from other users.
6. WHEN a user requests conversation history and no matching Conversation_Records exist, THE Conversation_Memory_Service SHALL return an empty collection within 2 seconds without returning records belonging to other users.

### Requirement 4: Conversation Thread Management

**User Story:** As a user, I want to manage my conversation history by starting new threads and clearing old ones, so that I can organize my AI interactions.

#### Acceptance Criteria

1. WHEN an authenticated user sends a request to start a new Conversation_Thread, THE Conversation_Memory_Service SHALL create a new thread with a unique identifier, a creation timestamp, and a title of up to 100 characters provided by the user or auto-generated from the first query.
2. WHEN an authenticated user sends a request to delete a specific Conversation_Thread, THE Conversation_Memory_Service SHALL permanently delete the thread and all associated encrypted Conversation_Records from the database.
3. IF a user sends a request to delete a Conversation_Thread that does not exist or does not belong to that user, THEN THE Conversation_Memory_Service SHALL return an error indicating the thread was not found.
4. WHEN an authenticated user sends a request to clear all conversation history, THE Conversation_Memory_Service SHALL permanently delete all Conversation_Threads and their associated Conversation_Records belonging to that user.
5. THE Conversation_Memory_Service SHALL support listing all Conversation_Threads for the authenticated user, returning thread ID, title, and last activity timestamp, ordered by last activity descending, with a maximum of 50 threads per response page.
6. WHEN a user sends a query without specifying a thread and at least one Conversation_Thread exists for that user, THE Conversation_Memory_Service SHALL append the Conversation_Record to the Conversation_Thread with the most recent last activity timestamp.
7. IF a user sends a query without specifying a thread and no Conversation_Thread exists for that user, THEN THE Conversation_Memory_Service SHALL create a new Conversation_Thread and append the Conversation_Record to it.
8. THE Conversation_Memory_Service SHALL scope all thread operations to the authenticated user's own threads and SHALL NOT permit access to threads belonging to other users.

### Requirement 5: Encrypted Knowledge Scoping

**User Story:** As a student, I want the AI to know me and my SAMS context (my attendance, my classes, my risk scores) while still being able to answer general knowledge questions freely, so that I get a personalized SAMS experience without limiting the AI's general helpfulness.

#### Acceptance Criteria

1. WHEN building the AI prompt context, THE AI_Service SHALL only include Conversation_Records encrypted with the current authenticated user's User_Encryption_Key, regardless of whether the query is SAMS-related or general knowledge.
2. THE AI_Service SHALL maintain the existing role-based data scoping (SUPER_ADMIN, SCHOOL_ADMIN, TEACHER, HOD, STUDENT) when executing function calls for attendance, risk scores, and reports.
3. WHEN a user with STUDENT role queries the AI about SAMS data, THE AI_Service SHALL only inject that specific student's encrypted conversation history and scoped data.
4. IF decryption of a Conversation_Record fails due to key mismatch or data corruption, THEN THE Conversation_Memory_Service SHALL skip the corrupted record, log a warning in the AuditLog, and continue serving remaining valid records.
5. THE AI_Service SHALL include the user's conversation history for context continuity regardless of query type, so the AI "knows" the user across both general and SAMS-specific interactions.
6. WHEN a general knowledge question is asked, THE AI_Service SHALL answer directly using the OpenAI/Groq engine with conversation history included for continuity but without requiring SAMS-specific data access.

### Requirement 6: Conversation Context Integration with AI Engines

**User Story:** As a user, I want the AI to use my conversation history to provide contextually relevant answers for both SAMS and general questions, so that follow-up questions are understood without restating context.

#### Acceptance Criteria

1. WHEN the AI_Service builds a prompt for the OpenAI/Groq engine, THE AI_Service SHALL prepend the most recent Conversation_Records from the requesting user's Context_Window (scoped per userId) as prior message history, up to a maximum of 20 message pairs.
2. THE AI_Service SHALL format injected conversation history as alternating user/assistant message pairs in the chat completion API format.
3. WHEN the Context_Window contains more tokens than 2,048 tokens allocated for conversation history, THE AI_Service SHALL truncate the oldest Conversation_Records first, preserving the most recent exchanges until the history fits within the 2,048-token budget.
4. WHEN the local regex engine handles a query, THE AI_Service SHALL NOT inject conversation history, as the local engine operates on pattern matching only.
5. IF a query is routed to the external language model engine and the user's Context_Window contains prior Conversation_Records, THEN THE AI_Service SHALL include those records in the prompt to enable follow-up resolution (e.g., a user asking "explain more" after a physics question).
6. IF decryption of Conversation_Records fails or the Context_Window is empty, THEN THE AI_Service SHALL proceed with the query without injecting conversation history and SHALL not return an error to the user.

### Requirement 7: Key Rotation and Security

**User Story:** As a system administrator, I want the ability to rotate encryption keys without losing existing conversation data, so that the system remains secure over time.

#### Acceptance Criteria

1. WHEN the CONVERSATION_MASTER_KEY is rotated, THE Encryption_Service SHALL support a CONVERSATION_MASTER_KEY_PREVIOUS environment variable containing the immediately prior key value for decrypting records encrypted with the old key.
2. WHEN decryption of a record with the current CONVERSATION_MASTER_KEY fails, THE Encryption_Service SHALL attempt decryption with the CONVERSATION_MASTER_KEY_PREVIOUS key before returning an error response to the caller.
3. WHEN the Encryption_Service successfully decrypts a record using the CONVERSATION_MASTER_KEY_PREVIOUS key during a read operation, THE Encryption_Service SHALL re-encrypt that record with the current CONVERSATION_MASTER_KEY and persist the updated ciphertext before returning the decrypted data.
4. IF re-encryption with the new key fails after successful decryption with the previous key, THEN THE Encryption_Service SHALL still return the decrypted data to the caller and SHALL log the re-encryption failure in the AuditLog.
5. IF decryption fails with both the current and previous keys, THEN THE Encryption_Service SHALL mark the record as inaccessible, exclude it from query results, and log the failure in the AuditLog with the affected record identifier.
6. THE Encryption_Service SHALL support exactly one previous key generation at a time; rotating the key a second time SHALL discard the oldest previous key value.

### Requirement 8: Database Schema for Conversation Storage

**User Story:** As a developer, I want a well-defined database schema for conversation storage, so that conversation data is efficiently stored and queried.

#### Acceptance Criteria

1. THE Conversation_Memory_Service SHALL store Conversation_Records in a dedicated database table with columns for: id (unique identifier), userId (foreign key referencing the User table), schoolId (foreign key referencing the School table), threadId (foreign key referencing the Conversation_Threads table), encryptedMessage (binary field up to 16,000 bytes), encryptedResponse (binary field up to 16,000 bytes), iv (binary field of 12 bytes for AES-256-GCM initialization vector), authTag (binary field of 16 bytes for AES-256-GCM authentication tag), createdAt (timestamp).
2. THE Conversation_Memory_Service SHALL index the conversation table on userId and threadId such that retrieval of all records for a given userId and threadId combination returns results within 200 milliseconds for up to 10,000 records per thread.
3. THE Conversation_Memory_Service SHALL index the conversation table on createdAt to support chronological ordering within the Context_Window.
4. THE Conversation_Memory_Service SHALL store Conversation_Threads in a dedicated table with columns for: id (unique identifier), userId (foreign key referencing the User table), schoolId (foreign key referencing the School table), title (string of up to 200 characters), createdAt (timestamp), updatedAt (timestamp).
5. THE Conversation_Memory_Service SHALL enforce referential integrity such that Conversation_Records and Conversation_Threads cannot reference a userId or schoolId that does not exist in the User or School tables respectively.
6. IF a Conversation_Record is inserted with a threadId that does not exist in the Conversation_Threads table, THEN THE Conversation_Memory_Service SHALL reject the insert and return an error indicating an invalid thread reference.
7. THE Conversation_Memory_Service SHALL scope all conversation queries by schoolId to maintain multi-school data isolation consistent with the existing data isolation rules.

### Requirement 9: Performance and Limits

**User Story:** As a user, I want the AI to respond quickly even with conversation history enabled, so that the experience remains responsive.

#### Acceptance Criteria

1. THE Conversation_Memory_Service SHALL retrieve and decrypt the Context_Window within 200 milliseconds for up to 20 Conversation_Records.
2. THE Conversation_Memory_Service SHALL enforce a maximum of 500 Conversation_Records per user to prevent unbounded storage growth.
3. WHEN a user exceeds 500 Conversation_Records, THE Conversation_Memory_Service SHALL delete the oldest records one-for-one so that the total count returns to exactly 500 before persisting the new record.
4. THE Encryption_Service SHALL complete encryption of a single Conversation_Record of up to 4,000 characters within 5 milliseconds.
5. IF the Conversation_Memory_Service fails to retrieve or decrypt the Context_Window within 200 milliseconds, THEN THE Conversation_Memory_Service SHALL proceed with the AI query without conversation history and SHALL indicate to the user that prior context was unavailable.
6. IF decryption of a stored Conversation_Record fails due to corruption or key mismatch, THEN THE Conversation_Memory_Service SHALL skip the unreadable record, continue processing the remaining records, and log the failure in the AuditLog.

### Requirement 10: API Endpoints for Conversation Management

**User Story:** As a frontend developer, I want clear API endpoints for managing conversations, so that I can build the conversation history UI.

#### Acceptance Criteria

1. THE AI_Service SHALL expose a GET endpoint at /api/v1/ai/conversations that returns Conversation_Threads for the authenticated user, ordered by most recent activity first, paginated with a default page size of 50 and a maximum page size of 100.
2. THE AI_Service SHALL expose a GET endpoint at /api/v1/ai/conversations/:threadId that returns decrypted Conversation_Records for a specific thread, ordered chronologically, paginated with a default page size of 100 and a maximum page size of 200.
3. THE AI_Service SHALL expose a POST endpoint at /api/v1/ai/conversations that creates a new Conversation_Thread, requiring a title field of 1 to 200 characters, and SHALL return the created thread including its generated identifier.
4. THE AI_Service SHALL expose a DELETE endpoint at /api/v1/ai/conversations/:threadId that permanently removes a thread and all its associated records.
5. THE AI_Service SHALL expose a DELETE endpoint at /api/v1/ai/conversations that permanently removes all conversation data for the authenticated user.
6. WHEN any conversation endpoint is called without authentication, THE AI_Service SHALL return a 401 Unauthorized response.
7. IF a request references a threadId that does not exist or does not belong to the authenticated user, THEN THE AI_Service SHALL return a 404 Not Found response.
8. THE AI_Service SHALL scope all conversation data access to the authenticated user's identifier, ensuring no user can read, modify, or delete another user's Conversation_Threads or Conversation_Records.

### Requirement 11: Super Admin Active AI Actions

**User Story:** As the Super Admin, I want the AI to execute real system actions through natural language commands, so that I can manage schools, licenses, and system operations conversationally without navigating multiple UI screens.

#### Acceptance Criteria

1. WHEN the Super Admin sends a natural language message to the AI_Service, THE AI_Service SHALL classify the message as either an informational query or an action request by analyzing intent keywords and sentence structure.
2. WHEN the AI_Service classifies a Super Admin message as an action request, THE AI_Service SHALL map the intent to one of the supported actions on the /super/ai-action endpoint: generate_license, suspend_school, unsuspend_school, extend_license, get_school_info, or get_system_stats.
3. WHEN the AI_Service identifies a destructive action (suspend_school, delete_school), THE AI_Service SHALL present a confirmation prompt to the Super Admin describing the action and its consequences before executing the action.
4. WHEN the Super Admin confirms a destructive action, THE AI_Service SHALL execute the action by calling the /super/ai-action endpoint with the appropriate action type and parameters, and SHALL return the result to the Super Admin in a formatted response.
5. IF the Super Admin declines a confirmation prompt, THEN THE AI_Service SHALL cancel the action and inform the Super Admin that the operation was not performed.
6. THE AI_Service SHALL grant the Super Admin full read access to all schools, users, attendance sessions, payments, audit logs, and system statistics through natural language queries without school-scoping restrictions.
7. WHEN the Super Admin requests a compound action (e.g., "suspend all schools with expired licenses"), THE AI_Service SHALL decompose the request into individual actions, execute each action sequentially, and report the aggregate result including success and failure counts.
8. WHEN the AI_Service executes an action on behalf of the Super Admin, THE AI_Service SHALL log the action in the AuditLog with the actor identified as the Super Admin, the action type, target resource, and a flag indicating the action was initiated via AI.
9. IF the /super/ai-action endpoint returns an error for a requested action, THEN THE AI_Service SHALL relay the error message to the Super Admin in a human-readable format and suggest corrective steps.
10. WHEN the Super Admin requests AI knowledge base management through natural language (e.g., "add a knowledge entry about exam schedules"), THE AI_Service SHALL execute the corresponding CRUD operation on the AI knowledge base and confirm the result.
11. THE AI_Service SHALL restrict active action execution to users with the SUPER_ADMIN role; IF a non-Super Admin user attempts to issue an action command, THEN THE AI_Service SHALL reject the request and return an authorization error.
12. WHEN the AI_Service extracts action parameters from natural language (e.g., school name, plan tier, number of days), THE AI_Service SHALL validate extracted parameters against the /super/ai-action endpoint schema before execution and SHALL prompt the Super Admin for missing required parameters.
