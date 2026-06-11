import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AttendanceStatus, UserRole } from '@sams/shared';
import { SessionService } from './sessionService';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';

vi.mock('../lib/prisma', () => ({
  prisma: {
    class: {
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    timetableEntry: { findFirst: vi.fn() },
    attendanceSession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    attendanceRecord: {
      findMany: vi.fn(),
      createMany: vi.fn(),
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
    vi.mocked(prisma.class.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ classId: null } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceRecord.createMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.attendanceSession.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceSession.updateMany).mockResolvedValue({ count: 0 } as never);
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

  it('allows a class teacher to start the current timetable session for their class', async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([{ id: 'class-1' }] as never);
    vi.mocked(prisma.timetableEntry.findFirst).mockResolvedValue({
      ...baseEntry,
      teacherId: 'subject-teacher',
    } as never);
    vi.mocked(prisma.attendanceSession.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.attendanceSession.create).mockResolvedValue({
      id: 'session-class-teacher',
      teacherId,
      timetableEntryId,
      class: { name: 'Form 1A' },
    } as never);

    const session = await service.startSession(
      teacherId,
      schoolId,
      timetableEntryId,
      { lat: 1, lng: 36 },
    );

    expect(prisma.timetableEntry.findFirst).toHaveBeenCalledWith({
      where: {
        id: timetableEntryId,
        schoolId,
        OR: [
          { teacherId },
          { classId: { in: ['class-1'] } },
        ],
      },
    });
    expect(session.id).toBe('session-class-teacher');
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
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceRecord.createMany).mockResolvedValue({ count: 0 } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes active sessions after the timetable window plus grace period', async () => {
    vi.mocked(prisma.attendanceSession.findMany)
      .mockResolvedValueOnce([
      {
        id: 'expired-session',
        timetableEntry: { dayOfWeek: 0, startTime: '08:00', endTime: '09:00' },
      },
      {
        id: 'current-session',
        timetableEntry: { dayOfWeek: 0, startTime: '09:30', endTime: '10:30' },
      },
    ] as never)
      .mockResolvedValueOnce([
        { id: 'expired-session', schoolId: 'school-1', classId: 'class-1' },
      ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'student-present' },
      { id: 'student-missing' },
    ] as never);
    vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([
      { studentId: 'student-present' },
    ] as never);
    vi.mocked(prisma.attendanceRecord.createMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.attendanceSession.updateMany).mockResolvedValue({ count: 1 } as never);

    const expired = await service.expireStaleActiveSessions('school-1');

    expect(expired).toBe(1);
    expect(prisma.attendanceSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['expired-session'] }, isActive: true },
      data: { isActive: false, endedAt: expect.any(Date) },
    });
    expect(prisma.attendanceRecord.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sessionId: 'expired-session',
          studentId: 'student-missing',
          status: AttendanceStatus.ABSENT,
          method: 'AUTO_ABSENT',
        }),
      ],
      skipDuplicates: true,
    });
  });
});

describe('SessionService.refreshQRCode', () => {
  const service = new SessionService();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00')); // Monday 10:00
    vi.mocked(prisma.attendanceSession.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceRecord.createMany).mockResolvedValue({ count: 0 } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends a stale timetable session instead of refreshing its QR token', async () => {
    vi.mocked(prisma.attendanceSession.findUnique).mockResolvedValue({
      id: 'expired-session',
      isActive: true,
      timetableEntry: { dayOfWeek: 0, startTime: '08:00', endTime: '09:00' },
    } as never);
    vi.mocked(prisma.attendanceSession.update).mockResolvedValue({} as never);

    await expect(service.refreshQRCode('expired-session')).rejects.toMatchObject({
      statusCode: 400,
      code: 'SESSION_ENDED',
    });

    expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
      where: { id: 'expired-session' },
      data: { isActive: false, endedAt: expect.any(Date) },
    });
  });
});
