import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@sams/shared';
import { prisma } from '../lib/prisma';
import { requirePermission, requireHODScope } from '../middleware/rbac';
import { timetableService } from '../services/timetableService';
import { AppError } from '../middleware/errors';

async function assertHODOwnsTimetableEntry(req: Request, entryId: string): Promise<void> {
  if (req.user?.role !== UserRole.HOD || !req.user.departmentId) return;

  const entry = await prisma.timetableEntry.findUnique({
    where: { id: entryId },
    select: { schoolId: true, class: { select: { departmentId: true } } },
  });

  if (!entry || entry.schoolId !== req.schoolId || entry.class.departmentId !== req.user.departmentId) {
    throw new AppError(403, 'FORBIDDEN', 'HODs can only manage timetables for their own department');
  }
}

async function assertHODCanUseTimetableRefs(
  req: Request,
  refs: { classId?: string; teacherId?: string },
): Promise<void> {
  if (req.user?.role !== UserRole.HOD || !req.user.departmentId) return;

  const [cls, teacher] = await Promise.all([
    refs.classId
      ? prisma.class.findUnique({
          where: { id: refs.classId },
          select: { schoolId: true, departmentId: true },
        })
      : null,
    refs.teacherId
      ? prisma.user.findUnique({
          where: { id: refs.teacherId },
          select: { schoolId: true, role: true, departmentId: true },
        })
      : null,
  ]);

  if (refs.classId && (!cls || cls.schoolId !== req.schoolId || cls.departmentId !== req.user.departmentId)) {
    throw new AppError(403, 'FORBIDDEN', 'HODs can only schedule classes in their own department');
  }

  if (
    refs.teacherId &&
    (!teacher ||
      teacher.schoolId !== req.schoolId ||
      (teacher.role !== UserRole.TEACHER && teacher.role !== UserRole.HOD) ||
      teacher.departmentId !== req.user.departmentId)
  ) {
    throw new AppError(403, 'FORBIDDEN', 'HODs can only schedule teachers in their own department');
  }
}

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
timetableRouter.get('/', requirePermission('view:timetable'), async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = {
      classId: req.query.classId as string | undefined,
      teacherId: req.query.teacherId as string | undefined,
      dayOfWeek: req.query.dayOfWeek !== undefined ? Number(req.query.dayOfWeek) : undefined,
      ...(req.user.role === UserRole.HOD && req.user.departmentId
        ? { departmentId: req.user.departmentId }
        : {}),
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
 * HOD scope guard ensures HODs can only create entries for their own department's classes.
 */
timetableRouter.post('/', requirePermission('manage:timetable'), requireHODScope, async (req: Request, res: Response): Promise<void> => {
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
    await assertHODCanUseTimetableRefs(req, {
      classId: parsed.data.classId,
      teacherId: parsed.data.teacherId,
    });
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
 * HOD scope guard ensures HODs can only update entries for their own department's classes.
 */
timetableRouter.put('/:id', requirePermission('manage:timetable'), requireHODScope, async (req: Request, res: Response): Promise<void> => {
  await assertHODOwnsTimetableEntry(req, req.params.id as string);

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
    await assertHODCanUseTimetableRefs(req, {
      classId: parsed.data.classId,
      teacherId: parsed.data.teacherId,
    });
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
 * HOD scope guard ensures HODs can only delete entries for their own department's classes.
 */
timetableRouter.delete('/:id', requirePermission('manage:timetable'), requireHODScope, async (req: Request, res: Response): Promise<void> => {
  try {
    await assertHODOwnsTimetableEntry(req, req.params.id as string);
    await timetableService.deleteEntry(req.schoolId, req.params.id as string);
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete timetable entry');
  }
});
