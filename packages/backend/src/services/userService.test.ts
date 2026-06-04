import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { userService } from './userService';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('./licenseService', () => ({
  licenseService: {},
}));

describe('userService.listUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters by multiple roles when roles is provided', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: 'teacher-1',
        schoolId: 'school-1',
        role: UserRole.TEACHER,
        fullName: 'Jane Teacher',
        passwordHash: 'hash',
      },
      {
        id: 'hod-1',
        schoolId: 'school-1',
        role: UserRole.HOD,
        fullName: 'Denis HOD',
        passwordHash: 'hash',
      },
    ] as never);

    await userService.listUsers('school-1', {
      roles: [UserRole.TEACHER, UserRole.HOD],
      departmentId: 'dept-1',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        schoolId: 'school-1',
        role: { in: [UserRole.TEACHER, UserRole.HOD] },
        departmentId: 'dept-1',
      },
    });
  });

  it('uses single role filter when roles is not set', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await userService.listUsers('school-1', { role: UserRole.TEACHER });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        schoolId: 'school-1',
        role: UserRole.TEACHER,
      },
    });
  });
});
