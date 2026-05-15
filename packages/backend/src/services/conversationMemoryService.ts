import { prisma } from '../index';
import { conversationEncryptionService, type EncryptedConversationData } from './conversationEncryption';
import { type DecryptedConversationRecord } from './ai/tokenBudgetManager';
import { auditService } from './auditService';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of conversation records per user */
const MAX_RECORDS_PER_USER = 500;

/** Maximum retention period in days */
const RETENTION_DAYS = 90;

/** Default page size for thread listing */
const DEFAULT_THREADS_PAGE_SIZE = 50;

/** Maximum page size for thread listing */
const MAX_THREADS_PAGE_SIZE = 100;

/** Default page size for record listing */
const DEFAULT_RECORDS_PAGE_SIZE = 100;

/** Maximum page size for record listing */
const MAX_RECORDS_PAGE_SIZE = 200;

/** Default max records for context window */
const DEFAULT_CONTEXT_MAX_RECORDS = 20;

// ─── ConversationMemoryService ────────────────────────────────────────────────

/**
 * Manages the lifecycle of conversation threads and records — CRUD operations,
 * context window retrieval, retention policies, and per-user limits.
 *
 * All queries are scoped by userId AND schoolId for multi-tenant isolation.
 * Encryption/decryption failures are handled gracefully — corrupted records
 * are skipped and logged to AuditLog.
 */
class ConversationMemoryService {
  // ─── Thread Management ────────────────────────────────────────────────

  /**
   * Create a new conversation thread.
   * Auto-generates a title if not provided.
   */
  async createThread(
    userId: string,
    schoolId: string,
    title?: string,
  ): Promise<{ id: string; userId: string; schoolId: string; title: string; createdAt: Date; updatedAt: Date }> {
    const threadTitle = title?.trim() || `Conversation ${new Date().toLocaleDateString()}`;

    const thread = await prisma.conversationThread.create({
      data: {
        userId,
        schoolId,
        title: threadTitle.slice(0, 200),
      },
    });

    return thread;
  }

