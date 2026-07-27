import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { queryRoleContext } from './roleContextQuery';
import { findAction } from './roleActionRegistry';

vi.mock('./roleActionRegistry', () => ({
  findAction: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    guardian: {
      findMany: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
    },
    timetableEntry: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';

const hodUser = {
  sub: 'hod-greenwood',
  schoolId: 'school-greenwood',
  role: UserRole.HOD,
  departmentId: 'dept-science',
  iat: 0,
  exp: 9999999999,
};

describe('roleContextQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes HOD school admin query to HOD registry handler', async () => {
    const handler = vi.fn().mockResolvedValue({
      answer: '🏫 **School administrator**\n\n• **Greenwood Admin** (admin@greenwood.edu)',
      data: { admins: [{ fullName: 'Greenwood Admin' }] },
    });
    vi.mocked(findAction).mockImplementation((role, action) => {
      if (role === UserRole.HOD && action === 'list_school_admin') {
        return {
          action: 'list_school_admin',
          handler,
          patterns: [],
          description: '',
          destructive: false,
          extractParams: () => ({}),
          descriptionTemplate: () => '',
        };
      }
      return undefined;
    });

    const result = await queryRoleContext(hodUser as never, 'who is adim of this school');
    expect(result?.intent).toBe('list_school_admin');
    expect(findAction).toHaveBeenCalledWith(UserRole.HOD, 'list_school_admin');
    expect(handler).toHaveBeenCalled();
    expect(result?.answer).toMatch(/Greenwood Admin/);
  });

  it('answers HOD "my teachers" with their department teachers (no dead-end)', async () => {
    // HOD path uses fetchDepartmentTeachers → prisma.user.findMany.
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { fullName: 'Mr. Jones' },
      { fullName: 'Ms. Lee' },
    ] as never);

    const result = await queryRoleContext(hodUser as never, 'my teachers');
    expect(result?.intent).toBe('list_my_teachers');
    expect(result?.answer).toMatch(/Mr\. Jones/);
    expect(result?.answer).not.toMatch(/not linked to a class/i);
  });

  it('answers a guardian "who teaches my child" via their linked child\'s class', async () => {
    const guardianUser = {
      sub: 'guardian-1',
      schoolId: 'school-greenwood',
      role: UserRole.GUARDIAN,
      iat: 0,
      exp: 9999999999,
    };

    // Guardian → linked child with a class.
    vi.mocked(prisma.guardian.findMany).mockResolvedValue([
      { student: { fullName: 'Timmy Turner', classId: 'class-1' } },
    ] as never);
    // getStudentClassContext: class lookup, HOD lookup, timetable entries, teacher users.
    vi.mocked(prisma.class.findUnique).mockResolvedValue({
      id: 'class-1',
      name: 'Form 1A',
      classTeacherId: 'teacher-1',
      departmentId: 'dept-1',
      department: { name: 'Science' },
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'hod-1', fullName: 'Dr. Smith', email: null, phone: null,
    } as never);
    vi.mocked(prisma.timetableEntry.findMany).mockResolvedValue([
      { teacherId: 'teacher-1', subject: 'Mathematics' },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'teacher-1', fullName: 'Mr. Jones', email: null, phone: null },
    ] as never);

    const result = await queryRoleContext(guardianUser as never, 'who teaches my child');
    expect(result?.intent).toBe('list_my_teachers');
    expect(result?.answer).toMatch(/Mr\. Jones/);
    expect(result?.answer).toMatch(/Timmy Turner/);
    expect(result?.answer).not.toMatch(/not linked to a class/i);
  });
});
