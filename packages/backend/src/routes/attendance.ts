import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { UserRole, AttendanceStatus } from '@sams/shared';
import { requirePermission } from '../middleware/rbac';
import { attendanceService } from '../services/attendanceService';
import { prisma } from '../lib/prisma';
import { getQrSecret } from '../config/secrets';
import { AppError } from '../middleware/errors';
import { isTimetableWindowExpired } from '../lib/sessionWindow';
import { broadcastSessionEnd } from '../sockets/attendanceSocket';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const qrScanSchema = z.object({
  qrToken: z.string().min(1),
  gpsCoords: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
});

const manualSchema = z.object({
  studentId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.nativeEnum(AttendanceStatus),
  note: z.string().max(500).optional(),
});

const biometricSchema = z.object({
  sessionId: z.string().min(1),
  studentId: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const updateRecordSchema = z.object({
  status: z.nativeEnum(AttendanceStatus),
  note: z.string().max(500).optional(),
});

const syncSchema = z.object({
  records: z.array(z.object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    studentId: z.string().min(1),
    status: z.nativeEnum(AttendanceStatus),
    method: z.string().min(1),
    note: z.string().max(500).optional(),
    scannedAt: z.string().min(1),
    synced: z.boolean(),
  })),
});

const linkGenerateSchema = z.object({
  sessionId: z.string().min(1),
  expiryMinutes: z.number().int().min(1).max(60).default(5),
  requireGps: z.boolean().default(true),
  gpsRadiusM: z.number().int().min(10).max(10000).default(100),
});

const linkAttendanceSchema = z.object({
  linkToken: z.string().min(1),
  gpsCoords: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const attendanceRouter = Router();

/**
 * POST /api/v1/attendance/qr
 * Record attendance via QR code scan (student).
 */
attendanceRouter.post('/qr', async (req: Request, res: Response): Promise<void> => {
  const parsed = qrScanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const record = await attendanceService.recordQRScan(
      req.user.sub,
      req.schoolId,
      parsed.data.qrToken,
      parsed.data.gpsCoords ?? { lat: 0, lng: 0 },
    );
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to record QR scan');
  }
});

/**
 * POST /api/v1/attendance/manual
 * Record attendance manually (teacher).
 */
attendanceRouter.post('/manual', requirePermission('mark:attendance'), async (req: Request, res: Response): Promise<void> => {
  const parsed = manualSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const record = await attendanceService.recordManual(
      req.user.sub,
      req.schoolId,
      parsed.data.studentId,
      parsed.data.sessionId,
      parsed.data.status,
      parsed.data.note,
      { actorRole: req.user.role, actorDepartmentId: req.user.departmentId },
    );
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to record manual attendance');
  }
});

/**
 * POST /api/v1/attendance/biometric
 * Record attendance via biometric verification (teacher).
 */
attendanceRouter.post('/biometric', requirePermission('mark:attendance'), async (req: Request, res: Response): Promise<void> => {
  const parsed = biometricSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const record = await attendanceService.recordBiometric(
      req.user.sub,
      req.schoolId,
      parsed.data.sessionId,
      parsed.data.studentId,
      parsed.data.confidence,
      { actorRole: req.user.role, actorDepartmentId: req.user.departmentId },
    );
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to record biometric attendance');
  }
});

/**
 * POST /api/v1/attendance/link/generate
 * Generate a shareable attendance link for an active session (teacher).
 */
attendanceRouter.post('/link/generate', requirePermission('start:session'), async (req: Request, res: Response): Promise<void> => {
  const parsed = linkGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await attendanceService.generateAttendanceLink(
      parsed.data.sessionId,
      req.schoolId,
      req.user.sub,
      parsed.data.expiryMinutes,
      parsed.data.requireGps,
      parsed.data.gpsRadiusM,
      { actorRole: req.user.role, actorDepartmentId: req.user.departmentId },
    );
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to generate attendance link');
  }
});

/**
 * POST /api/v1/attendance/link
 * Record attendance via link token (authenticated student, no special permission).
 */
attendanceRouter.post('/link', async (req: Request, res: Response): Promise<void> => {
  const parsed = linkAttendanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const record = await attendanceService.recordLinkAttendance(
      req.user.sub,
      req.schoolId,
      parsed.data.linkToken,
      parsed.data.gpsCoords ?? { lat: 0, lng: 0 },
    );
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to record link attendance');
  }
});

/**
 * GET /api/v1/attendance/link/:token/info
 * Get link metadata (session subject, class name, teacher) for the attendance page UI.
 */
