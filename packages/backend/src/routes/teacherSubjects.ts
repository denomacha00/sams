import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/rbac';
import { AppError } from '../middleware/errors';

const DEFAULT_SUBJECTS = [
  'Mathematics', 'English', 'Kiswahili', 'Biology', 'Chemistry',
  'Physics', 'History', 'Geography', 'CRE', 'Business Studies',
];

export const teacherSubjectsRouter = Router();

/**
 * GET /api/v1/teacher-subjects
 * Returns all teacher-subject mappings for the school, grouped by teacher.
 */
teacherSubjectsRouter.get('/', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.teacherSubject.findMany({
      where: { schoolId: req.schoolId },
      include: { teacher: { select: { id: true, fullName: true, departmentId: true } } },
      orderBy: [{ teacher: { fullName: 'asc' } }, { subject: 'asc' }],
    });

    // Also return all known subjects (from TeacherSubject + timetable entries + defaults)
    const subjectRows = await prisma.timetableEntry.findMany({
      where: { schoolId: req.schoolId },
      select: { subject: true },
      distinct: ['subject'],
    });
    const allSubjects = [...new Set([
      ...rows.map((r) => r.subject),
      ...subjectRows.map((r) => r.subject),
      ...DEFAULT_SUBJECTS,
    ])].sort();

    // Group by teacher
    const byTeacher = new Map<string, { id: string; fullName: string; departmentId: string | null; subjects: string[] }>();
    for (const row of rows) {
      const existing = byTeacher.get(row.teacherId) ?? {
        id: row.teacherId,
        fullName: row.teacher.fullName,
        departmentId: row.teacher.departmentId,
        subjects: [],
      };
      existing.subjects.push(row.subject);
      byTeacher.set(row.teacherId, existing);
    }

    res.json({
      mappings: Array.from(byTeacher.values()),
      allSubjects,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load teacher subjects');
  }
});

/**
 * PUT /api/v1/teacher-subjects/:teacherId
 * Replace all subjects for a teacher (full replace).
 * Body: { subjects: string[] }
 */
const updateSubjectsSchema = z.object({
  subjects: z.array(z.string().min(1).max(200)).max(50),
});

teacherSubjectsRouter.put('/:teacherId', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  const parsed = updateSubjectsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const teacherId = String(req.params.teacherId);

    // Verify teacher belongs to this school
    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { schoolId: true, role: true, departmentId: true },
    });
    if (!teacher || teacher.schoolId !== req.schoolId || (teacher.role !== 'TEACHER' && teacher.role !== 'HOD')) {
      res.status(404).json({ error: 'Teacher not found', code: 'NOT_FOUND' });
      return;
    }

    // HOD scope: can only assign subjects to teachers in their own department
    if (req.user.role === 'HOD' && req.user.departmentId) {
      if (teacher.departmentId !== req.user.departmentId) {
        res.status(403).json({ error: 'Forbidden: HODs can only manage teachers in their own department', code: 'FORBIDDEN' });
        return;
      }
    }

    // Full replace: delete all existing, insert new
    await prisma.$transaction(async (tx) => {
      await tx.teacherSubject.deleteMany({ where: { teacherId } });

      if (parsed.data.subjects.length > 0) {
        await tx.teacherSubject.createMany({
          data: parsed.data.subjects.map((subject) => ({
            schoolId: req.schoolId,
            teacherId,
            subject,
          })),
        });
      }
    });

    const updated = await prisma.teacherSubject.findMany({
      where: { teacherId },
      select: { subject: true },
      orderBy: { subject: 'asc' },
    });

    res.json({ teacherId, subjects: updated.map((r) => r.subject) });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update teacher subjects');
  }
});

/**
 * GET /api/v1/teacher-subjects/:teacherId
 * Get subjects for a specific teacher.
 */
teacherSubjectsRouter.get('/:teacherId', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = String(req.params.teacherId);
    const rows = await prisma.teacherSubject.findMany({
      where: { teacherId, schoolId: req.schoolId },
      select: { subject: true },
      orderBy: { subject: 'asc' },
    });
    res.json({ teacherId, subjects: rows.map((r) => r.subject) });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load teacher subjects');
  }
});
