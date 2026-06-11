import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@sams/shared';

const { prismaMock, sessionServiceMock, resolveTeacherTeachingClassIdsMock } = vi.hoisted(() => ({
  prismaMock: {
    class: { findMany: vi.fn() },
    timetableEntry: { findMany: vi.fn() },
    attendanceSession: { findFirst: vi.fn() },
  },
  sessionServiceMock: {
    startSession: vi.fn(),
    endSession: vi.fn(),
  },
  resolveTeacherTeachingClassIdsMock: vi.fn(),
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('../../../lib/teacherScope', () => ({
  resolveTeacherTeachingClassIds: resolveTeacherTeachingClassIdsMock,
}));

vi.mock('../../sessionService', () => ({
  sessionService: sessionServiceMock,
}));

vi.mock('../../../lib/schoolAdminLookup', () => ({
  listSchoolAdminHandler: vi.fn(),
}));

vi.mock('../studentContextQuery', () => ({
  SCHOOL_ADMIN_QUERY_PATTERNS: [],
}));

vi.mock('./registrationLinkAction', () => ({
  createRegistrationLinkActionDef: {
    action: 'create_registration_link',
    description: 'Create registration link',
    destructive: false,
    patterns: [],
    extractParams: () => ({}),
    descriptionTemplate: () => 'Create registration link',
    handler: vi.fn(),
  },
}));

import { teacherActions } from './teacherHandlers';

describe('teacher AI attendance actions', () => {
  const scope = {
    userId: 'teacher-1',
    role: UserRole.TEACHER,
    schoolId: 'school-1',
    classId: 'class-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T08:15:00'));
    resolveTeacherTeachingClassIdsMock.mockResolvedValue(['class-1']);
    prismaMock.class.findMany.mockResolvedValue([{ id: 'class-1', name: 'Form 1A' }]);
    prismaMock.timetableEntry.findMany.mockResolvedValue([
      { id: 'entry-1', subject: 'Math', startTime: '08:00', endTime: '09:00' },
    ]);
    sessionServiceMock.startSession.mockResolvedValue({ id: 'session-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds the current timetable slot and sends the teacher to the GPS-aware session screen', async () => {
    const action = teacherActions.find((item) => item.action === 'start_session');

    const result = await action!.handler({ classId: 'class-1' }, scope as any);

    expect(prismaMock.timetableEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: 'school-1',
          teacherId: 'teacher-1',
          classId: 'class-1',
          dayOfWeek: 0,
        }),
      }),
    );
    expect(sessionServiceMock.startSession).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/Sign In Students/i);
    expect(result.data).toEqual({ classId: 'class-1', timetableEntryId: 'entry-1' });
  });

  it('does not start a session outside the current timetable slot', async () => {
    prismaMock.timetableEntry.findMany.mockResolvedValueOnce([
      { id: 'entry-2', subject: 'Math', startTime: '10:00', endTime: '11:00' },
    ]);
    const action = teacherActions.find((item) => item.action === 'start_session');

    const result = await action!.handler({ classId: 'class-1' }, scope as any);

    expect(sessionServiceMock.startSession).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/no current timetable slot/i);
  });
});
