import { describe, it, expect, vi, beforeEach } from 'vitest';
import { licenseService } from './licenseService';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: {
    school: { update: vi.fn() },
    attendanceSession: { updateMany: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
  },
}));

vi.mock('./auditService', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

describe('licenseService.suspendSchool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.school.update).mockResolvedValue({
      id: 'school-1',
      name: 'Test School',
    } as any);
    vi.mocked(prisma.attendanceSession.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 3 });
  });

  it('deletes refresh tokens for all users in the school', async () => {
    await licenseService.suspendSchool('school-1');

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { user: { schoolId: 'school-1' } },
    });
  });
});
