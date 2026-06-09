import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { SessionService } from './sessionService';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';

vi.mock('../lib/prisma', () => ({
  prisma: {
    timetableEntry: { findFirst: vi.fn() },
    attendanceSession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
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

  it('allows HOD to start a session for a class in their department', async () => {
    const hodId = 'hod-1';
    vi.mocked(prisma.timetableEntry.findFirst).mockResolvedValue({
      ...baseEntry,
      teacherId: 'teacher-2',
    } as never);
    vi.mocked(prisma.attendanceSession.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.attendanceSession.create).mockResolvedValue({
      id: 'session-hod',
      teacherId: hodId,
      timetableEntryId,
      class: { name: 'Form 1A' },
    } as never);

    const session = await service.startSession(
      hodId,
      schoolId,
      timetableEntryId,
      undefined,
      {
        actorRole: UserRole.HOD,
        actorDepartmentId: 'dept-1',
        requireGps: false,
      },
    );

    expect(prisma.timetableEntry.findFirst).toHaveBeenCalledWith({
      where: {
        id: timetableEntryId,
        schoolId,
        class: { departmentId: 'dept-1' },
      },
    });
    expect(prisma.attendanceSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        classId: baseEntry.classId,
        schoolId,
        teacherId: hodId,
        timetableEntryId,
      }),
    }));
    expect(session.id).toBe('session-hod');
  });

  it('requires HOD accounts to be linked to a department before starting sessions', async () => {
    await expect(
      service.startSession(
        'hod-1',
        schoolId,
        timetableEntryId,
        undefined,
        { actorRole: UserRole.HOD, requireGps: false },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'HOD_DEPARTMENT_REQUIRED',
    });
    expect(prisma.timetableEntry.findFirst).not.toHaveBeenCalled();
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

describe('SessionService.expireStaleActiveSessions', () => {
  const service = new SessionService();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00')); // Monday 10:00
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes active sessions after the timetable window plus grace period', async () => {
    vi.mocked(prisma.attendanceSession.findMany).mockResolvedValue([
      {
        id: 'expired-session',
        timetableEntry: { dayOfWeek: 0, startTime: '08:00', endTime: '09:00' },
      },
      {
        id: 'current-session',
        timetableEntry: { dayOfWeek: 0, startTime: '09:30', endTime: '10:30' },
      },
    ] as never);
    vi.mocked(prisma.attendanceSession.updateMany).mockResolvedValue({ count: 1 } as never);

    const expired = await service.expireStaleActiveSessions('school-1');

    expect(expired).toBe(1);
    expect(prisma.attendanceSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['expired-session'] }, isActive: true },
      data: { isActive: false, endedAt: expect.any(Date) },
    });
  });
});
