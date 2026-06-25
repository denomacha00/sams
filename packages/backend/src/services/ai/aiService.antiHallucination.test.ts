import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';

vi.mock('../conversationMemoryService', () => ({
  conversationMemoryService: {
    resolveThread: vi.fn().mockResolvedValue(undefined),
    getContextWindow: vi.fn().mockResolvedValue([]),
    persistRecord: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./roleActionsPrompt', () => ({
  isConversationMemoryEnabled: () => false,
  buildRoleActionsPromptSection: () => '',
  buildRoleCapabilityMatrix: () => '',
}));

vi.mock('./aiProviderConfig', () => ({
  hasPrimaryAIKey: vi.fn().mockReturnValue(true),
  getMissingAIKeyMessage: vi.fn(),
  formatProviderError: vi.fn(),
}));

const localQuery = vi.fn();
const queryTimetableView = vi.fn();
const queryRoleContext = vi.fn();

vi.mock('./roleContextQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./roleContextQuery')>();
  return {
    ...actual,
    queryRoleContext: (...args: unknown[]) => queryRoleContext(...args),
  };
});

vi.mock('./localEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localEngine')>();
  return {
    ...actual,
    localQuery: (...args: unknown[]) => localQuery(...args),
    queryTimetableView: (...args: unknown[]) => queryTimetableView(...args),
  };
});

vi.mock('./timetableQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./timetableQuery')>();
  return {
    ...actual,
    isTimetableViewQuery: () => false,
    isTimetableManageQuery: () => false,
    queryTimetableView: (...args: unknown[]) => queryTimetableView(...args),
  };
});

vi.mock('./openaiEngine', () => ({
  openaiQuery: vi.fn(),
  openaiQueryWithHistory: vi.fn(),
}));

vi.mock('./actionIntentDetector', () => ({
  actionIntentDetector: { detect: vi.fn().mockResolvedValue({ isAction: false }) },
}));

