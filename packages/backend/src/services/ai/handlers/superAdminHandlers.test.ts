import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { findAction } from '../roleActionRegistry';

const { resetUserPasswordByAdmin, prismaMock } = vi.hoisted(() => ({
  resetUserPasswordByAdmin: vi.fn(),
  prismaMock: {
    school: { count: vi.fn() },
    user: { count: vi.fn() },
    conversationThread: { count: vi.fn() },
    attendanceSession: { findMany: vi.fn() },
    notificationAttachment: { count: vi.fn() },
  },
}));

vi.mock('../../passwordResetService', () => ({
  resetUserPasswordByAdmin: (...args: unknown[]) => resetUserPasswordByAdmin(...args),
  resetUserPasswordBySuperAdmin: (...args: unknown[]) => resetUserPasswordByAdmin(...args),
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('../aiProviderConfig', () => ({
  getAIHealthSummary: () => ({
    configured: true,
    primaryKey: true,
    fallbackKey: true,
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    fallbackModel: 'llama-3.3-70b-versatile',
    modelMismatch: false,
    secretsFilesHint: 'secrets/providers.env',
  }),
}));

vi.mock('../roleActionsPrompt', () => ({
  isConversationMemoryEnabled: () => true,
}));

describe('generate_license action', () => {
  it('extracts natural school names like "another school called mwihoko"', () => {
    const actionDef = findAction(UserRole.SUPER_ADMIN, 'generate_license')!;
    const params = actionDef.extractParams(
      'generate license for another school called mwihoko',
      [
        'generate license for another school called mwihoko',
        'another school called mwihoko',
      ],
    );

    expect(params).toMatchObject({ schoolName: 'mwihoko', planTier: 'BASIC' });
  });

  it('extracts requested plan tiers for license generation', () => {
    const actionDef = findAction(UserRole.SUPER_ADMIN, 'generate_license')!;
    const params = actionDef.extractParams(
      'generate professional license for school called Green Valley',
      [
        'generate professional license for school called Green Valley',
        'school called Green Valley',
      ],
    );

    expect(params).toMatchObject({ schoolName: 'Green Valley', planTier: 'PROFESSIONAL' });
  });

  it('accepts British spelling "licence" for license generation', () => {
    const actionDef = findAction(UserRole.SUPER_ADMIN, 'generate_license')!;
    const pattern = actionDef.patterns.find((candidate) =>
      candidate.test('generate professional licence for school called Green Valley'),
    );
    expect(pattern).toBeDefined();

    const params = actionDef.extractParams(
      'generate professional licence for school called Green Valley',
      [
        'generate professional licence for school called Green Valley',
        'school called Green Valley',
      ],
    );

    expect(params).toMatchObject({ schoolName: 'Green Valley', planTier: 'PROFESSIONAL' });
  });
});

describe('reset_user_password handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to passwordResetService with school scope and actor', async () => {
    resetUserPasswordByAdmin.mockResolvedValue({
      ok: true,
      answer: '✅ Temporary password set for **jsmith**',
      data: { userId: 'user-1', schoolCode: 'ABC123' },
    });

    const actionDef = findAction(UserRole.SUPER_ADMIN, 'reset_user_password');
    expect(actionDef).toBeDefined();
    expect(actionDef!.destructive).toBe(true);

    const result = await actionDef!.handler(
      { identifier: 'jsmith', schoolCode: 'ABC123', mode: 'temp_password' },
      { userId: 'super-1', role: UserRole.SUPER_ADMIN, schoolId: 'platform' },
    );

    expect(resetUserPasswordByAdmin).toHaveBeenCalledWith({
      identifier: 'jsmith',
      schoolCode: 'ABC123',
      schoolId: undefined,
      mode: 'temp_password',
      actorId: 'super-1',
      actorRole: UserRole.SUPER_ADMIN,
      actorScope: { kind: 'platform' },
    });
    expect(result.answer).toContain('Temporary password');
    expect(result.data).toMatchObject({ userId: 'user-1' });
  });

  it('asks for identifier when missing', async () => {
    const actionDef = findAction(UserRole.SUPER_ADMIN, 'reset_user_password')!;
    const result = await actionDef.handler(
      {},
      { userId: 'super-1', role: UserRole.SUPER_ADMIN, schoolId: 'platform' },
    );

    expect(resetUserPasswordByAdmin).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/who needs a password reset/i);
  });

  it('extractParams parses identifier and school code from natural language', () => {
    const actionDef = findAction(UserRole.SUPER_ADMIN, 'reset_user_password')!;
    const params = actionDef.extractParams(
      'reset password for jsmith at school ABC123',
      ['reset password for jsmith at school ABC123', 'jsmith at school ABC123'],
    );

    expect(params).toMatchObject({
      identifier: 'jsmith',
      schoolCode: 'ABC123',
      mode: 'temp_password',
    });
  });

  it('extractParams selects trigger_reset mode when OTP requested', () => {
    const actionDef = findAction(UserRole.SUPER_ADMIN, 'reset_user_password')!;
    const params = actionDef.extractParams(
      'send otp reset for user@example.com at school XYZ9',
      ['send otp reset for user@example.com at school XYZ9', 'user@example.com at school XYZ9'],
    );

    expect(params.mode).toBe('trigger_reset');
  });

  it('matches spaced "pass word" reset wording', () => {
    const actionDef = findAction(UserRole.SUPER_ADMIN, 'reset_user_password')!;
    const pattern = actionDef.patterns.find((candidate) =>
      candidate.test('reset pass word for jsmith at school ABC123'),
    );
    expect(pattern).toBeDefined();

    const params = actionDef.extractParams(
      'reset pass word for jsmith at school ABC123',
      ['reset pass word for jsmith at school ABC123', 'jsmith at school ABC123'],
    );

    expect(params).toMatchObject({
      identifier: 'jsmith',
      schoolCode: 'ABC123',
      mode: 'temp_password',
    });
  });
});

describe('run_system_readiness_check action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports live platform readiness and stale active sessions', async () => {
    prismaMock.school.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    prismaMock.user.count.mockResolvedValue(120);
    prismaMock.conversationThread.count.mockResolvedValue(8);
    prismaMock.notificationAttachment.count.mockResolvedValue(4);
    prismaMock.attendanceSession.findMany.mockResolvedValue([
      {
        id: 'stale-session',
        subject: 'Math',
        schoolId: 'school-1',
        timetableEntry: { dayOfWeek: 0, startTime: '08:00', endTime: '09:00' },
      },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00'));

    const actionDef = findAction(UserRole.SUPER_ADMIN, 'run_system_readiness_check')!;
    const result = await actionDef.handler(
      {},
      { userId: 'super-1', role: UserRole.SUPER_ADMIN, schoolId: 'platform' },
    );

    expect(result.answer).toContain('System readiness check');
    expect(result.answer).toContain('1 past timetable window');
    expect(result.data).toMatchObject({ staleActiveSessions: 1, totalUsers: 120 });

  });
});
