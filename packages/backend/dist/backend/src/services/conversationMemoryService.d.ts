import { type DecryptedConversationRecord } from './ai/tokenBudgetManager';
/**
 * Manages the lifecycle of conversation threads and records — CRUD operations,
 * context window retrieval, retention policies, and per-user limits.
 *
 * All queries are scoped by userId AND schoolId for multi-tenant isolation.
 * Encryption/decryption failures are handled gracefully — corrupted records
 * are skipped and logged to AuditLog.
 */
declare class ConversationMemoryService {
    /**
     * Create a new conversation thread.
     * Auto-generates a title if not provided.
     */
    createThread(userId: string, schoolId: string, title?: string): Promise<{
        id: string;
        userId: string;
        schoolId: string;
        title: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Get paginated list of threads for a user, ordered by most recent activity.
     */
    getThreads(userId: string, schoolId: string, page?: number, pageSize?: number): Promise<{
        threads: Array<{
            id: string;
            userId: string;
            schoolId: string;
            title: string;
            createdAt: Date;
            updatedAt: Date;
        }>;
        total: number;
    }>;
    /**
     * Delete a thread and all its records (cascade).
     * Verifies ownership before deletion.
     */
    deleteThread(userId: string, schoolId: string, threadId: string): Promise<void>;
    /**
     * Delete all conversation data for a user (threads and records).
     */
    deleteAllUserData(userId: string, schoolId: string): Promise<void>;
    /**
     * Encrypt and persist a conversation record.
     * Enforces the 500 record limit and updates thread's updatedAt.
     *
     * Message and response are encrypted together as a JSON payload
     * stored in encryptedMessage. encryptedResponse stores an empty buffer.
     */
    persistRecord(userId: string, schoolId: string, threadId: string, message: string, response: string): Promise<void>;
    /**
     * Get decrypted records for a thread, paginated.
     */
    getThreadRecords(userId: string, schoolId: string, threadId: string, page?: number, pageSize?: number): Promise<{
        records: DecryptedConversationRecord[];
        total: number;
    }>;
    /**
     * Retrieve and decrypt recent records for AI prompt injection.
     * If threadId not specified, uses the most recent thread.
     * Returns records in chronological order (oldest first).
     * Skips records that fail decryption.
     */
    getContextWindow(userId: string, schoolId: string, threadId?: string, maxRecords?: number): Promise<DecryptedConversationRecord[]>;
    /**
     * Resolve a thread for a query:
     * - If threadId provided and valid, return it
     * - If not provided, find the most recent thread
     * - If none exist, create a new one with auto-generated title
     */
    resolveThread(userId: string, schoolId: string, threadId?: string): Promise<string>;
    /**
     * Enforce the 500 record limit per user.
     * If user has >= 500 records, delete oldest ones to get to 499 (making room for new one).
     */
    enforceRecordLimit(userId: string, schoolId: string): Promise<void>;
    /**
     * Purge records older than 90 days (for scheduled job).
     * Returns the number of records deleted.
     */
    purgeExpiredRecords(): Promise<number>;
    /**
     * Decrypt an array of raw records, skipping any that fail decryption.
     * Logs failures to AuditLog.
     */
    private decryptRecords;
    /**
     * Re-encrypt a record with the current key (background, non-blocking).
     */
    private reEncryptRecord;
}
export declare const conversationMemoryService: ConversationMemoryService;
export default conversationMemoryService;
//# sourceMappingURL=conversationMemoryService.d.ts.map