vi.mock('./llmActionClassifier', () => ({
  classifyIntent: vi.fn().mockResolvedValue(null),
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

const hodUser = {
  sub: 'hod-1',
  schoolId: 'school-greenwood',
  role: UserRole.HOD,
  departmentId: 'dept-1',
  iat: 0,
  exp: 9999999999,
};

const teacherUser = {
  sub: 'teacher-1',
  schoolId: 'school-1',
  role: UserRole.TEACHER,
  classId: 'class-1',
  iat: 0,
  exp: 9999999999,
};

const superAdminUser = {
  sub: 'super-1',
  schoolId: 'platform',
  role: UserRole.SUPER_ADMIN,
  iat: 0,
  exp: 9999999999,
};

describe('AIService anti-hallucination routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryTimetableView.mockResolvedValue(null);
    queryRoleContext.mockResolvedValue(null);
    vi.mocked(openaiQueryWithHistory).mockResolvedValue({
      answer: 'Photosynthesis converts light to chemical energy.',
      intent: 'openai_response',
    });
  });

  it('blocks LLM for data-like queries when local engine returns unknown', async () => {
    localQuery.mockResolvedValue({
      answer: 'help text',
      intent: 'unknown',
    });

    const service = new AIService();
    const r = await service.query(
      studentUser as never,
      'give me attendance breakdown by week',
    );

    expect(openaiQueryWithHistory).not.toHaveBeenCalled();
    expect(r.engine).toBe('local');
    expect(r.intent).toBe('data_not_found');
    expect(r.answer).toMatch(/couldn't find/i);
  });

  it('uses local engine when intent resolves (no LLM)', async () => {
    localQuery.mockResolvedValue({
      answer: 'The attendance rate is 85.0%',
      intent: 'attendance_percentage',
      data: { percentage: 85 },
    });

    const service = new AIService();
    const r = await service.query(studentUser as never, 'what is my attendance');

    expect(openaiQueryWithHistory).not.toHaveBeenCalled();
    expect(r.intent).toBe('attendance_percentage');
    expect(r.engine).toBe('local');
  });

  it('blocks LLM for who-is school admin phrasing when context returns null', async () => {
    localQuery.mockResolvedValue({ answer: 'help', intent: 'unknown' });
    queryRoleContext.mockResolvedValue(null);

    const service = new AIService();
    const r = await service.query(studentUser as never, 'who is adim of this school');

    expect(openaiQueryWithHistory).not.toHaveBeenCalled();
    expect(r.intent).toBe('data_not_found');
  });

  it('returns DB school admin for HOD before LLM', async () => {
    queryRoleContext.mockResolvedValue({
      answer: '🏫 **School administrator**\n\n• **Greenwood Admin**',
      intent: 'list_school_admin',
      data: { admins: [{ fullName: 'Greenwood Admin' }] },
    });

    const service = new AIService();
    const r = await service.query(hodUser as never, 'who is adim of this school');

    expect(openaiQueryWithHistory).not.toHaveBeenCalled();
    expect(localQuery).not.toHaveBeenCalled();
    expect(queryRoleContext).toHaveBeenCalled();
    expect(r.engine).toBe('local');
    expect(r.intent).toBe('list_school_admin');
    expect(r.answer).toMatch(/Greenwood Admin/);
  });

  it('uses student context handler for my hod without LLM', async () => {
    localQuery.mockResolvedValue({ answer: 'help', intent: 'unknown' });
    queryRoleContext.mockResolvedValue({
      answer: '👤 **Your Head of Department** (Science)\n\n**Dr. Ada** is the HOD.',
      intent: 'list_my_hod',
      data: {},
    });

    const service = new AIService();
    const r = await service.query(studentUser as never, 'my hod');

    expect(openaiQueryWithHistory).not.toHaveBeenCalled();
    expect(queryRoleContext).toHaveBeenCalled();
    expect(r.engine).toBe('local');
    expect(r.intent).toBe('list_my_hod');
    expect(r.answer).toMatch(/Dr\. Ada/);
  });

  it('allows LLM for general knowledge', async () => {
    localQuery.mockResolvedValue({ answer: 'help', intent: 'unknown' });

    const service = new AIService();
    const r = await service.query(studentUser as never, 'what is photosynthesis');

    expect(openaiQueryWithHistory).toHaveBeenCalled();
    expect(r.engine).toBe('openai');
  });

  it('does not pretend to clear notifications when no backend action matched', async () => {
    localQuery.mockResolvedValue({ answer: 'help', intent: 'unknown' });

    const service = new AIService();
    const r = await service.query(studentUser as never, 'clear notifications');

    expect(openaiQueryWithHistory).not.toHaveBeenCalled();
    expect(r.intent).toBe('unsupported_action');
    expect(r.answer).toMatch(/did not clear/i);
  });

  it('does not pretend to change theme when no backend action matched', async () => {
    localQuery.mockResolvedValue({ answer: 'help', intent: 'unknown' });

    const service = new AIService();
    const r = await service.query(studentUser as never, 'change to light mode');

    expect(openaiQueryWithHistory).not.toHaveBeenCalled();
    expect(r.intent).toBe('unsupported_action');
    expect(r.answer).toMatch(/did not change/i);
  });

  it('does not pretend to start a session when no real action matched', async () => {
    localQuery.mockResolvedValue({ answer: 'help', intent: 'unknown' });

    const service = new AIService();
    const r = await service.query(teacherUser as never, 'start sesson');

    expect(openaiQueryWithHistory).not.toHaveBeenCalled();
    expect(r.intent).toBe('unsupported_action');
    expect(r.answer).toMatch(/did not start/i);
  });

  it('blocks fake license keys from LLM answers', async () => {
    localQuery.mockResolvedValue({ answer: 'help', intent: 'unknown' });
    vi.mocked(openaiQueryWithHistory).mockResolvedValue({
      answer: 'Here is your licence key: ABCD-EFGH-IJKL-MNOP',
      intent: 'openai_response',
    });

    const service = new AIService();
    const r = await service.query(superAdminUser as never, 'what is the licence key');

    expect(r.intent).toBe('guarded_secret');
    expect(r.answer).toMatch(/will not guess/i);
    expect(r.answer).not.toContain('ABCD-EFGH');
  });

  it('blocks fake temporary passwords from LLM answers', async () => {
    localQuery.mockResolvedValue({ answer: 'help', intent: 'unknown' });
    vi.mocked(openaiQueryWithHistory).mockResolvedValue({
      answer: 'Temporary password: MadeUp123',
      intent: 'openai_response',
    });

    const service = new AIService();
    const r = await service.query(superAdminUser as never, 'reset pass word');

    expect(r.intent).toBe('guarded_secret');
    expect(r.answer).toMatch(/real SAMS action/i);
    expect(r.answer).not.toContain('MadeUp123');
  });
});
