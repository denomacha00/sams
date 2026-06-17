import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { authenticate } from '../middleware/auth';
import { UserRole } from '@prisma/client';

export const examsRouter = Router();

// All routes require authentication
examsRouter.use(authenticate);

// ─── Helper: Extract string param safely ──────────────────────────────────────

const param = (req: Request, name: string): string => {
  const v = req.params[name];
  if (Array.isArray(v)) return v[0];
  return v ?? '';
};

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createTermSchema = z.object({
  name: z.string().min(1).max(100),
  startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  isActive: z.boolean().optional(),
});

const updateTermSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  isActive: z.boolean().optional(),
});

const createExamSchema = z.object({
  termId: z.string().min(1),
  classId: z.string().min(1),
  subject: z.string().min(1).max(100),
  examType: z.string().min(1).max(20),
  maxScore: z.number().int().positive(),
  weight: z.number().positive(),
  date: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

const updateExamSchema = z.object({
  termId: z.string().min(1).optional(),
  classId: z.string().min(1).optional(),
  subject: z.string().min(1).max(100).optional(),
  examType: z.string().min(1).max(20).optional(),
  maxScore: z.number().int().positive().optional(),
  weight: z.number().positive().optional(),
  date: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

const bulkResultsSchema = z.object({
  results: z.array(
    z.object({
      studentId: z.string().min(1),
      score: z.number(),
      comment: z.string().max(500).optional(),
    }),
  ).min(1),
});

const gradeBoundarySchema = z.object({
  grade: z.string().min(1).max(5),
  minScore: z.number().int(),
  maxScore: z.number().int(),
  points: z.number(),
});

// ─── Helper: Role Guard ──────────────────────────────────────────────────────

function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
      return;
    }
    next();
  };
}

// ─── 1. GET /terms — List AcademicTerms ───────────────────────────────────────

examsRouter.get('/terms', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const terms = await prisma.academicTerm.findMany({
      where: { schoolId: req.user.schoolId },
      orderBy: { startDate: 'desc' },
    });
    res.status(200).json(terms);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to list terms'));
  }
});

// ─── 2. POST /terms — Create AcademicTerm ─────────────────────────────────────

examsRouter.post('/terms', requireRole('SCHOOL_ADMIN'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = createTermSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const { isActive, startDate, endDate, name } = parsed.data;

    if (isActive) {
      await prisma.academicTerm.updateMany({
        where: { schoolId: req.user.schoolId, isActive: true },
        data: { isActive: false },
      });
    }

    const term = await prisma.academicTerm.create({
      data: {
        schoolId: req.user.schoolId,
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isActive: isActive ?? false,
      },
    });

    res.status(201).json(term);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to create term'));
  }
});

// ─── 3. PATCH /terms/:id — Update AcademicTerm ────────────────────────────────

examsRouter.patch('/terms/:id', requireRole('SCHOOL_ADMIN'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = updateTermSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const id = param(req, 'id');
    const existing = await prisma.academicTerm.findFirst({
      where: { id, schoolId: req.user.schoolId },
    });

    if (!existing) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const { isActive, startDate, endDate, name } = parsed.data;

    if (isActive) {
      await prisma.academicTerm.updateMany({
        where: { schoolId: req.user.schoolId, id: { not: id }, isActive: true },
        data: { isActive: false },
      });
    }

    const term = await prisma.academicTerm.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: new Date(endDate) }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.status(200).json(term);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to update term'));
  }
});

// ─── 4. DELETE /terms/:id — Delete AcademicTerm ───────────────────────────────

examsRouter.delete('/terms/:id', requireRole('SCHOOL_ADMIN'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.academicTerm.findFirst({
      where: { id, schoolId: req.user.schoolId },
    });

    if (!existing) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const examCount = await prisma.exam.count({
      where: { termId: id },
    });

    if (examCount > 0) {
      throw new AppError(400, 'TERM_HAS_EXAMS', 'Cannot delete term with existing exams. Remove exams first.');
    }

    await prisma.academicTerm.delete({ where: { id } });

    res.status(204).send();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to delete term'));
  }
});

// ─── 5. GET / — List Exams ────────────────────────────────────────────────────

examsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const termId = typeof req.query.termId === 'string' ? req.query.termId : undefined;
    const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
    const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;

    const where: Record<string, unknown> = { schoolId: req.user.schoolId };

    if (termId) where.termId = termId;
    if (classId) where.classId = classId;
    if (subject) where.subject = subject;

    const exams = await prisma.exam.findMany({
      where,
      include: {
        term: { select: { id: true, name: true, isActive: true } },
        class: { select: { id: true, name: true } },
        creator: { select: { id: true, fullName: true } },
        _count: { select: { results: true } },
      },
      orderBy: { date: 'desc' },
    });

    res.status(200).json(exams);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to list exams'));
  }
});

// ─── 6. POST / — Create Exam ──────────────────────────────────────────────────

examsRouter.post('/', requireRole('SCHOOL_ADMIN', 'HOD'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = createExamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const { termId, classId, subject, examType, maxScore, weight, date } = parsed.data;

    const term = await prisma.academicTerm.findFirst({
      where: { id: termId, schoolId: req.user.schoolId },
    });
    if (!term) throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');

    const cls = await prisma.class.findFirst({
      where: { id: classId, schoolId: req.user.schoolId },
    });
    if (!cls) throw new AppError(404, 'CLASS_NOT_FOUND', 'Class not found');

    const exam = await prisma.exam.create({
      data: {
        schoolId: req.user.schoolId,
        termId, classId, subject, examType, maxScore, weight,
        date: new Date(date),
        createdById: req.user.sub,
      },
      include: {
        term: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
        creator: { select: { id: true, fullName: true } },
      },
    });

    res.status(201).json(exam);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to create exam'));
  }
});

// ─── 7. PUT /:id — Update Exam ────────────────────────────────────────────────

examsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = updateExamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const id = param(req, 'id');
    const existing = await prisma.exam.findFirst({
      where: { id, schoolId: req.user.schoolId },
    });

    if (!existing) throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');

    const { termId, classId, subject, examType, maxScore, weight, date } = parsed.data;

    if (termId) {
      const term = await prisma.academicTerm.findFirst({ where: { id: termId, schoolId: req.user.schoolId } });
      if (!term) throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }
    if (classId) {
      const cls = await prisma.class.findFirst({ where: { id: classId, schoolId: req.user.schoolId } });
      if (!cls) throw new AppError(404, 'CLASS_NOT_FOUND', 'Class not found');
    }

    const exam = await prisma.exam.update({
      where: { id },
      data: {
        ...(termId !== undefined && { termId }),
        ...(classId !== undefined && { classId }),
        ...(subject !== undefined && { subject }),
        ...(examType !== undefined && { examType }),
        ...(maxScore !== undefined && { maxScore }),
        ...(weight !== undefined && { weight }),
        ...(date !== undefined && { date: new Date(date) }),
      },
      include: {
        term: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
        creator: { select: { id: true, fullName: true } },
      },
    });

    res.status(200).json(exam);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to update exam'));
  }
});

// ─── 8. DELETE /:id — Delete Exam ─────────────────────────────────────────────

examsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.exam.findFirst({
      where: { id, schoolId: req.user.schoolId },
    });

    if (!existing) throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');

    const resultCount = await prisma.examResult.count({
      where: { examId: id },
    });

    if (resultCount > 0) {
      throw new AppError(400, 'EXAM_HAS_RESULTS', 'Cannot delete exam with existing results. Remove results first.');
    }

    await prisma.exam.delete({ where: { id } });

    res.status(204).send();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to delete exam'));
  }
});

// ─── 9. POST /:id/results — Bulk Upsert Results ───────────────────────────────

examsRouter.post('/:id/results', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = bulkResultsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const id = param(req, 'id');
    const exam = await prisma.exam.findFirst({
      where: { id, schoolId: req.user.schoolId },
    });

    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');

    const { results } = parsed.data;

    await prisma.$transaction(async (tx) => {
      await tx.examResult.createMany({
        data: results.map((r) => ({
          examId: id,
          studentId: r.studentId,
          score: r.score,
          comment: r.comment ?? null,
        })),
        skipDuplicates: true,
      });
    });

    const updatedResults = await prisma.examResult.findMany({
      where: { examId: id },
      include: {
        student: { select: { id: true, fullName: true, admissionNumber: true } },
      },
    });

    res.status(201).json(updatedResults);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to create results'));
  }
});

// ─── 10. GET /:id/results — List Results ──────────────────────────────────────

