import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@sams/shared';
import { prisma } from '../lib/prisma';
import { requirePermission, requireHODScope } from '../middleware/rbac';
import { timetableService } from '../services/timetableService';
import { timetableGeneratorService } from '../services/timetableGeneratorService';
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

const generateTimetableSchema = z.object({
  classIds: z.array(z.string()).min(1).max(100).optional(),
  remake: z.boolean().optional().default(false),
  periodDuration: z.number().int().min(30).max(180).optional().default(40),
  startHour: z.number().int().min(6).max(10).optional().default(8),
  breakStart: z.string().regex(/^\d{2}:\d{2}$/).optional().default('10:00'),
  breakEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().default('10:20'),
  lunchStart: z.string().regex(/^\d{2}:\d{2}$/).optional().default('12:20'),
  lunchEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().default('13:00'),
  workingDays: z.array(z.number().int().min(0).max(6)).optional(),
  maxLessonsPerTeacherPerDay: z.number().int().min(3).max(10).optional().default(6),
  minFreePeriodsPerDay: z.number().int().min(0).max(6).optional().default(0),
  maxFreePeriodsPerDay: z.number().int().min(0).max(6).optional().default(2),
  rooms: z.array(z.string()).optional().default([]),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const timetableRouter = Router();

/**
 * GET /api/v1/timetable
 * List timetable entries scoped to the school.
 */
timetableRouter.get('/', requirePermission('view:timetable'), async (req: Request, res: Response): Promise<void> => {
  try {
    const filters: {
      classId?: string;
      teacherId?: string;
      dayOfWeek?: number;
      departmentId?: string;
    } = {
      classId: req.query.classId as string | undefined,
      teacherId: req.query.teacherId as string | undefined,
      dayOfWeek: req.query.dayOfWeek !== undefined ? Number(req.query.dayOfWeek) : undefined,
    };

    if (req.user.role === UserRole.TEACHER) {
      filters.teacherId = req.user.sub;
    }

    if (req.user.role === UserRole.STUDENT) {
      let studentClassId = req.user.classId;
      if (!studentClassId) {
        const student = await prisma.user.findUnique({
          where: { id: req.user.sub },
          select: { classId: true, schoolId: true },
        });
        if (student?.schoolId === req.schoolId) {
          studentClassId = student.classId ?? undefined;
        }
      }

      if (!studentClassId) {
        res.status(200).json([]);
        return;
      }

      filters.classId = studentClassId;
      filters.teacherId = undefined;
    }

    if (req.user.role === UserRole.HOD) {
      let hodDepartmentId = req.user.departmentId;
      if (!hodDepartmentId) {
        const hod = await prisma.user.findUnique({
          where: { id: req.user.sub },
          select: { departmentId: true, schoolId: true },
        });
        if (hod?.schoolId === req.schoolId) {
          hodDepartmentId = hod.departmentId ?? undefined;
        }
      }
      if (hodDepartmentId) {
        filters.departmentId = hodDepartmentId;
      } else {
        res.status(200).json([]);
        return;
      }
    }

    const entries = await timetableService.listEntries(req.schoolId, filters);
    res.status(200).json(entries);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list timetable entries');
  }
});

/**
 * GET /api/v1/timetable/generator-info
 * Returns the data needed to configure auto-generation (classes, teachers, subjects, existing counts).
 */
timetableRouter.get('/generator-info', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolId = req.schoolId;
    let departmentId: string | undefined;

    if (req.user.role === UserRole.HOD) {
      departmentId = req.user.departmentId;
      if (!departmentId) {
        const hod = await prisma.user.findUnique({
          where: { id: req.user.sub },
          select: { departmentId: true },
        });
        departmentId = hod?.departmentId ?? undefined;
      }
      if (!departmentId) {
        res.status(200).json({ classes: [], teachers: [], subjects: [], existingEntryCount: 0 });
        return;
      }
    }

    const classWhere: Record<string, unknown> = { schoolId };
    if (departmentId) classWhere.departmentId = departmentId;

    const classes = await prisma.class.findMany({
      where: classWhere,
      select: { id: true, name: true, departmentId: true },
      orderBy: { name: 'asc' },
    });

    const teachers = await prisma.user.findMany({
      where: {
        schoolId,
        role: { in: [UserRole.TEACHER, UserRole.HOD] },
        ...(departmentId ? { departmentId } : {}),
      },
      select: { id: true, fullName: true, departmentId: true },
      orderBy: { fullName: 'asc' },
    });

    // Primary source: TeacherSubject registrations. Fallback to timetable history.
    const teacherSubjectRows = await prisma.teacherSubject.findMany({
      where: { schoolId },
      select: { subject: true },
      distinct: ['subject'],
    });
    let subjects = teacherSubjectRows.map((r) => r.subject).filter(Boolean);
    if (subjects.length === 0) {
      const timetableRows = await prisma.timetableEntry.findMany({
        where: { schoolId, ...(departmentId ? { class: { departmentId } } : {}) },
        select: { subject: true },
        distinct: ['subject'],
      });
      subjects = timetableRows.map((r) => r.subject).filter(Boolean);
    }

    const existingEntryCount = await prisma.timetableEntry.count({
      where: { schoolId, ...(departmentId ? { class: { departmentId } } : {}) },
    });

    res.status(200).json({ classes, teachers, subjects, existingEntryCount });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get generator info');
  }
});

