import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { authenticate } from '../middleware/auth';
import { UserRole } from '@prisma/client';
import { resolveTeacherTeachingClassIds } from '../lib/teacherScope';
import { computeSubjectFinalScore } from '../lib/examScore';
import { riskService } from '../services/riskService';

export const examsRouter = Router();

// All routes require authentication
examsRouter.use(authenticate);

// ─── Helper: Extract string param safely ──────────────────────────────────────

const param = (req: Request, name: string): string => {
  const v = req.params[name];
  if (Array.isArray(v)) return v[0];
  return v ?? '';
};

// ─── Helper: HOD scope filter ────────────────────────────────────────────────
// Returns an extra WHERE clause so HOD users only see their own department's data.
// School admin sees everything. Teachers/Marks-access uses same filter.

function hodScopeFilter(req: Request, userRole: string, departmentId?: string): Record<string, unknown> {
  if (userRole === 'HOD' && departmentId) {
    return { class: { departmentId } };
  }
  return {};
}

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

const examTypeSchema = z.enum(['CAT1', 'CAT2', 'CAT3', 'PRACTICAL1', 'PRACTICAL2', 'PRACTICAL3', 'END_TERM']);

const createExamSchema = z.object({
  termId: z.string().min(1),
  classId: z.string().min(1),
  subject: z.string().min(1).max(100),
  examType: examTypeSchema,
  maxScore: z.number().int().positive(),
  weight: z.number().positive().optional().default(1),
  date: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

const updateExamSchema = z.object({
  termId: z.string().min(1).optional(),
  classId: z.string().min(1).optional(),
  subject: z.string().min(1).max(100).optional(),
  examType: examTypeSchema.optional(),
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

async function resolveExamForScope(schoolId: string, examId: string) {
  return prisma.exam.findFirst({
    where: { id: examId, schoolId },
    include: { class: { select: { id: true, departmentId: true } } },
  });
}

async function assertCanPlanExam(req: Request, classDepartmentId: string): Promise<void> {
  if (req.user.role !== 'HOD') {
    throw new AppError(403, 'FORBIDDEN', 'Exam plans are managed by HODs. School admins can follow reports and grade policy.');
  }
  if (!req.user.departmentId || classDepartmentId !== req.user.departmentId) {
    throw new AppError(403, 'FORBIDDEN', 'HODs can only manage exam plans in their own department');
  }
}

async function assertCanEnterExamResults(req: Request, exam: { classId: string; class: { departmentId: string } }): Promise<void> {
  if (req.user.role === 'HOD') {
    if (!req.user.departmentId || exam.class.departmentId !== req.user.departmentId) {
      throw new AppError(403, 'FORBIDDEN', 'HODs can only enter marks for their own department');
    }
    return;
  }

  if (req.user.role === 'TEACHER') {
    const classIds = await resolveTeacherTeachingClassIds(req.user.sub, req.user.classId);
    if (classIds.includes(exam.classId)) return;
    throw new AppError(403, 'FORBIDDEN', 'Teachers can only enter marks for classes they teach');
  }

  throw new AppError(403, 'FORBIDDEN', 'Only HODs and assigned teachers can enter marks');
}

async function assertCanViewExamResults(req: Request, exam: { classId: string; class: { departmentId: string } }): Promise<void> {
  if (req.user.role === 'SCHOOL_ADMIN') return;
  await assertCanEnterExamResults(req, exam);
}

async function assertCanViewReportCard(
  req: Request,
  student: { id: string; schoolId: string; classId: string | null; departmentId: string | null; class?: { departmentId: string } | null },
): Promise<void> {
  if (student.schoolId !== req.user.schoolId) {
    throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
  }

  if (req.user.role === 'SCHOOL_ADMIN') return;
  if (req.user.role === 'STUDENT' && req.user.sub === student.id) return;

  if (req.user.role === 'GUARDIAN') {
    const link = await prisma.guardian.findUnique({
      where: { guardianId_studentId: { guardianId: req.user.sub, studentId: student.id } },
      select: { id: true, schoolId: true },
    });
    if (link?.schoolId === req.user.schoolId) return;
    throw new AppError(403, 'FORBIDDEN', 'Guardians can only view linked children');
  }

  if (req.user.role === 'HOD') {
    const deptId = student.class?.departmentId ?? student.departmentId;
    if (req.user.departmentId && deptId === req.user.departmentId) return;
    throw new AppError(403, 'FORBIDDEN', 'HODs can only view report cards in their department');
  }

  if (req.user.role === 'TEACHER') {
    const classIds = await resolveTeacherTeachingClassIds(req.user.sub, req.user.classId);
    if (student.classId && classIds.includes(student.classId)) return;
    throw new AppError(403, 'FORBIDDEN', 'Teachers can only view report cards for classes they teach');
  }

  throw new AppError(403, 'FORBIDDEN', 'Report-card access denied');
}

function roundReportScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildExamComponentMap(components: Array<{ examType: string; score: number; maxScore: number }>) {
  const result: Record<string, { score: number; maxScore: number; percentage: number }> = {};
  for (const component of components) {
    const percentage = component.maxScore > 0 ? (component.score / component.maxScore) * 100 : 0;
    result[component.examType] = {
      score: roundReportScore(component.score),
      maxScore: roundReportScore(component.maxScore),
      percentage: roundReportScore(Math.max(0, Math.min(100, percentage))),
    };
  }
  return result;
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

// ─── 2. POST /terms — Create AcademicTerm (SCHOOL_ADMIN only) ────────────────

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

// ─── 3. PATCH /terms/:id — Update AcademicTerm (SCHOOL_ADMIN only) ───────────

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

// ─── 4. DELETE /terms/:id — Delete AcademicTerm (SCHOOL_ADMIN only) ──────────

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

// ─── 5. GET / — List Exams (HOD sees only their dept, SCHOOL_ADMIN sees all) ──

examsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const termId = typeof req.query.termId === 'string' ? req.query.termId : undefined;
    const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
    const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;

    const where: Record<string, unknown> = { schoolId: req.user.schoolId };

    if (termId) where.termId = termId;
    if (subject) where.subject = subject;

    if (req.user.role === 'HOD') {
      const scope = hodScopeFilter(req, req.user.role, req.user.departmentId);
      if (scope.class) where.class = scope.class;
      if (classId) where.classId = classId;
    } else if (req.user.role === 'TEACHER') {
      const classIds = await resolveTeacherTeachingClassIds(req.user.sub, req.user.classId);
      if (classId && !classIds.includes(classId)) {
        res.status(200).json([]);
        return;
      }
      where.classId = classId ?? { in: classIds };
    } else if (req.user.role === 'STUDENT') {
      if (!req.user.classId || (classId && classId !== req.user.classId)) {
        res.status(200).json([]);
        return;
      }
      where.classId = req.user.classId;
    } else if (req.user.role !== 'SCHOOL_ADMIN') {
      res.status(200).json([]);
      return;
    } else if (classId) {
      where.classId = classId;
    }

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

// ─── 6. POST / — Create Exam (HOD → their dept, SCHOOL_ADMIN → any) ──────────

examsRouter.post('/', requireRole('HOD'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    await assertCanPlanExam(req, cls.departmentId);

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
      include: { class: { select: { departmentId: true } } },
    });

    if (!existing) throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');

    await assertCanPlanExam(req, existing.class.departmentId);

    const { termId, classId, subject, examType, maxScore, weight, date } = parsed.data;

    if (termId) {
      const term = await prisma.academicTerm.findFirst({ where: { id: termId, schoolId: req.user.schoolId } });
      if (!term) throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }
    if (classId) {
      const cls = await prisma.class.findFirst({ where: { id: classId, schoolId: req.user.schoolId } });
      if (!cls) throw new AppError(404, 'CLASS_NOT_FOUND', 'Class not found');
      await assertCanPlanExam(req, cls.departmentId);
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
      include: { class: { select: { departmentId: true } } },
    });

    if (!existing) throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');

    await assertCanPlanExam(req, existing.class.departmentId);

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
    const exam = await resolveExamForScope(req.user.schoolId, id);

    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');
    await assertCanEnterExamResults(req, exam);

    const { results } = parsed.data;
    const uniqueStudentIds = [...new Set(results.map((r) => r.studentId))];
    const validStudents = await prisma.user.findMany({
      where: {
        schoolId: req.user.schoolId,
        classId: exam.classId,
        role: UserRole.STUDENT,
        id: { in: uniqueStudentIds },
      },
      select: { id: true },
    });
    const validStudentIds = new Set(validStudents.map((student) => student.id));

    for (const result of results) {
      if (!validStudentIds.has(result.studentId)) {
        throw new AppError(400, 'STUDENT_NOT_IN_CLASS', 'All marks must belong to students in the exam class');
      }
      if (result.score < 0 || result.score > exam.maxScore) {
        throw new AppError(400, 'INVALID_SCORE', `Scores must be between 0 and ${exam.maxScore}`);
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const result of results) {
        await tx.examResult.upsert({
          where: { examId_studentId: { examId: id, studentId: result.studentId } },
          update: {
            score: result.score,
            comment: result.comment ?? null,
          },
          create: {
            examId: id,
            studentId: result.studentId,
            score: result.score,
            comment: result.comment ?? null,
          },
        });
      }
    });

    for (const studentId of uniqueStudentIds) {
      riskService.computeRiskScore(req.user.schoolId, studentId).catch(() => {});
    }

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
    const exam = await resolveExamForScope(req.user.schoolId, id);

    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');
    await assertCanViewExamResults(req, exam);

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

// ─── 12. POST /grade-boundaries (SCHOOL_ADMIN only) ───────────────────────────

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
      include: { class: { select: { departmentId: true } } },
    });
    if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    await assertCanViewReportCard(req, student);

    const exams = await prisma.exam.findMany({
      where: { schoolId, termId, results: { some: { studentId } } },
      include: { results: { where: { studentId } } },
    });

    if (exams.length === 0) {
      res.status(200).json({ subjects: [], totalPoints: 0, subjectCount: 0, meanGrade: null });
      return;
    }

    const subjectMap = new Map<string, Array<{ examType: string; score: number; maxScore: number }>>();

    for (const exam of exams) {
      if (exam.results.length === 0) continue;
      const score = exam.results[0].score;
      let entry = subjectMap.get(exam.subject);
      if (!entry) {
        entry = [];
        subjectMap.set(exam.subject, entry);
      }
      entry.push({ examType: exam.examType, score, maxScore: exam.maxScore });
    }

    const gradeBoundaries = await prisma.gradeBoundary.findMany({ where: { schoolId } });

    const findGrade = (finalScore: number): { grade: string; points: number } | null => {
      for (const gb of gradeBoundaries) {
        if (finalScore >= gb.minScore && finalScore <= gb.maxScore) return { grade: gb.grade, points: gb.points };
      }
      return null;
    };

    const subjectsResult: Array<{
      subject: string;
      components: Record<string, { score: number; maxScore: number; percentage: number }>;
      catAverage: number | null;
      practicalScore: number | null;
      endTermScore: number | null;
      finalScore: number;
      grade: string | null;
      points: number;
    }> = [];
    let totalPoints = 0;
    let subjectCount = 0;

    for (const [subject, entry] of subjectMap) {
      const score = computeSubjectFinalScore(entry);
      const gradeInfo = findGrade(score.finalScore);
      const points = gradeInfo?.points ?? 0;
      subjectsResult.push({
        subject,
        components: buildExamComponentMap(entry),
        catAverage: score.catAverage,
        practicalScore: score.practicalScore,
        endTermScore: score.endTermScore,
        finalScore: score.finalScore,
        grade: gradeInfo?.grade ?? null,
        points,
      });
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
