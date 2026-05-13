import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/rbac';
import { riskService } from '../services/riskService';
import { AppError } from '../middleware/errors';

// ─── Router ───────────────────────────────────────────────────────────────────

export const riskScoresRouter = Router();

/**
 * GET /api/v1/risk-scores
 * List risk scores scoped to the school, optionally filtered by department.
 */
riskScoresRouter.get('/', requirePermission('view:risk'), async (req: Request, res: Response): Promise<void> => {
  try {
    const departmentId = req.query.departmentId as string | undefined;
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
