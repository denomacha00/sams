import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { AttendanceStatus, UserRole } from '@sams/shared';
import { AttendanceService } from './attendanceService';
import { prisma } from '../lib/prisma';

const QR_SECRET = 'test-qr-secret-with-enough-length-for-jwt-signing-ok';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    attendanceSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    attendanceRecord: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock('../config/secrets', () => ({
  getQrSecret: () => QR_SECRET,
}));

vi.mock('../lib/attendanceEvent', () => ({
  buildAttendanceEventPayload: vi.fn(async (record) => ({
    id: record.id,
    studentId: record.studentId,
    studentName: 'Student',
    status: record.status,
    method: record.method,
    scannedAt: record.scannedAt,
  })),
}));

vi.mock('../sockets/attendanceSocket', () => ({
  broadcastAttendanceNew: vi.fn(),
  broadcastAttendanceUpdated: vi.fn(),
  broadcastSessionEnd: vi.fn(),
}));

vi.mock('./riskService', () => ({
  riskService: {
    computeRiskScore: vi.fn(() => Promise.resolve()),
  },
}));

describe('AttendanceService QR/link scan recording', () => {
  const service = new AttendanceService();
  const schoolId = 'school-1';
  const studentId = 'student-1';
  const sessionId = 'session-1';

  const student = {
    id: studentId,
    schoolId,
    role: UserRole.STUDENT,
    classId: 'class-1',
    isLocked: false,
    attendanceGpsExempt: false,
  };

  const baseSession = {
    id: sessionId,
    schoolId,
    classId: 'class-1',
    teacherId: 'teacher-1',
    subject: 'Math',
    startedAt: new Date('2026-06-01T05:00:00.000Z'),
    lateThresholdMin: 15,
    isActive: true,
    locationLat: null,
    locationLng: null,
    locationRadiusM: 100,
    timetableEntry: { dayOfWeek: 0, startTime: '08:00', endTime: '09:00' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.APP_TIMEZONE = 'Africa/Nairobi';
    vi.setSystemTime(new Date('2026-06-01T05:40:00.000Z')); // Monday 08:40 Nairobi
    vi.mocked(prisma.user.findUnique).mockResolvedValue(student as never);
    vi.mocked(prisma.attendanceSession.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceRecord.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.attendanceRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceRecord.createMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.attendanceRecord.create).mockImplementation(async (args) => args.data as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a late QR scan as LATE, not ABSENT, while the lesson window is still open', async () => {
    const qrToken = jwt.sign(
      { sessionId, nonce: 'nonce-1', iat: 0, exp: Math.floor(Date.now() / 1000) + 60 },
      QR_SECRET,
    );
    vi.mocked(prisma.attendanceSession.findUnique).mockResolvedValue(baseSession as never);

    const record = await service.recordQRScan(studentId, schoolId, qrToken, { lat: 0, lng: 0 }, 'device-1');

    expect(record.status).toBe(AttendanceStatus.LATE);
    expect(prisma.attendanceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId,
        studentId,
        status: AttendanceStatus.LATE,
        method: 'QR',
      }),
    });
  });

  it('records a late attendance link scan as LATE, not ABSENT, while the lesson window is still open', async () => {
    const linkToken = jwt.sign(
      {
        sessionId,
        type: 'LINK',
        nonce: 'nonce-1',
        requireGps: false,
        gpsRadiusM: 100,
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      QR_SECRET,
    );
    vi.mocked(prisma.attendanceSession.findUnique).mockResolvedValue({
      ...baseSession,
      currentLinkToken: linkToken,
      linkExpiresAt: new Date(Date.now() + 60_000),
    } as never);

    const record = await service.recordLinkAttendance(studentId, schoolId, linkToken, { lat: 0, lng: 0 }, 'device-1');

    expect(record.status).toBe(AttendanceStatus.LATE);
    expect(prisma.attendanceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId,
        studentId,
        status: AttendanceStatus.LATE,
        method: 'LINK',
      }),
    });
  });

  it('blocks a second mark for the same session even if the student switches QR/link method', async () => {
    const qrToken = jwt.sign(
      { sessionId, nonce: 'nonce-1', iat: 0, exp: Math.floor(Date.now() / 1000) + 60 },
      QR_SECRET,
    );
    vi.mocked(prisma.attendanceSession.findUnique).mockResolvedValue(baseSession as never);
    vi.mocked(prisma.attendanceRecord.findUnique).mockResolvedValue({
      id: 'record-1',
      sessionId,
      studentId,
    } as never);

    await expect(
      service.recordQRScan(studentId, schoolId, qrToken, { lat: 0, lng: 0 }, 'device-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE_SCAN',
    });
    expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
  });
});
