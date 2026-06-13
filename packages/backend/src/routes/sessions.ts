import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@sams/shared';
import { requirePermission } from '../middleware/rbac';
import { sessionService } from '../services/sessionService';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import {
  formatAttendanceRecordsForClient,
  formatSessionForClient,
  formatStudentsForClient,
} from '../lib/sessionResponse';
import { getLocalTimetableClock, minutesFromTime } from '../lib/sessionWindow';
import { resolveTeacherManagedClassIds } from '../lib/teacherScope';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const startSessionSchema = z.object({
  timetableEntryId: z.string().min(1),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
  requireGps: z.boolean().default(false),
  locationRadiusM: z.number().int().min(10).max(10000).default(100),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const sessionsRouter = Router();

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function windowLabel(entry: { startTime: string; endTime: string }, currentMinutes: number, isOpenNow: boolean): string {
  if (isOpenNow) return 'Open now';
  const start = minutesFromTime(entry.startTime);
  const end = minutesFromTime(entry.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Check timetable';
  if (currentMinutes < start) return `Opens at ${entry.startTime}`;
  return `Closed after ${entry.endTime}`;
}

function assertHodHasDepartment(req: Request): string {
  if (req.user.role === UserRole.HOD && !req.user.departmentId) {
    throw new AppError(403, 'HOD_DEPARTMENT_REQUIRED', 'HOD account is not linked to a department');
  }
  return req.user.departmentId as string;
}

function canManageSession(
  req: Request,
  session: { teacherId: string; class?: { departmentId?: string | null } | null },
): boolean {
  if (req.user.role === UserRole.TEACHER) {
    return session.teacherId === req.user.sub;
  }
  if (req.user.role === UserRole.HOD) {
    return !!req.user.departmentId && session.class?.departmentId === req.user.departmentId;
  }
  return true;
}

/**
 * POST /api/v1/sessions
 * Start a new attendance session.
 */
sessionsRouter.post('/', requirePermission('start:session'), async (req: Request, res: Response): Promise<void> => {
  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const session = await sessionService.startSession(
      req.user.sub,
      req.schoolId,
      parsed.data.timetableEntryId,
      parsed.data.location,
      {
        requireGps: parsed.data.requireGps,
        locationRadiusM: parsed.data.locationRadiusM,
        actorRole: req.user.role,
        actorDepartmentId: req.user.departmentId,
      },
    );
    res.status(201).json(formatSessionForClient(session));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to start session');
  }
});

/**
 * GET /api/v1/sessions
 * List sessions scoped to the school.
 * Students cannot list sessions — they scan QR codes directly.
 */
sessionsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // Students cannot enumerate sessions
    if (req.user.role === UserRole.STUDENT) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    await sessionService.expireStaleActiveSessions(req.schoolId);

    const where: Record<string, unknown> = { schoolId: req.schoolId };

    if (req.user.role === UserRole.TEACHER) {
      where.teacherId = req.user.sub;
    } else if (req.user.role === UserRole.HOD) {
      const departmentId = assertHodHasDepartment(req);
      where.class = { departmentId };
      if (req.query.teacherId) {
        where.teacherId = req.query.teacherId;
      }
    }

    if (req.query.classId) {
      where.classId = req.query.classId;
    }
    if (req.query.teacherId && req.user.role !== UserRole.TEACHER && req.user.role !== UserRole.HOD) {
      where.teacherId = req.query.teacherId;
    }
    if (req.query.isActive !== undefined) {
      where.isActive = req.query.isActive === 'true';
    }

    const sessions = await prisma.attendanceSession.findMany({
      where,
      include: {
        class: { select: { name: true } },
        records: {
          include: { student: { select: { fullName: true } } },
          orderBy: { scannedAt: 'desc' },
        },
      },
      orderBy: { startedAt: 'desc' },
    });
    res.status(200).json(
      sessions.map((session) => ({
        ...formatSessionForClient(session),
        records: formatAttendanceRecordsForClient(session.records),
      })),
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list sessions');
  }
});

/**
 * GET /api/v1/sessions/available
 * Server-time timetable windows for the session page.
 * Keeps browser timezone/device clock from hiding a valid class.
 */
