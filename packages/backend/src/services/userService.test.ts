import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { userService } from './userService';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    department: {
      findUnique: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
    },
    teacherSubject: {
      createMany: vi.fn(),
    },
  },
}));

vi.mock('./licenseService', () => ({
  licenseService: {
    checkStudentLimit: vi.fn(),
  },
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

describe('userService assignment validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-aligns department when moving a student to another class in the same school', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'student-1',
      schoolId: 'school-1',
      role: UserRole.STUDENT,
      fullName: 'Student One',
      phone: null,
      classId: 'class-old',
      departmentId: 'dept-old',
      passwordHash: 'hash',
    } as never);
    vi.mocked(prisma.class.findUnique).mockResolvedValue({
      schoolId: 'school-1',
      departmentId: 'dept-new',
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'student-1',
      schoolId: 'school-1',
      role: UserRole.STUDENT,
      fullName: 'Student One',
      classId: 'class-new',
      departmentId: 'dept-new',
      passwordHash: 'hash',
    } as never);

    await userService.updateUser('school-1', 'student-1', { classId: 'class-new' });

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'student-1' },
      data: expect.objectContaining({
        classId: 'class-new',
        departmentId: 'dept-new',
      }),
    }));
  });

  it('rejects mismatched class and department assignments', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'student-1',
      schoolId: 'school-1',
      role: UserRole.STUDENT,
      fullName: 'Student One',
      phone: null,
      classId: 'class-old',
      departmentId: 'dept-old',
      passwordHash: 'hash',
    } as never);
    vi.mocked(prisma.class.findUnique).mockResolvedValue({
      schoolId: 'school-1',
      departmentId: 'dept-real',
    } as never);

    await expect(
      userService.updateUser('school-1', 'student-1', {
        classId: 'class-new',
        departmentId: 'dept-wrong',
      }),
    ).rejects.toMatchObject({ code: 'CLASS_DEPARTMENT_MISMATCH' });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('normalizes teacher subjects when creating staff manually', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValue({ schoolId: 'school-1' } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'teacher-1',
      schoolId: 'school-1',
      role: UserRole.TEACHER,
      fullName: 'Teacher One',
      username: 'teacher1',
      phone: null,
      departmentId: 'dept-1',
      classId: null,
      passwordHash: 'hash',
    } as never);

    await userService.createUser('school-1', {
      role: UserRole.TEACHER,
      fullName: 'Teacher One',
      username: 'teacher1',
      password: 'password123',
      departmentId: 'dept-1',
      subjects: [' Math ', 'math', '', 'Physics'],
    });

    expect(prisma.teacherSubject.createMany).toHaveBeenCalledWith({
      data: [
        { schoolId: 'school-1', teacherId: 'teacher-1', subject: 'Math' },
        { schoolId: 'school-1', teacherId: 'teacher-1', subject: 'Physics' },
      ],
    });
  });
});
