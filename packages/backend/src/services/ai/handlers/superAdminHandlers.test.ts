import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { findAction } from '../roleActionRegistry';

const resetUserPasswordByAdmin = vi.fn();

vi.mock('../../passwordResetService', () => ({
  resetUserPasswordByAdmin: (...args: unknown[]) => resetUserPasswordByAdmin(...args),
  resetUserPasswordBySuperAdmin: (...args: unknown[]) => resetUserPasswordByAdmin(...args),
}));

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
});
