import { Router, type Request, type Response } from 'express';
import { UserRole } from '@sams/shared';
import { requirePermission } from '../middleware/rbac';
import { riskService } from '../services/riskService';
import { AppError } from '../middleware/errors';
import { prisma } from '../lib/prisma';

// ─── Router ───────────────────────────────────────────────────────────────────

export const riskScoresRouter = Router();

async function getTeacherClassIds(req: Request): Promise<string[]> {
  const classIds = new Set<string>();
  if (req.user.classId) classIds.add(req.user.classId);

  const [ownedClasses, timetableClasses] = await Promise.all([
    prisma.class.findMany({
      where: { schoolId: req.schoolId, classTeacherId: req.user.sub },
      select: { id: true },
    }),
    prisma.timetableEntry.findMany({
      where: { schoolId: req.schoolId, teacherId: req.user.sub },
      select: { classId: true },
      distinct: ['classId'],
    }),
  ]);

  ownedClasses.forEach((cls) => classIds.add(cls.id));
  timetableClasses.forEach((entry) => classIds.add(entry.classId));
  return [...classIds];
}

/**
 * GET /api/v1/risk-scores/me
 * Get the authenticated student's own risk score.
 * Only accessible to STUDENT role.
 */
riskScoresRouter.get('/me', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== UserRole.STUDENT) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }
  try {
    const score = await riskService.computeRiskScore(req.schoolId, req.user.sub);
    res.status(200).json(score);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
      return;
    }
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get risk score');
  }
});

/**
 * GET /api/v1/risk-scores
 * List risk scores scoped to the requesting user's permitted scope.
 * - School Admin: all scores for the school (optionally filtered by departmentId query param)
 * - HOD: automatically scoped to the HOD's department
 * - Teacher: students in classes they teach or class-teach
 * Requirement 11.3
 */
riskScoresRouter.get('/', requirePermission('view:risk'), async (req: Request, res: Response): Promise<void> => {
  try {
    let departmentId = req.query.departmentId as string | undefined;
    let classIds: string[] | undefined;

    // HOD users are automatically scoped to their own department
    if (req.user.role === UserRole.HOD) {
      departmentId = req.user.departmentId;
    } else if (req.user.role === UserRole.TEACHER) {
      classIds = await getTeacherClassIds(req);
    }

    const scores = await riskService.getRiskScores(req.schoolId, departmentId, classIds);
    res.status(200).json(scores);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get risk scores');
  }
});

/**
 * GET /api/v1/risk-scores/:studentId
 * Get or compute risk score for a specific student.
 * Enforces school scoping via RiskService (returns 403 if student belongs to another school).
 * Requirement 11.3
 */
riskScoresRouter.get('/:studentId', requirePermission('view:risk'), async (req: Request, res: Response): Promise<void> => {
  try {
    const studentId = req.params.studentId as string;

    if (req.user.role === UserRole.STUDENT && studentId !== req.user.sub) {
      throw new AppError(403, 'FORBIDDEN', 'Students can only view their own risk score');
    }

    if (req.user.role === UserRole.HOD) {
      const student = await prisma.user.findUnique({
        where: { id: studentId },
        select: {
          schoolId: true,
          departmentId: true,
          class: { select: { departmentId: true } },
        },
      });
      const studentDepartmentId = student?.departmentId ?? student?.class?.departmentId;
      if (!student || student.schoolId !== req.schoolId || studentDepartmentId !== req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only view risk scores for their department');
      }
    }

    if (req.user.role === UserRole.TEACHER) {
      const classIds = await getTeacherClassIds(req);
      const student = await prisma.user.findUnique({
        where: { id: studentId },
        select: { schoolId: true, classId: true },
      });
      if (!student || student.schoolId !== req.schoolId || !student.classId || !classIds.includes(student.classId)) {
        throw new AppError(403, 'FORBIDDEN', 'Teachers can only view risk scores for their students');
      }
    }

    const score = await riskService.computeRiskScore(req.schoolId, studentId);
    res.status(200).json(score);
  } catch (err) {
    if (err instanceof AppError) {
      // Surface known errors (404 student not found, 403 forbidden) properly
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        requestId: req.id,
      });
      return;
    }
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get risk score');
  }
});
