import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionService } from './sessionService';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';

vi.mock('../lib/prisma', () => ({
  prisma: {
    timetableEntry: { findFirst: vi.fn() },
    attendanceSession: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../config/secrets', () => ({
  getQrSecret: () => 'test-qr-secret-with-enough-length-for-jwt-signing-ok',
}));

vi.mock('../sockets/attendanceSocket', () => ({
  broadcastQRRefresh: vi.fn(),
  broadcastSessionEnd: vi.fn(),
}));

describe('SessionService.startSession', () => {
  const service = new SessionService();
  const teacherId = 'teacher-1';
  const schoolId = 'school-1';
  const timetableEntryId = 'entry-1';

  const baseEntry = {
    id: timetableEntryId,
    teacherId,
    schoolId,
    classId: 'class-1',
    subject: 'Math',
    dayOfWeek: 0,
    startTime: '08:00',
    endTime: '09:00',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T08:15:00')); // Monday 08:15
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resumes an existing active session for the same teacher instead of throwing 409', async () => {
    vi.mocked(prisma.timetableEntry.findFirst).mockResolvedValue(baseEntry as never);
    vi.mocked(prisma.attendanceSession.findFirst).mockResolvedValue({
      id: 'session-existing',
      teacherId,
      timetableEntryId,
    } as never);
    vi.mocked(prisma.attendanceSession.findUnique).mockResolvedValue({
      id: 'session-existing',
      teacherId,
      schoolId,
      classId: 'class-1',
      timetableEntryId,
      subject: 'Math',
      currentQRToken: 'qr-existing',
      class: { name: 'Form 1A' },
    } as never);

    const session = await service.startSession(teacherId, schoolId, timetableEntryId);

    expect(session.id).toBe('session-existing');
    expect(prisma.attendanceSession.create).not.toHaveBeenCalled();
  });

  it('throws TIMETABLE_NOT_FOUND when entry is not for this teacher', async () => {
    vi.mocked(prisma.timetableEntry.findFirst).mockResolvedValue(null);

    await expect(
      service.startSession(teacherId, schoolId, timetableEntryId),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'TIMETABLE_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('throws WRONG_DAY when today does not match the entry', async () => {
    vi.mocked(prisma.timetableEntry.findFirst).mockResolvedValue({
      ...baseEntry,
      dayOfWeek: 2, // Wednesday
    } as never);

    await expect(
      service.startSession(teacherId, schoolId, timetableEntryId),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'WRONG_DAY',
    });
  });
});
