import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { timetableService } from '../services/timetableService';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createTimetableSchema = z.object({
  classId: z.string().min(1),
  teacherId: z.string().min(1),
  subject: z.string().min(1).max(200),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  room: z.string().max(100).optional(),
});

const updateTimetableSchema = z.object({
  classId: z.string().min(1).optional(),
  teacherId: z.string().min(1).optional(),
  subject: z.string().min(1).max(200).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
  room: z.string().max(100).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const timetableRouter = Router();

/**
 * GET /api/v1/timetable
 * List timetable entries scoped to the school.
 */
timetableRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = {
      classId: req.query.classId as string | undefined,
      teacherId: req.query.teacherId as string | undefined,
      dayOfWeek: req.query.dayOfWeek !== undefined ? Number(req.query.dayOfWeek) : undefined,
    };

    const entries = await timetableService.listEntries(req.schoolId, filters);
    res.status(200).json(entries);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list timetable entries');
  }
});

/**
 * POST /api/v1/timetable
 * Create a new timetable entry.
 */
timetableRouter.post('/', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  const parsed = createTimetableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const entry = await timetableService.createEntry(req.schoolId, parsed.data);
    res.status(201).json(entry);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Timetable] Create error:', err);
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create timetable entry. Make sure the teacher and class exist.');
  }
});

/**
 * PUT /api/v1/timetable/:id
 * Update a timetable entry.
 */
timetableRouter.put('/:id', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  const parsed = updateTimetableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const entry = await timetableService.updateEntry(req.schoolId, req.params.id as string, parsed.data as Parameters<typeof timetableService.updateEntry>[2]);
    res.status(200).json(entry);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update timetable entry');
  }
});

/**
 * DELETE /api/v1/timetable/:id
 * Delete a timetable entry.
 */
timetableRouter.delete('/:id', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  try {
    await timetableService.deleteEntry(req.schoolId, req.params.id as string);
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete timetable entry');
  }
});
