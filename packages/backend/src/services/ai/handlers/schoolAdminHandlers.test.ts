import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { findAction } from '../roleActionRegistry';

const resetUserPasswordByAdmin = vi.fn();

vi.mock('../../passwordResetService', () => ({
  resetUserPasswordByAdmin: (...args: unknown[]) => resetUserPasswordByAdmin(...args),
}));

describe('school admin reset_user_password handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to passwordResetService with school scope from AI context', async () => {
    resetUserPasswordByAdmin.mockResolvedValue({
      ok: true,
      answer: '✅ Temporary password set for **john**',
      data: { userId: 'user-1' },
    });

    const actionDef = findAction(UserRole.SCHOOL_ADMIN, 'reset_user_password');
    expect(actionDef).toBeDefined();
    expect(actionDef!.destructive).toBe(true);

    const result = await actionDef!.handler(
      { identifier: 'john', mode: 'temp_password' },
      { userId: 'admin-1', role: UserRole.SCHOOL_ADMIN, schoolId: 'school-mine' },
    );

    expect(resetUserPasswordByAdmin).toHaveBeenCalledWith({
      identifier: 'john',
      mode: 'temp_password',
      actorId: 'admin-1',
      actorRole: UserRole.SCHOOL_ADMIN,
      actorScope: { kind: 'school', schoolId: 'school-mine' },
    });
    expect(result.answer).toContain('Temporary password');
  });

  it('extractParams parses identifier without school code', () => {
    const actionDef = findAction(UserRole.SCHOOL_ADMIN, 'reset_user_password')!;
    const params = actionDef.extractParams(
      'reset password for john',
      ['reset password for john', 'john'],
    );

    expect(params).toMatchObject({
      identifier: 'john',
      mode: 'temp_password',
    });
  });

  it('extractParams selects trigger_reset mode when OTP requested', () => {
    const actionDef = findAction(UserRole.SCHOOL_ADMIN, 'reset_user_password')!;
    const params = actionDef.extractParams(
      'send otp reset for teacher@school.com',
      ['send otp reset for teacher@school.com', 'teacher@school.com'],
    );

    expect(params.mode).toBe('trigger_reset');
  });
});
