import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { UserRole, AttendanceStatus } from '@sams/shared';
import { requirePermission } from '../middleware/rbac';
import { attendanceService } from '../services/attendanceService';
import { prisma } from '../index';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const qrScanSchema = z.object({
  qrToken: z.string().min(1),
  gpsCoords: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
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
});

const linkAttendanceSchema = z.object({
  linkToken: z.string().min(1),
  gpsCoords: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
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
      parsed.data.gpsCoords,
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
      parsed.data.expiryMinutes,
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
      parsed.data.gpsCoords,
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
    const QR_SECRET = process.env.QR_SECRET ?? 'qr-secret-dev';

    let payload: { sessionId: string; type?: string; exp?: number };
    try {
      payload = jwt.verify(token, QR_SECRET) as unknown as { sessionId: string; type?: string; exp?: number };
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
      },
    });

    if (!session) {
      res.status(200).json({ valid: false, error: 'INVALID' });
      return;
    }

    if (!session.isActive) {
      res.status(200).json({ valid: false, error: 'SESSION_ENDED' });
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
 */
attendanceRouter.post('/sync', async (req: Request, res: Response): Promise<void> => {
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
    const result = await attendanceService.syncOfflineRecords(req.schoolId, parsed.data.records);
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
      where.studentId = req.user.sub;
    } else if (req.user.role === UserRole.TEACHER) {
      // Teachers see records from their sessions
      if (req.query.sessionId) {
        where.sessionId = req.query.sessionId;
      }
    }

    // Additional filters from query params
    if (req.query.studentId && req.user.role !== UserRole.STUDENT) {
      where.studentId = req.query.studentId;
    }
    if (req.query.sessionId) {
      where.sessionId = req.query.sessionId;
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
