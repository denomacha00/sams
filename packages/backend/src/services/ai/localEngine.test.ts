import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@sams/shared';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    class: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    timetableEntry: {
      findMany: vi.fn(),
      count: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../lib/prisma', () => ({
  prisma: prismaMock,
}));

import { localQuery } from './localEngine';

describe('localQuery timetable generation', () => {
  const hodUser = {
    sub: 'hod-1',
    role: UserRole.HOD,
    schoolId: 'school-1',
    departmentId: 'dept-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.class.findMany.mockResolvedValue([
      { id: 'class-1', name: 'Form 1A', departmentId: 'dept-1' },
    ]);
    prismaMock.timetableEntry.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaMock.timetableEntry.count.mockResolvedValue(0);
    prismaMock.timetableEntry.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
    prismaMock.timetableEntry.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'teacher-1', fullName: 'Teacher One', departmentId: 'dept-1' },
    ]);
  });

  it('limits HOD whole-school timetable generation to the HOD department', async () => {
    const result = await localQuery(hodUser as any, 'generate timetable');

    expect(result.intent).toBe('generate_timetable');
    expect(prismaMock.class.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: 'school-1', departmentId: 'dept-1' },
      }),
    );
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: 'school-1',
          departmentId: 'dept-1',
        }),
      }),
    );
    const createArg = prismaMock.timetableEntry.createMany.mock.calls[0][0] as { data: Array<{ classId: string; teacherId: string }> };
    expect(createArg.data.every((slot) => slot.classId === 'class-1')).toBe(true);
    expect(createArg.data.every((slot) => slot.teacherId === 'teacher-1')).toBe(true);
  });

  it('remakes only the HOD department target classes', async () => {
    prismaMock.class.findMany.mockResolvedValueOnce([
      { id: 'class-1', name: 'Form 1A', departmentId: 'dept-1' },
      { id: 'class-2', name: 'Form 1B', departmentId: 'dept-1' },
    ]);

    await localQuery(hodUser as any, 'remake timetable');

    expect(prismaMock.timetableEntry.deleteMany).toHaveBeenCalledWith({
      where: {
        schoolId: 'school-1',
        classId: { in: ['class-1', 'class-2'] },
      },
    });
  });
});
