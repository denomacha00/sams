import { Router, type Request, type Response } from 'express';
import { UserRole } from '@sams/shared';
import { requirePermission } from '../middleware/rbac';
import { riskService } from '../services/riskService';
import { AppError } from '../middleware/errors';

// ─── Router ───────────────────────────────────────────────────────────────────

export const riskScoresRouter = Router();

/**
 * GET /api/v1/risk-scores
 * List risk scores scoped to the requesting user's permitted scope.
 * - School Admin: all scores for the school (optionally filtered by departmentId query param)
 * - HOD: automatically scoped to the HOD's department
 * Requirement 11.3
 */
riskScoresRouter.get('/', requirePermission('view:risk'), async (req: Request, res: Response): Promise<void> => {
  try {
    let departmentId = req.query.departmentId as string | undefined;

    // HOD users are automatically scoped to their own department
    if (req.user.role === UserRole.HOD) {
      departmentId = req.user.departmentId;
    }

    const scores = await riskService.getRiskScores(req.schoolId, departmentId);
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
    const score = await riskService.computeRiskScore(req.schoolId, req.params.studentId as string);
    res.status(200).json(score);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get risk score');
  }
});
