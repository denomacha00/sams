import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';

const { getContextWindow, resolveThread, persistRecord } = vi.hoisted(() => ({
  getContextWindow: vi.fn(),
  resolveThread: vi.fn(),
  persistRecord: vi.fn(),
}));

vi.mock('../conversationMemoryService', () => ({
  conversationMemoryService: {
    resolveThread,
    getContextWindow,
    persistRecord,
  },
}));

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
});
