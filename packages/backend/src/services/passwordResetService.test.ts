import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateTemporaryPassword, resetUserPasswordByAdmin, resetUserPasswordBySuperAdmin } from './passwordResetService';
import { prisma } from '../index';

vi.mock('../index', () => ({
  prisma: {
    school: { findUnique: vi.fn() },
    user: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));

vi.mock('./auditService', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

describe('passwordResetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateTemporaryPassword returns URL-safe string of requested length', () => {
    const pwd = generateTemporaryPassword(12);
    expect(pwd).toHaveLength(12);
    expect(pwd).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('resetUserPasswordBySuperAdmin refuses Super Admin targets', async () => {
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      id: 'school-1',
      name: 'Platform',
      schoolCode: 'SAMS_PLATFORM',
    } as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'sa-1',
      role: 'SUPER_ADMIN',
      username: 'superadmin',
      email: 'admin@example.com',
      schoolId: 'school-1',
      school: { id: 'school-1', name: 'Platform', schoolCode: 'SAMS_PLATFORM' },
    } as any);

    const result = await resetUserPasswordBySuperAdmin({
      identifier: 'superadmin',
      schoolCode: 'SAMS_PLATFORM',
    });

    expect(result.ok).toBe(false);
    expect(result.answer).toMatch(/super admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('resetUserPasswordByAdmin with school scope rejects cross-school schoolCode', async () => {
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      id: 'school-other',
      name: 'Other High',
      schoolCode: 'OTHER1',
    } as any);

    const result = await resetUserPasswordByAdmin({
      identifier: 'jsmith',
      schoolCode: 'OTHER1',
      actorScope: { kind: 'school', schoolId: 'school-mine' },
    });

    expect(result.ok).toBe(false);
    expect(result.answer).toMatch(/your own school/i);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('resetUserPasswordByAdmin with school scope refuses peer school admin targets', async () => {
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      id: 'school-mine',
      name: 'My School',
      schoolCode: 'MINE1',
    } as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'admin-2',
      role: 'SCHOOL_ADMIN',
      username: 'viceadmin',
      email: 'vice@school.com',
      schoolId: 'school-mine',
      school: { id: 'school-mine', name: 'My School', schoolCode: 'MINE1' },
    } as any);

    const result = await resetUserPasswordByAdmin({
      identifier: 'viceadmin',
      actorScope: { kind: 'school', schoolId: 'school-mine' },
    });

    expect(result.ok).toBe(false);
    expect(result.answer).toMatch(/school admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('resetUserPasswordByAdmin with school scope looks up user in actor school only', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'teacher-1',
      role: 'TEACHER',
      username: 'jsmith',
      email: 'jsmith@school.com',
      schoolId: 'school-mine',
      school: { id: 'school-mine', name: 'My School', schoolCode: 'MINE1' },
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    const result = await resetUserPasswordByAdmin({
      identifier: 'jsmith',
      actorScope: { kind: 'school', schoolId: 'school-mine' },
      actorId: 'admin-1',
      actorRole: 'SCHOOL_ADMIN',
    });

    expect(result.ok).toBe(true);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ schoolId: 'school-mine' }),
      }),
    );
    expect(result.answer).toMatch(/temporary password/i);
  });
});