sessionsRouter.get('/available', async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.user.role === UserRole.STUDENT) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    await sessionService.expireStaleActiveSessions(req.schoolId);

    const clock = getLocalTimetableClock();
    const where: Record<string, unknown> = {
      schoolId: req.schoolId,
      dayOfWeek: clock.dayOfWeek,
    };

    if (req.user.role === UserRole.TEACHER) {
      const managedClassIds = await resolveTeacherManagedClassIds(req.user.sub, req.user.classId);
      where.OR = [
        { teacherId: req.user.sub },
        ...(managedClassIds.length > 0 ? [{ classId: { in: managedClassIds } }] : []),
      ];
    } else if (req.user.role === UserRole.HOD) {
      // HOD is also a teacher — show only the classes they personally teach on the session start page.
      // Department-wide view is available via reports and timetable management.
      const hodDepartmentId = assertHodHasDepartment(req);
      const managedClassIds = await resolveTeacherManagedClassIds(req.user.sub, req.user.classId);
      where.OR = [
        { teacherId: req.user.sub },
        ...(managedClassIds.length > 0 ? [{ classId: { in: managedClassIds } }] : []),
      ];
      // Still ensure it's within their department in case of mismatched data
      where.class = { departmentId: hodDepartmentId };
    }

    const entries = await prisma.timetableEntry.findMany({
      where,
      include: {
        class: { select: { id: true, name: true, departmentId: true } },
        teacher: { select: { id: true, fullName: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    const activeSessions = await prisma.attendanceSession.findMany({
      where: {
        schoolId: req.schoolId,
        isActive: true,
        timetableEntryId: { in: entries.map((entry) => entry.id) },
      },
      select: {
        id: true,
        timetableEntryId: true,
        _count: { select: { records: true } },
      },
    });
    const activeByEntry = new Map(activeSessions.map((session) => [session.timetableEntryId, session]));

    const mapped = entries.map((entry) => {
      const start = minutesFromTime(entry.startTime);
      const end = minutesFromTime(entry.endTime);
      const isOpenNow = Number.isFinite(start) && Number.isFinite(end) && clock.minutes >= start && clock.minutes <= end;
      const active = activeByEntry.get(entry.id);
      return {
        id: entry.id,
        subject: entry.subject,
        className: entry.class.name,
        class: entry.class,
        teacherId: entry.teacherId,
        teacherName: entry.teacher.fullName,
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        room: entry.room,
        isOpenNow,
        isPast: Number.isFinite(end) && clock.minutes > end,
        windowLabel: windowLabel(entry, clock.minutes, isOpenNow),
        activeSessionId: active?.id ?? null,
        activeRecordCount: active?._count.records ?? 0,
      };
    });

    res.status(200).json({
      today: {
        dayOfWeek: clock.dayOfWeek,
        dayLabel: DAY_LABELS[clock.dayOfWeek] ?? 'Today',
        currentMinutes: clock.minutes,
      },
      entries: mapped,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load available sessions');
  }
});

/**
 * GET /api/v1/sessions/:id
 * Get a single session by ID.
 */
sessionsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await prisma.attendanceSession.findUnique({
      where: { id: req.params.id as string },
      include: {
        class: { select: { name: true, departmentId: true } },
        records: {
          include: { student: { select: { fullName: true } } },
          orderBy: { scannedAt: 'desc' },
        },
      },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    if (session.schoolId !== req.schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    if (req.user.role === UserRole.STUDENT) {
      if (req.user.classId !== session.classId) {
        throw new AppError(403, 'FORBIDDEN', 'Access to this session is not allowed');
      }
      res.status(200).json(formatSessionForClient(session));
      return;
    }

    if (
      (req.user.role === UserRole.TEACHER || req.user.role === UserRole.HOD) &&
      !canManageSession(req, session)
    ) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this attendance session');
    }

    const students = await prisma.user.findMany({
      where: {
        schoolId: req.schoolId,
        classId: session.classId,
        role: UserRole.STUDENT,
        isLocked: false,
      },
      select: { id: true, fullName: true, admissionNumber: true },
      orderBy: { fullName: 'asc' },
    });

    res.status(200).json({
      ...formatSessionForClient(session),
      students: formatStudentsForClient(students),
      records: formatAttendanceRecordsForClient(session.records),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get session');
  }
});

/**
 * GET /api/v1/sessions/:id/qr
 * Get the current active QR token for a session.
 * Only teachers, HODs, and admins can retrieve QR tokens — not students.
 */
sessionsRouter.get('/:id/qr', async (req: Request, res: Response): Promise<void> => {
  try {
    // Students cannot retrieve QR tokens directly
    if (req.user.role === UserRole.STUDENT) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const session = await prisma.attendanceSession.findUnique({
      where: { id: req.params.id as string },
      select: {
        schoolId: true,
        teacherId: true,
        class: { select: { departmentId: true } },
      },
    });
    if (!session || session.schoolId !== req.schoolId) {
      throw new AppError(404, 'QR_NOT_FOUND', 'No active QR code for this session');
    }
    if (
      (req.user.role === UserRole.TEACHER || req.user.role === UserRole.HOD) &&
      !canManageSession(req, session)
    ) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this attendance session');
    }

    const qrToken = await sessionService.getActiveQR(req.params.id as string);

    if (!qrToken) {
      throw new AppError(404, 'QR_NOT_FOUND', 'No active QR code for this session');
    }

    res.status(200).json({ qrToken });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get QR code');
  }
});

/**
 * POST /api/v1/sessions/:id/end
 * End an active session.
 */
sessionsRouter.post('/:id/end', requirePermission('start:session'), async (req: Request, res: Response): Promise<void> => {
  try {
    await sessionService.endSession(req.params.id as string, req.user.sub, {
      actorRole: req.user.role,
      actorDepartmentId: req.user.departmentId,
    });
    res.status(200).json({ message: 'Session ended' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to end session');
  }
});
