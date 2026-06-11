import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { findAction } from '../roleActionRegistry';

const { prismaMock, sessionServiceMock } = vi.hoisted(() => ({
  prismaMock: {
    class: { findMany: vi.fn(), create: vi.fn() },
    timetableEntry: { findMany: vi.fn() },
    attendanceSession: { findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    attendanceRecord: { upsert: vi.fn() },
  },
  sessionServiceMock: {
    startSession: vi.fn(),
    endSession: vi.fn(),
  },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('../../sessionService', () => ({
  sessionService: sessionServiceMock,
}));

vi.mock('../departmentStatsQuery', () => ({
  fetchDepartmentStats: vi.fn().mockResolvedValue({
    teacherCount: 1,
    studentCount: 15,
    classCount: 2,
    departmentId: 'dept-1',
  }),
  formatDepartmentStatsAnswer: vi.fn(
    (stats: { teacherCount: number; studentCount: number; classCount: number }) =>
      `Teachers: ${stats.teacherCount}, Students: ${stats.studentCount}, Classes: ${stats.classCount}`,
  ),
}));

describe('view_department_stats handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T08:15:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns teacher, student, and class counts for HOD scope', async () => {
    const actionDef = findAction(UserRole.HOD, 'view_department_stats');
    expect(actionDef).toBeDefined();

    const result = await actionDef!.handler(
      {},
      {
        userId: 'hod-1',
        role: UserRole.HOD,
        schoolId: 'school-1',
        departmentId: 'dept-1',
      },
    );

    expect(result.answer).toContain('Students: 15');
    expect(result.answer).toContain('Teachers: 1');
    expect(result.answer).toContain('Classes: 2');
    expect(result.data).toMatchObject({
      teacherCount: 1,
      studentCount: 15,
      classCount: 2,
      departmentId: 'dept-1',
    });
  });

  it('reports missing department on HOD account', async () => {
    const actionDef = findAction(UserRole.HOD, 'view_department_stats')!;
    const result = await actionDef.handler(
      {},
      { userId: 'hod-1', role: UserRole.HOD, schoolId: 'school-1' },
    );
    expect(result.answer).toMatch(/not linked to a department/i);
  });
});

describe('HOD AI attendance actions', () => {
  const scope = {
    userId: 'hod-1',
    role: UserRole.HOD,
    schoolId: 'school-1',
    departmentId: 'dept-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T08:15:00'));
    prismaMock.class.findMany.mockResolvedValue([{ id: 'class-1', name: 'Form 1A' }]);
    prismaMock.timetableEntry.findMany.mockResolvedValue([
      { id: 'entry-1', subject: 'Math', startTime: '08:00', endTime: '09:00' },
    ]);
    prismaMock.attendanceSession.findMany.mockResolvedValue([
      {
        id: 'session-1',
        subject: 'Math',
        classId: 'class-1',
        class: { name: 'Form 1A', departmentId: 'dept-1' },
      },
    ]);
    prismaMock.user.findFirst.mockResolvedValue({ id: 'student-1', fullName: 'Amina Test' });
    prismaMock.attendanceRecord.upsert.mockResolvedValue({});
    prismaMock.class.create.mockResolvedValue({
      id: 'class-new',
      name: 'Form 2B',
      capacity: 40,
    });
    sessionServiceMock.startSession.mockResolvedValue({ id: 'session-1' });
    sessionServiceMock.endSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds the current department slot and sends the HOD to the GPS-aware session screen', async () => {
    const action = findAction(UserRole.HOD, 'start_session');

    const result = await action!.handler({ classId: 'class-1' }, scope);

    expect(prismaMock.timetableEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: 'school-1',
          classId: 'class-1',
          dayOfWeek: 0,
          class: { departmentId: 'dept-1' },
        }),
      }),
    );
    expect(sessionServiceMock.startSession).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/Sign In Students/i);
    expect(result.data).toEqual({ classId: 'class-1', timetableEntryId: 'entry-1' });
  });

  it('ends only a department-scoped active session', async () => {
    const action = findAction(UserRole.HOD, 'end_session');

    const result = await action!.handler({ classId: 'class-1' }, scope);

    expect(prismaMock.attendanceSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: 'school-1',
          isActive: true,
          classId: 'class-1',
          class: { departmentId: 'dept-1' },
        }),
      }),
    );
    expect(sessionServiceMock.endSession).toHaveBeenCalledWith(
      'session-1',
      'hod-1',
      {
        actorRole: UserRole.HOD,
        actorDepartmentId: 'dept-1',
      },
    );
    expect(result.data).toEqual({ sessionId: 'session-1' });
  });

  it('marks a department student in the selected active session', async () => {
    const action = findAction(UserRole.HOD, 'mark_attendance');

    const result = await action!.handler(
      { classId: 'class-1', studentName: 'Amina', status: 'PRESENT' },
      scope,
    );

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        schoolId: 'school-1',
        role: 'STUDENT',
        departmentId: 'dept-1',
        classId: 'class-1',
        fullName: { contains: 'Amina', mode: 'insensitive' },
      },
    });
    expect(prismaMock.attendanceRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId_studentId: { sessionId: 'session-1', studentId: 'student-1' } },
      }),
    );
    expect(result.data).toEqual({
      sessionId: 'session-1',
      studentId: 'student-1',
      status: 'PRESENT',
    });
  });

  it('blocks attendance actions when HOD has no department', async () => {
    const action = findAction(UserRole.HOD, 'start_session');

    const result = await action!.handler({}, {
      userId: 'hod-1',
      role: UserRole.HOD,
      schoolId: 'school-1',
    });

    expect(result.answer).toMatch(/not linked to a department/i);
    expect(sessionServiceMock.startSession).not.toHaveBeenCalled();
  });

  it('creates a class only inside the HOD department', async () => {
    const action = findAction(UserRole.HOD, 'create_class');

    const result = await action!.handler({ className: 'Form 2B', capacity: 40 }, scope);

    expect(prismaMock.class.create).toHaveBeenCalledWith({
      data: {
        schoolId: 'school-1',
        departmentId: 'dept-1',
        name: 'Form 2B',
        capacity: 40,
      },
    });
    expect(result.data).toEqual({
      classId: 'class-new',
      departmentId: 'dept-1',
      capacity: 40,
    });
  });
});
