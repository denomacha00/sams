import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn() },
    timetableEntry: { findMany: vi.fn() },
    notification: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma';
import {
  DAILY_SCHEDULE_NOTIFICATION_TYPE,
  formatDailyScheduleNotificationMessage,
  isStudentDailyScheduleRemindersEnabled,
  runStudentDailyScheduleReminders,
} from './studentScheduleReminders';

describe('studentScheduleReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STUDENT_DAILY_SCHEDULE_REMINDERS;
    process.env.APP_TIMEZONE = 'Africa/Nairobi';
  });

  it('is enabled by default and can be disabled via env', () => {
    expect(isStudentDailyScheduleRemindersEnabled()).toBe(true);
    process.env.STUDENT_DAILY_SCHEDULE_REMINDERS = 'false';
    expect(isStudentDailyScheduleRemindersEnabled()).toBe(false);
  });

  it('formats message with time, subject, and teacher', () => {
    const message = formatDailyScheduleNotificationMessage('Tuesday', [
      { startTime: '08:00', endTime: '08:40', subject: 'Math', teacherName: 'Mr. Otieno' },
    ]);
    expect(message).toContain('Tuesday:');
    expect(message).toContain('08:00–08:40: Math (Mr. Otieno)');
  });

  it('creates one in-app notification per student when class has slots today', async () => {
    const now = new Date('2026-06-02T03:30:00Z'); // Tuesday morning in Nairobi

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'stu-1', schoolId: 'school-1', classId: 'class-1' },
      { id: 'stu-2', schoolId: 'school-1', classId: 'class-1' },
    ] as Awaited<ReturnType<typeof prisma.user.findMany>>);

    vi.mocked(prisma.timetableEntry.findMany).mockResolvedValue([
      {
        startTime: '08:00',
        endTime: '08:40',
        subject: 'Math',
        teacher: { fullName: 'Mr. Otieno' },
      },
    ] as Awaited<ReturnType<typeof prisma.timetableEntry.findMany>>);

    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 2 });

    const result = await runStudentDailyScheduleReminders(now);

    expect(result.sent).toBe(2);
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'stu-1',
          title: "Today's classes",
          type: DAILY_SCHEDULE_NOTIFICATION_TYPE,
          senderId: null,
          message: expect.stringMatching(/Math/),
        }),
        expect.objectContaining({ userId: 'stu-2' }),
      ]),
    });
    expect(prisma.timetableEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classId: 'class-1', dayOfWeek: 1 }), // Tuesday
      }),
    );
  });

  it('skips students who already received today reminder', async () => {
    const now = new Date('2026-06-02T03:30:00Z');

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'stu-1', schoolId: 'school-1', classId: 'class-1' },
    ] as Awaited<ReturnType<typeof prisma.user.findMany>>);

    vi.mocked(prisma.timetableEntry.findMany).mockResolvedValue([
      {
        startTime: '10:00',
        endTime: '10:40',
        subject: 'English',
        teacher: { fullName: 'Ms. Wanjiku' },
      },
    ] as Awaited<ReturnType<typeof prisma.timetableEntry.findMany>>);

    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      { userId: 'stu-1' },
    ] as Awaited<ReturnType<typeof prisma.notification.findMany>>);

    const result = await runStudentDailyScheduleReminders(now);

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    process.env.STUDENT_DAILY_SCHEDULE_REMINDERS = 'false';
    const result = await runStudentDailyScheduleReminders();
    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
