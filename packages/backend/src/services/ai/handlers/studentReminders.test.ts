import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { actionIntentDetector } from '../actionIntentDetector';
import { findAction, isActionPermitted } from '../roleActionRegistry';
import { schemaDayName } from '../../../lib/studentScheduleHelpers';
import { schemaDayOfWeekInTimezone } from '../../../lib/appTimezone';

const FIXED_NOW = new Date('2026-06-03T10:00:00Z');
const APP_TZ = 'Africa/Nairobi';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    timetableEntry: {
      findMany: vi.fn(),
    },
    schoolClosure: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../index', () => ({
  prisma: {
    attendanceRecord: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../lib/studentClassTeachers', () => ({
  getStudentClassContext: vi.fn().mockResolvedValue({
    classId: 'class-1',
    className: 'Form 2A',
    departmentId: 'dept-1',
    departmentName: 'General',
    hod: null,
    teachers: [{ fullName: 'Ms. Wanjiku' }],
  }),
  formatStudentTeachersAnswer: vi.fn(),
}));

import { prisma } from '../../../lib/prisma';

const studentScope = {
  userId: 'student-1',
  role: UserRole.STUDENT,
  schoolId: 'school-1',
  classId: 'class-1',
};

describe('student reminder actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.schoolClosure.findUnique).mockResolvedValue(null);
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('permits explain_reminders and view_today_schedule for STUDENT', () => {
    expect(isActionPermitted(UserRole.STUDENT, 'explain_reminders')).toBe(true);
    expect(isActionPermitted(UserRole.STUDENT, 'view_today_schedule')).toBe(true);
    expect(findAction(UserRole.STUDENT, 'explain_reminders')).toBeDefined();
  });

  it('detects explain_reminders after timetable-style ask', async () => {
    const cases = [
      'will you remind me at that time please',
      'can you remind me before math',
      'set a reminder for my next class',
    ];
    for (const message of cases) {
      const result = await actionIntentDetector.detect(message, UserRole.STUDENT);
      expect(result.isAction).toBe(true);
      expect(result.action).toBe('explain_reminders');
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it('detects view_today_schedule for natural phrasing', async () => {
    const result = await actionIntentDetector.detect('what classes do I have today', UserRole.STUDENT);
    expect(result.action).toBe('view_today_schedule');
  });

  it('explain_reminders handler is honest and mentions Notifications', async () => {
    const day = schemaDayOfWeekInTimezone(FIXED_NOW, APP_TZ);
    vi.mocked(prisma.timetableEntry.findMany).mockResolvedValue([
      {
        startTime: '08:00',
        endTime: '08:40',
        subject: 'Math',
        teacher: { fullName: 'Mr. Otieno' },
        dayOfWeek: day,
      },
    ] as Awaited<ReturnType<typeof prisma.timetableEntry.findMany>>);

    const def = findAction(UserRole.STUDENT, 'explain_reminders');
    expect(def).toBeDefined();
    const result = await def!.handler({}, studentScope);

    expect(result.answer).toMatch(/doesn't send timed personal push\/SMS reminders/i);
    expect(result.answer).toMatch(/Each morning you'll get \*\*Today's classes\*\*/i);
    expect(result.answer).toMatch(/Notifications/i);
    expect(result.answer).toMatch(/phone calendar/i);
    expect(result.answer).toMatch(schemaDayName(day));
    expect(result.answer).toMatch(/Math/);
  });

  it('view_today_schedule lists only today slots', async () => {
    const day = schemaDayOfWeekInTimezone(FIXED_NOW, APP_TZ);
    vi.mocked(prisma.timetableEntry.findMany).mockResolvedValue([
      {
        startTime: '10:00',
        endTime: '10:40',
        subject: 'English',
        teacher: { fullName: 'Ms. Wanjiku' },
        dayOfWeek: day,
      },
    ] as Awaited<ReturnType<typeof prisma.timetableEntry.findMany>>);

    const def = findAction(UserRole.STUDENT, 'view_today_schedule');
    const result = await def!.handler({}, studentScope);

    expect(result.answer).toMatch(/Today/);
    expect(result.answer).toMatch(/English/);
    expect(prisma.timetableEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classId: 'class-1', dayOfWeek: day }),
      }),
    );
  });

  it('view_today_schedule explains school closures without listing timetable slots', async () => {
    vi.mocked(prisma.schoolClosure.findUnique).mockResolvedValue({
      id: 'closure-1',
      date: '2026-06-03',
      title: 'Midterm break',
      reason: 'School calendar pause',
    });

    const def = findAction(UserRole.STUDENT, 'view_today_schedule');
    const result = await def!.handler({}, studentScope);

    expect(result.answer).toMatch(/School is closed/i);
    expect(result.answer).toMatch(/Midterm break/);
    expect(prisma.timetableEntry.findMany).not.toHaveBeenCalled();
  });
});