examsRouter.get('/:id/results', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = param(req, 'id');
    const exam = await prisma.exam.findFirst({
      where: { id, schoolId: req.user.schoolId },
    });

    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');

    const results = await prisma.examResult.findMany({
      where: { examId: id },
      include: {
        student: { select: { id: true, fullName: true, admissionNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.status(200).json(results);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to list results'));
  }
});

// ─── 11. GET /grade-boundaries — List GradeBoundaries ─────────────────────────

examsRouter.get('/grade-boundaries', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const boundaries = await prisma.gradeBoundary.findMany({
      where: { schoolId: req.user.schoolId },
      orderBy: { minScore: 'asc' },
    });
    res.status(200).json(boundaries);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to list grade boundaries'));
  }
});

// ─── 12. POST /grade-boundaries ───────────────────────────────────────────────

examsRouter.post('/grade-boundaries', requireRole('SCHOOL_ADMIN'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = gradeBoundarySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const { grade, minScore, maxScore, points } = parsed.data;
    const boundary = await prisma.gradeBoundary.upsert({
      where: { schoolId_grade: { schoolId: req.user.schoolId, grade } },
      update: { minScore, maxScore, points },
      create: { schoolId: req.user.schoolId, grade, minScore, maxScore, points },
    });
    res.status(200).json(boundary);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to upsert grade boundary'));
  }
});

// ─── 13. GET /report-card/:studentId/:termId ──────────────────────────────────

examsRouter.get('/report-card/:studentId/:termId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const studentId = param(req, 'studentId');
    const termId = param(req, 'termId');
    const schoolId = req.user.schoolId;

    const term = await prisma.academicTerm.findFirst({ where: { id: termId, schoolId } });
    if (!term) throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');

    const student = await prisma.user.findFirst({
      where: { id: studentId, schoolId, role: UserRole.STUDENT },
    });
    if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');

    const exams = await prisma.exam.findMany({
      where: { schoolId, termId, results: { some: { studentId } } },
      include: { results: { where: { studentId } } },
    });

    if (exams.length === 0) {
      res.status(200).json({ subjects: [], totalPoints: 0, subjectCount: 0, meanGrade: null });
      return;
    }

    const subjectMap = new Map<string, { catScores: number[]; endTermScore: number | null }>();

    for (const exam of exams) {
      if (exam.results.length === 0) continue;
      const score = exam.results[0].score;
      let entry = subjectMap.get(exam.subject);
      if (!entry) {
        entry = { catScores: [], endTermScore: null };
        subjectMap.set(exam.subject, entry);
      }
      if (exam.examType.startsWith('CAT')) {
        entry.catScores.push(score);
      } else if (exam.examType === 'END_TERM') {
        entry.endTermScore = score;
      }
    }

    const gradeBoundaries = await prisma.gradeBoundary.findMany({ where: { schoolId } });

    const findGrade = (finalScore: number): { grade: string; points: number } | null => {
      for (const gb of gradeBoundaries) {
        if (finalScore >= gb.minScore && finalScore <= gb.maxScore) return { grade: gb.grade, points: gb.points };
      }
      return null;
    };

    const subjectsResult: Array<{ subject: string; catAverage: number | null; endTermScore: number | null; finalScore: number; grade: string | null; points: number }> = [];
    let totalPoints = 0;
    let subjectCount = 0;

    for (const [subject, entry] of subjectMap) {
      const catAverage = entry.catScores.length > 0 ? entry.catScores.reduce((a, b) => a + b, 0) / entry.catScores.length : null;
      const endTermScore = entry.endTermScore ?? null;
      let finalScore = 0;
      if (catAverage !== null && endTermScore !== null) finalScore = catAverage * 0.3 + endTermScore * 0.7;
      else if (catAverage !== null) finalScore = catAverage;
      else if (endTermScore !== null) finalScore = endTermScore;

      const gradeInfo = findGrade(finalScore);
      const points = gradeInfo?.points ?? 0;
      subjectsResult.push({ subject, catAverage, endTermScore, finalScore: Math.round(finalScore * 100) / 100, grade: gradeInfo?.grade ?? null, points });
      totalPoints += points;
      subjectCount++;
    }

    let meanGrade: string | null = null;
    if (subjectCount > 0) {
      const avgFinalScore = subjectsResult.reduce((sum, s) => sum + s.finalScore, 0) / subjectCount;
      meanGrade = findGrade(avgFinalScore)?.grade ?? null;
    }

    res.status(200).json({ subjects: subjectsResult, totalPoints, subjectCount, meanGrade });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to compute report card'));
  }
});
