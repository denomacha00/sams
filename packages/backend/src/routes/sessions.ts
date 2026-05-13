import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { sessionService } from '../services/sessionService';
import { prisma } from '../index';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const startSessionSchema = z.object({
  timetableEntryId: z.string().min(1),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const sessionsRouter = Router();

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
    );
    res.status(201).json(session);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to start session');
  }
});

/**
 * GET /api/v1/sessions
 * List sessions scoped to the school.
 */
sessionsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = { schoolId: req.schoolId };

    if (req.query.classId) {
      where.classId = req.query.classId;
    }
    if (req.query.teacherId) {
      where.teacherId = req.query.teacherId;
    }
    if (req.query.isActive !== undefined) {
      where.isActive = req.query.isActive === 'true';
    }

    const sessions = await prisma.attendanceSession.findMany({ where });
    res.status(200).json(sessions);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list sessions');
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
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    if (session.schoolId !== req.schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    res.status(200).json(session);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get session');
  }
});

/**
 * GET /api/v1/sessions/:id/qr
 * Get the current active QR token for a session.
 */
sessionsRouter.get('/:id/qr', async (req: Request, res: Response): Promise<void> => {
  try {
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
    await sessionService.endSession(req.params.id as string, req.user.sub);
    res.status(200).json({ message: 'Session ended' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to end session');
  }
});