attendanceRouter.get('/link/:token/info', async (req: Request, res: Response): Promise<void> => {
  const token = req.params.token as string;

  try {
    // Verify the token JWT, extract sessionId
    const QR_SECRET = getQrSecret();

    let payload: { sessionId: string; type?: string; exp?: number; requireGps?: boolean; gpsRadiusM?: number };
    try {
      payload = jwt.verify(token, QR_SECRET) as unknown as { sessionId: string; type?: string; exp?: number; requireGps?: boolean; gpsRadiusM?: number };
    } catch {
      res.status(200).json({ valid: false, error: 'INVALID' });
      return;
    }

    // Validate token type
    if (payload.type !== 'LINK') {
      res.status(200).json({ valid: false, error: 'INVALID' });
      return;
    }

    // Fetch session with class and teacher info
    const session = await prisma.attendanceSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        class: true,
        teacher: { select: { fullName: true } },
        timetableEntry: { select: { dayOfWeek: true, startTime: true, endTime: true } },
      },
    });

    if (!session) {
      res.status(200).json({ valid: false, error: 'INVALID' });
      return;
    }

    if (req.schoolId && session.schoolId !== req.schoolId) {
      res.status(200).json({ valid: false, error: 'INVALID' });
      return;
    }

    if (
      !session.isActive ||
      (session.timetableEntry && isTimetableWindowExpired(session.timetableEntry))
    ) {
      if (session.isActive) {
        await prisma.attendanceSession.update({
          where: { id: session.id },
          data: { isActive: false, endedAt: new Date() },
        });
        broadcastSessionEnd(session.id);
      }
      res.status(200).json({ valid: false, error: 'SESSION_ENDED' });
      return;
    }

    if (session.currentLinkToken !== token) {
      res.status(200).json({ valid: false, error: 'REVOKED' });
      return;
    }

    // Return session info
    const expiresAt = payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined;

    res.status(200).json({
      valid: true,
      sessionId: session.id,
      subject: session.subject,
      className: session.class?.name ?? null,
      teacherName: session.teacher?.fullName ?? null,
      expiresAt,
      requireGps: payload.requireGps ?? true,
      gpsRadiusM: payload.gpsRadiusM ?? 100,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get link info');
  }
});

/**
 * PUT /api/v1/attendance/:id
 * Update an existing attendance record.
 */
attendanceRouter.put('/:id', requirePermission('mark:attendance'), async (req: Request, res: Response): Promise<void> => {
  const parsed = updateRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const record = await attendanceService.updateRecord(
      req.user.sub,
      req.schoolId,
      req.params.id as string,
      parsed.data.status,
      parsed.data.note,
      { actorRole: req.user.role, actorDepartmentId: req.user.departmentId },
    );
    res.status(200).json(record);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update attendance record');
  }
});

/**
 * POST /api/v1/attendance/sync
 * Sync offline attendance records.
 * Only teachers, HODs, and admins can sync — students cannot forge records.
 */
attendanceRouter.post('/sync', requirePermission('mark:attendance'), async (req: Request, res: Response): Promise<void> => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await attendanceService.syncOfflineRecords(
      req.schoolId,
      req.user.sub,
      parsed.data.records,
      { actorRole: req.user.role, actorDepartmentId: req.user.departmentId },
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to sync offline records');
  }
});

/**
 * GET /api/v1/attendance
 * List attendance records scoped to school/class/student based on role.
 */
attendanceRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = { schoolId: req.schoolId };

    // Scope based on role
    if (req.user.role === UserRole.STUDENT) {
      // Students can only see their own records — always enforce this
      where.studentId = req.user.sub;
    } else if (req.user.role === UserRole.TEACHER) {
      // Teachers can only see records from sessions they own.
      // A sessionId filter is required — without it we scope to their sessions only.
      if (req.query.sessionId) {
        // Verify the session belongs to this teacher before returning records
        const session = await prisma.attendanceSession.findFirst({
          where: { id: req.query.sessionId as string, teacherId: req.user.sub, schoolId: req.schoolId },
          select: { id: true },
        });
        if (!session) {
          // Session not found or doesn't belong to this teacher — return empty
          res.status(200).json([]);
          return;
        }
        where.sessionId = req.query.sessionId;
      } else {
        // No sessionId provided — scope to all sessions owned by this teacher
        const teacherSessions = await prisma.attendanceSession.findMany({
          where: { teacherId: req.user.sub, schoolId: req.schoolId },
          select: { id: true },
        });
        const sessionIds = teacherSessions.map((s) => s.id);
        if (sessionIds.length === 0) {
          res.status(200).json([]);
          return;
        }
        where.sessionId = { in: sessionIds };
      }
    } else if (req.user.role === UserRole.HOD) {
      if (!req.user.departmentId) {
        res.status(200).json([]);
        return;
      }

      if (req.query.sessionId) {
        const session = await prisma.attendanceSession.findFirst({
          where: {
            id: req.query.sessionId as string,
            schoolId: req.schoolId,
            class: { departmentId: req.user.departmentId },
          },
          select: { id: true },
        });
        if (!session) {
          res.status(200).json([]);
          return;
        }
        where.sessionId = req.query.sessionId;
      } else {
      const classes = await prisma.class.findMany({
        where: { schoolId: req.schoolId, departmentId: req.user.departmentId },
        select: { id: true },
      });
      const classIds = classes.map((c) => c.id);
      if (classIds.length === 0) {
        res.status(200).json([]);
        return;
      }
      const sessions = await prisma.attendanceSession.findMany({
        where: { schoolId: req.schoolId, classId: { in: classIds } },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      if (sessionIds.length === 0) {
        res.status(200).json([]);
        return;
      }
      where.sessionId = { in: sessionIds };
      }
    }
    // SCHOOL_ADMIN: can filter by studentId, sessionId, status from query params

    // Additional filters from query params (non-student roles only)
    if (req.query.sessionId && req.user.role !== UserRole.TEACHER && req.user.role !== UserRole.HOD) {
      where.sessionId = req.query.sessionId;
    }
    if (req.query.studentId && req.user.role !== UserRole.STUDENT) {
      where.studentId = req.query.studentId;
    }
    if (req.query.status) {
      where.status = req.query.status;
    }

    const records = await prisma.attendanceRecord.findMany({ where });
    res.status(200).json(records);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list attendance records');
  }
});