/**
 * POST /api/v1/timetable/generate-preview
 * Dry-run the generator: returns the full generated timetable WITHOUT saving to DB.
 * User reviews the preview, then confirms with POST /generate to save.
 */
timetableRouter.post('/generate-preview', requirePermission('manage:timetable'), requireHODScope, async (req: Request, res: Response): Promise<void> => {
  const parsed = generateTimetableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const schoolId = req.schoolId;
    let departmentId: string | undefined;

    if (req.user.role === UserRole.HOD) {
      departmentId = req.user.departmentId;
      if (!departmentId) {
        const hod = await prisma.user.findUnique({
          where: { id: req.user.sub },
          select: { departmentId: true },
        });
        departmentId = hod?.departmentId ?? undefined;
      }
      if (!departmentId) {
        res.status(400).json({ error: 'HOD account not linked to a department', code: 'MISSING_DEPARTMENT' });
        return;
      }
    }

    const result = await timetableGeneratorService.generatePreview({
      schoolId,
      departmentId,
      classIds: parsed.data.classIds,
      periodDuration: parsed.data.periodDuration,
      startHour: parsed.data.startHour,
      breakStart: parsed.data.breakStart,
      breakEnd: parsed.data.breakEnd,
      lunchStart: parsed.data.lunchStart,
      lunchEnd: parsed.data.lunchEnd,
      workingDays: parsed.data.workingDays,
      maxLessonsPerTeacherPerDay: parsed.data.maxLessonsPerTeacherPerDay,
      minFreePeriodsPerDay: parsed.data.minFreePeriodsPerDay,
      maxFreePeriodsPerDay: parsed.data.maxFreePeriodsPerDay,
      rooms: parsed.data.rooms,
    });

    res.status(200).json(result);
  } catch (err) {
    console.error('[Timetable/GeneratePreview] Error:', err);
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', (err as Error).message || 'Failed to generate timetable preview');
  }
});

/**
 * POST /api/v1/timetable/generate
 * Auto-generate timetable entries using the constraint-based algorithm.
 * Only HODs and Super Admin can use this.
 */
timetableRouter.post('/generate', requirePermission('manage:timetable'), requireHODScope, async (req: Request, res: Response): Promise<void> => {
  const parsed = generateTimetableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const schoolId = req.schoolId;
    let departmentId: string | undefined;

    if (req.user.role === UserRole.HOD) {
      departmentId = req.user.departmentId;
      if (!departmentId) {
        const hod = await prisma.user.findUnique({
          where: { id: req.user.sub },
          select: { departmentId: true },
        });
        departmentId = hod?.departmentId ?? undefined;
      }
      if (!departmentId) {
        res.status(400).json({ error: 'HOD account not linked to a department', code: 'MISSING_DEPARTMENT' });
        return;
      }
    }

    const result = await timetableGeneratorService.generate({
      schoolId,
      departmentId,
      classIds: parsed.data.classIds,
      remake: parsed.data.remake,
      periodDuration: parsed.data.periodDuration,
      startHour: parsed.data.startHour,
      breakStart: parsed.data.breakStart,
      breakEnd: parsed.data.breakEnd,
      lunchStart: parsed.data.lunchStart,
      lunchEnd: parsed.data.lunchEnd,
      workingDays: parsed.data.workingDays,
      maxLessonsPerTeacherPerDay: parsed.data.maxLessonsPerTeacherPerDay,
      minFreePeriodsPerDay: parsed.data.minFreePeriodsPerDay,
      maxFreePeriodsPerDay: parsed.data.maxFreePeriodsPerDay,
      rooms: parsed.data.rooms,
    });

    res.status(200).json(result);
  } catch (err) {
    console.error('[Timetable/Generate] Error:', err);
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', (err as Error).message || 'Failed to generate timetable');
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
