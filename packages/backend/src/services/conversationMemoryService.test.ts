import { describe, expect, it, vi, beforeEach } from 'vitest';

const { findMany, count, findFirst } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    conversationRecord: { findMany, count },
    conversationThread: { findFirst },
  },
}));

vi.mock('./auditService', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

import {
  conversationMemoryService,
  buildMemoryNotice,
} from './conversationMemoryService';
import { conversationEncryptionService } from './conversationEncryption';

const USER_ID = 'user-test-1';
const SCHOOL_ID = 'school-1';
const THREAD_ID = 'thread-1';
const MASTER_KEY = 'a'.repeat(32);
const OTHER_KEY = 'b'.repeat(32);

function encryptPayload(message: string, response: string, userId: string, masterKey: string) {
  const prev = process.env.CONVERSATION_MASTER_KEY;
  process.env.CONVERSATION_MASTER_KEY = masterKey;
  try {
    const payload = JSON.stringify({ m: message, r: response });
    return conversationEncryptionService.encrypt(payload, userId);
  } finally {
    process.env.CONVERSATION_MASTER_KEY = prev;
  }
}

describe('conversationMemoryService decrypt tolerance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONVERSATION_MASTER_KEY = MASTER_KEY;
    delete process.env.CONVERSATION_MASTER_KEY_PREVIOUS;
  });

  it('skips only records that fail decrypt and returns the rest', async () => {
    const good = encryptPayload('hello', 'hi there', USER_ID, MASTER_KEY);
    const bad = encryptPayload('secret', 'lost', USER_ID, OTHER_KEY);

    findFirst.mockResolvedValue({ id: THREAD_ID });
    findMany.mockResolvedValue([
      {
        id: 'rec-1',
        userId: USER_ID,
        schoolId: SCHOOL_ID,
        threadId: THREAD_ID,
        encryptedMessage: good.encryptedData,
        encryptedResponse: Buffer.alloc(0),
        iv: good.iv,
        authTag: good.authTag,
        createdAt: new Date('2026-06-01T10:00:00Z'),
      },
      {
        id: 'rec-2',
        userId: USER_ID,
        schoolId: SCHOOL_ID,
        threadId: THREAD_ID,
        encryptedMessage: bad.encryptedData,
        encryptedResponse: Buffer.alloc(0),
        iv: bad.iv,
        authTag: bad.authTag,
        createdAt: new Date('2026-06-01T11:00:00Z'),
      },
    ]);

    const result = await conversationMemoryService.getContextWindow(
      USER_ID,
      SCHOOL_ID,
      THREAD_ID,
      20,
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0].message).toBe('hello');
    expect(result.skippedCount).toBe(1);
    expect(result.status).toBe('partial');
    expect(result.totalRaw).toBe(2);
  });

  it('marks thread unreadable when every record fails decrypt', async () => {
    const bad1 = encryptPayload('a', 'b', USER_ID, OTHER_KEY);
    const bad2 = encryptPayload('c', 'd', USER_ID, OTHER_KEY);

    findFirst.mockResolvedValue({ id: THREAD_ID });
    findMany.mockResolvedValue([
      {
        id: 'rec-1',
        userId: USER_ID,
        schoolId: SCHOOL_ID,
        threadId: THREAD_ID,
        encryptedMessage: bad1.encryptedData,
        encryptedResponse: Buffer.alloc(0),
        iv: bad1.iv,
        authTag: bad1.authTag,
        createdAt: new Date('2026-06-01T10:00:00Z'),
      },
      {
        id: 'rec-2',
        userId: USER_ID,
        schoolId: SCHOOL_ID,
        threadId: THREAD_ID,
        encryptedMessage: bad2.encryptedData,
        encryptedResponse: Buffer.alloc(0),
        iv: bad2.iv,
        authTag: bad2.authTag,
        createdAt: new Date('2026-06-01T11:00:00Z'),
      },
    ]);

    const result = await conversationMemoryService.getContextWindow(
      USER_ID,
      SCHOOL_ID,
      THREAD_ID,
    );

    expect(result.records).toHaveLength(0);
    expect(result.status).toBe('unreadable');
    expect(buildMemoryNotice(result.status, result.skippedCount)).toContain('encryption key');
  });

  it('getThreadRecords exposes memoryNotice for partial decrypt', async () => {
    const good = encryptPayload('q', 'a', USER_ID, MASTER_KEY);
    const bad = encryptPayload('x', 'y', USER_ID, OTHER_KEY);

    findFirst.mockResolvedValue({ id: THREAD_ID });
    findMany.mockResolvedValue([
      {
        id: 'rec-1',
        userId: USER_ID,
        schoolId: SCHOOL_ID,
        threadId: THREAD_ID,
        encryptedMessage: good.encryptedData,
        encryptedResponse: Buffer.alloc(0),
        iv: good.iv,
        authTag: good.authTag,
        createdAt: new Date('2026-06-01T10:00:00Z'),
      },
      {
        id: 'rec-2',
        userId: USER_ID,
        schoolId: SCHOOL_ID,
        threadId: THREAD_ID,
        encryptedMessage: bad.encryptedData,
        encryptedResponse: Buffer.alloc(0),
        iv: bad.iv,
        authTag: bad.authTag,
        createdAt: new Date('2026-06-01T11:00:00Z'),
      },
    ]);
    count.mockResolvedValue(2);

    const result = await conversationMemoryService.getThreadRecords(
      USER_ID,
      SCHOOL_ID,
      THREAD_ID,
    );

    expect(result.records).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
    expect(result.status).toBe('partial');
    expect(result.memoryNotice).toContain('1 earlier message');
  });
});
