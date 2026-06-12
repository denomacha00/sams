import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';

const { getContextWindow, resolveThread, persistRecord } = vi.hoisted(() => ({
  getContextWindow: vi.fn(),
  resolveThread: vi.fn(),
  persistRecord: vi.fn(),
}));

vi.mock('../conversationMemoryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../conversationMemoryService')>();
  return {
    conversationMemoryService: {
      resolveThread,
      getContextWindow,
      persistRecord,
    },
    buildMemoryNotice: actual.buildMemoryNotice,
  };
});

vi.mock('./roleActionsPrompt', () => ({
  isConversationMemoryEnabled: () => true,
  buildRoleActionsPromptSection: () => '',
  buildRoleCapabilityMatrix: () => '',
}));

vi.mock('./aiProviderConfig', () => ({
  hasPrimaryAIKey: vi.fn().mockReturnValue(true),
  getMissingAIKeyMessage: vi.fn(),
  formatProviderError: vi.fn(),
}));

vi.mock('./roleContextQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./roleContextQuery')>();
  return { ...actual, queryRoleContext: vi.fn().mockResolvedValue(null) };
});

vi.mock('./localEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localEngine')>();
  return {
    ...actual,
    localQuery: vi.fn().mockResolvedValue({ answer: 'local', intent: 'unknown' }),
    queryTimetableView: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('./dataQueryRouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dataQueryRouter')>();
  return {
    ...actual,
    querySamsDataFallback: vi.fn().mockResolvedValue(null),
    isSamsDataQuery: () => false,
  };
});

vi.mock('./timetableQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./timetableQuery')>();
  return {
    ...actual,
    isTimetableViewQuery: () => false,
    isTimetableManageQuery: () => false,
  };
});

vi.mock('./openaiEngine', () => ({
  openaiQuery: vi.fn(),
  openaiQueryWithHistory: vi.fn(),
}));

vi.mock('./actionIntentDetector', () => ({
  actionIntentDetector: { detect: vi.fn().mockResolvedValue({ isAction: false }) },
}));

import { AIService } from '../aiService';
import { openaiQueryWithHistory } from './openaiEngine';

const studentUser = {
  sub: 'stu-1',
  schoolId: 'school-1',
  role: UserRole.STUDENT,
  classId: 'class-1',
  iat: 0,
  exp: 9999999999,
};

describe('AIService conversation memory decrypt failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveThread.mockResolvedValue('thread-1');
    persistRecord.mockResolvedValue(undefined);
    getContextWindow.mockRejectedValue(
      new Error('DECRYPTION_FAILED: Current key failed and no previous key configured'),
    );
    vi.mocked(openaiQueryWithHistory).mockResolvedValue({
      answer: 'Answer without prior thread context.',
      intent: 'openai_response',
    });
  });

  it('still returns an AI answer when encrypted history cannot be decrypted', async () => {
    const service = new AIService();
    const result = await service.query(studentUser as never, 'explain gravity briefly');

    expect(result.answer).toContain('Answer without prior thread context');
    expect(openaiQueryWithHistory).toHaveBeenCalledWith(
      studentUser,
      'explain gravity briefly',
      [],
    );
  });

  it('surfaces memoryNotice when context window has unreadable records', async () => {
    getContextWindow.mockResolvedValue({
      records: [],
      status: 'unreadable',
      skippedCount: 3,
      totalRaw: 3,
    });

    const service = new AIService();
    const result = await service.query(studentUser as never, 'continue our chat');

    expect(result.memoryStatus).toBe('unreadable');
    expect(result.memoryNotice).toContain('encryption key');
  });

  it('persists provider error responses so the thread remains continuous', async () => {
    vi.mocked(openaiQueryWithHistory).mockResolvedValue({
      answer: 'The AI service is rate-limited. Wait a moment and try again.',
      intent: 'ai_error',
    });

    const service = new AIService();
    const result = await service.query(studentUser as never, 'remember this question');

    expect(result.intent).toBe('ai_error');
    expect(persistRecord).toHaveBeenCalledWith(
      studentUser.sub,
      studentUser.schoolId,
      'thread-1',
      'remember this question',
      'The AI service is rate-limited. Wait a moment and try again.',
    );
  });

  it('persists thrown provider errors with the formatted fallback answer', async () => {
    const { formatProviderError } = await import('./aiProviderConfig');
    vi.mocked(formatProviderError).mockReturnValue('Provider failed but this turn was saved.');
    vi.mocked(openaiQueryWithHistory).mockRejectedValue(new Error('rate limited'));

    const service = new AIService();
    const result = await service.query(studentUser as never, 'continue from before');

    expect(result.intent).toBe('ai_error');
    expect(persistRecord).toHaveBeenCalledWith(
      studentUser.sub,
      studentUser.schoolId,
      'thread-1',
      'continue from before',
      'Provider failed but this turn was saved.',
    );
  });
});