  /**
   * Get paginated list of threads for a user, ordered by most recent activity.
   */
  async getThreads(
    userId: string,
    schoolId: string,
    page: number = 1,
    pageSize: number = DEFAULT_THREADS_PAGE_SIZE,
  ): Promise<{ threads: Array<{ id: string; userId: string; schoolId: string; title: string; createdAt: Date; updatedAt: Date }>; total: number }> {
    const effectivePageSize = Math.min(Math.max(1, pageSize), MAX_THREADS_PAGE_SIZE);
    const effectivePage = Math.max(1, page);
    const skip = (effectivePage - 1) * effectivePageSize;

    const [threads, total] = await Promise.all([
      prisma.conversationThread.findMany({
        where: { userId, schoolId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: effectivePageSize,
      }),
      prisma.conversationThread.count({
        where: { userId, schoolId },
      }),
    ]);

    return { threads, total };
  }

  /**
   * Delete a thread and all its records (cascade).
   * Verifies ownership before deletion.
   */
  async deleteThread(userId: string, schoolId: string, threadId: string): Promise<void> {
    // Verify ownership
    const thread = await prisma.conversationThread.findFirst({
      where: { id: threadId, userId, schoolId },
    });

    if (!thread) {
      throw new Error('Thread not found');
    }

    // Cascade delete: records are deleted via onDelete: Cascade in schema
    await prisma.conversationThread.delete({
      where: { id: threadId },
    });
  }

  /**
   * Delete all conversation data for a user (threads and records).
   */
  async deleteAllUserData(userId: string, schoolId: string): Promise<void> {
    // Delete all records first (in case cascade isn't fast enough for bulk)
    await prisma.conversationRecord.deleteMany({
      where: { userId, schoolId },
    });

    // Then delete all threads
    await prisma.conversationThread.deleteMany({
      where: { userId, schoolId },
    });
  }

  // ─── Record Management ────────────────────────────────────────────────

  /**
   * Encrypt and persist a conversation record.
   * Enforces the 500 record limit and updates thread's updatedAt.
   *
   * Message and response are encrypted together as a JSON payload
   * stored in encryptedMessage. encryptedResponse stores an empty buffer.
   */
  async persistRecord(
    userId: string,
    schoolId: string,
    threadId: string,
    message: string,
    response: string,
  ): Promise<void> {
    try {
      // Enforce record limit before inserting
      await this.enforceRecordLimit(userId, schoolId);

      // Encrypt message and response together as JSON
      const payload = JSON.stringify({ m: message, r: response });
      const encrypted = conversationEncryptionService.encrypt(payload, userId);

      // Store the record
      await prisma.conversationRecord.create({
        data: {
          userId,
          schoolId,
          threadId,
          encryptedMessage: encrypted.encryptedData,
          encryptedResponse: Buffer.alloc(0), // Unused — combined payload in encryptedMessage
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        },
      });

      // Update thread's updatedAt timestamp
      await prisma.conversationThread.update({
        where: { id: threadId },
        data: { updatedAt: new Date() },
      });
    } catch (err) {
      // Log but don't propagate — AI response is more important than persistence
      console.error('[ConversationMemoryService] Failed to persist record:', err);
    }
  }

  /**
   * Get decrypted records for a thread, paginated.
   */
  async getThreadRecords(
    userId: string,
    schoolId: string,
    threadId: string,
    page: number = 1,
    pageSize: number = DEFAULT_RECORDS_PAGE_SIZE,
  ): Promise<{ records: DecryptedConversationRecord[]; total: number }> {
    const effectivePageSize = Math.min(Math.max(1, pageSize), MAX_RECORDS_PAGE_SIZE);
    const effectivePage = Math.max(1, page);
    const skip = (effectivePage - 1) * effectivePageSize;

    // Verify thread ownership
    const thread = await prisma.conversationThread.findFirst({
      where: { id: threadId, userId, schoolId },
    });

    if (!thread) {
      throw new Error('Thread not found');
    }

    const [rawRecords, total] = await Promise.all([
      prisma.conversationRecord.findMany({
        where: { userId, schoolId, threadId },
        orderBy: { createdAt: 'asc' },
        skip,
        take: effectivePageSize,
      }),
      prisma.conversationRecord.count({
        where: { userId, schoolId, threadId },
      }),
    ]);

    const records = await this.decryptRecords(rawRecords, userId);

    return { records, total };
  }

  // ─── Context Window ───────────────────────────────────────────────────

  /**
   * Retrieve and decrypt recent records for AI prompt injection.
   * If threadId not specified, uses the most recent thread.
   * Returns records in chronological order (oldest first).
   * Skips records that fail decryption.
   */
  async getContextWindow(
    userId: string,
    schoolId: string,
    threadId?: string,
    maxRecords: number = DEFAULT_CONTEXT_MAX_RECORDS,
  ): Promise<DecryptedConversationRecord[]> {
    // Determine which thread to use
    let targetThreadId = threadId;

    if (!targetThreadId) {
      const mostRecentThread = await prisma.conversationThread.findFirst({
        where: { userId, schoolId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });

      if (!mostRecentThread) {
        return [];
      }

      targetThreadId = mostRecentThread.id;
    }

    // Fetch the most recent records (DESC to get latest, then reverse for chronological)
    const rawRecords = await prisma.conversationRecord.findMany({
      where: { userId, schoolId, threadId: targetThreadId },
      orderBy: { createdAt: 'desc' },
      take: maxRecords,
    });

    // Reverse to chronological order (oldest first)
    rawRecords.reverse();

    // Decrypt records, skipping failures
    const decrypted = await this.decryptRecords(rawRecords, userId);

    return decrypted;
  }

  // ─── Thread Resolution ────────────────────────────────────────────────

  /**
   * Resolve a thread for a query:
   * - If threadId provided and valid, return it
   * - If not provided, find the most recent thread
   * - If none exist, create a new one with auto-generated title
   */
  async resolveThread(
    userId: string,
    schoolId: string,
    threadId?: string,
  ): Promise<string> {
    // If threadId provided, verify it exists and belongs to user
    if (threadId) {
      const thread = await prisma.conversationThread.findFirst({
        where: { id: threadId, userId, schoolId },
        select: { id: true },
      });

      if (thread) {
        return thread.id;
      }
      // If provided threadId is invalid, fall through to find/create
    }

    // Find the most recent thread
    const mostRecent = await prisma.conversationThread.findFirst({
      where: { userId, schoolId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    if (mostRecent) {
      return mostRecent.id;
    }

    // No threads exist — create a new one
    const newThread = await this.createThread(userId, schoolId);
    return newThread.id;
  }

  // ─── Retention & Limits ───────────────────────────────────────────────

  /**
   * Enforce the 500 record limit per user.
   * If user has >= 500 records, delete oldest ones to get to 499 (making room for new one).
   */
  async enforceRecordLimit(userId: string, schoolId: string): Promise<void> {
    const count = await prisma.conversationRecord.count({
      where: { userId, schoolId },
    });

    if (count >= MAX_RECORDS_PER_USER) {
      const excess = count - MAX_RECORDS_PER_USER + 1; // Delete enough to make room for 1 new record

      const oldestRecords = await prisma.conversationRecord.findMany({
        where: { userId, schoolId },
        orderBy: { createdAt: 'asc' },
        take: excess,
        select: { id: true },
      });

      if (oldestRecords.length > 0) {
        await prisma.conversationRecord.deleteMany({
          where: {
            id: { in: oldestRecords.map((r) => r.id) },
          },
        });
      }
    }
  }

  /**
   * Purge records older than 90 days (for scheduled job).
   * Returns the number of records deleted.
   */
  async purgeExpiredRecords(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    const result = await prisma.conversationRecord.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * Decrypt an array of raw records, skipping any that fail decryption.
   * Logs failures to AuditLog.
   */
  private async decryptRecords(
    rawRecords: Array<{
      id: string;
      userId: string;
      schoolId: string;
      threadId: string;
      encryptedMessage: Buffer;
      encryptedResponse: Buffer;
      iv: Buffer;
      authTag: Buffer;
      createdAt: Date;
    }>,
    userId: string,
  ): Promise<DecryptedConversationRecord[]> {
    const decrypted: DecryptedConversationRecord[] = [];

    for (const record of rawRecords) {
      try {
        const encrypted: EncryptedConversationData = {
          encryptedData: Buffer.from(record.encryptedMessage),
          iv: Buffer.from(record.iv),
          authTag: Buffer.from(record.authTag),
        };

        const { plaintext, usedPreviousKey } = conversationEncryptionService.decryptWithFallback(encrypted, userId);

        // Parse the JSON payload
        const parsed = JSON.parse(plaintext) as { m: string; r: string };

        decrypted.push({
          id: record.id,
          message: parsed.m,
          response: parsed.r,
          createdAt: record.createdAt,
        });

        // If decrypted with previous key, re-encrypt with current key
        if (usedPreviousKey) {
          this.reEncryptRecord(record.id, encrypted, userId).catch((err) => {
            console.error(`[ConversationMemoryService] Re-encryption failed for record ${record.id}:`, err);
          });
        }
      } catch (err) {
        // Skip corrupted records, log to AuditLog
        console.error(`[ConversationMemoryService] Decryption failed for record ${record.id}:`, err);
        try {
          await auditService.log({
            eventType: 'CONFLICT_RESOLVED',
            actorId: userId,
            schoolId: record.schoolId,
            resourceSnapshot: {
              action: 'DECRYPTION_FAILED',
              recordId: record.id,
              threadId: record.threadId,
              error: err instanceof Error ? err.message : 'Unknown error',
            },
          });
        } catch {
          // Don't let audit logging failure break the flow
        }
      }
    }

    return decrypted;
  }

  /**
   * Re-encrypt a record with the current key (background, non-blocking).
   */
  private async reEncryptRecord(
    recordId: string,
    encrypted: EncryptedConversationData,
    userId: string,
  ): Promise<void> {
    try {
      const reEncrypted = conversationEncryptionService.reEncrypt(encrypted, userId);

      await prisma.conversationRecord.update({
        where: { id: recordId },
        data: {
          encryptedMessage: reEncrypted.encryptedData,
          iv: reEncrypted.iv,
          authTag: reEncrypted.authTag,
        },
      });
    } catch (err) {
      // Log but don't fail — data was already successfully decrypted
      console.error(`[ConversationMemoryService] Re-encryption failed for record ${recordId}:`, err);
      await auditService.log({
        eventType: 'CONFLICT_RESOLVED',
        resourceSnapshot: {
          action: 'RE_ENCRYPTION_FAILED',
          recordId,
          userId,
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      });
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const conversationMemoryService = new ConversationMemoryService();

export default conversationMemoryService;
