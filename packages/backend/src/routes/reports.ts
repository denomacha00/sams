import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { reportService } from '../services/reportService';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).optional();

const exportSchema = z.object({
  format: z.enum(['pdf', 'excel']),
  type: z.enum(['student', 'class', 'department', 'school']),
  targetId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function parseDateRange(query: Record<string, unknown>) {
  const from = query.from ? new Date(query.from as string) : undefined;
  const to = query.to ? new Date(query.to as string) : undefined;

  if (from && to) {
    return { from, to };
  }
  return undefined;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const reportsRouter = Router();

/**
 * GET /api/v1/reports/student/:id
 * Get student attendance report.
 */
reportsRouter.get('/student/:id', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const dateRange = parseDateRange(req.query as Record<string, unknown>);
    const report = await reportService.getStudentReport(req.schoolId, req.params.id as string, dateRange);
    res.status(200).json(report);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get student report');
  }
});

/**
 * GET /api/v1/reports/class/:classId
 * Get class attendance report.
 */
reportsRouter.get('/class/:classId', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const dateRange = parseDateRange(req.query as Record<string, unknown>);
    const report = await reportService.getClassReport(req.schoolId, req.params.classId as string, dateRange);
    res.status(200).json(report);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get class report');
  }
});

/**
 * GET /api/v1/reports/department/:deptId
 * Get department attendance report.
 */
reportsRouter.get('/department/:deptId', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const dateRange = parseDateRange(req.query as Record<string, unknown>);
    const report = await reportService.getDepartmentReport(req.schoolId, req.params.deptId as string, dateRange);
    res.status(200).json(report);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get department report');
  }
});

/**
 * GET /api/v1/reports/school
 * Get school-wide attendance report.
 */
reportsRouter.get('/school', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const dateRange = parseDateRange(req.query as Record<string, unknown>);
    const report = await reportService.getSchoolReport(req.schoolId, dateRange);
    res.status(200).json(report);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get school report');
  }
});

/**
 * GET /api/v1/reports/export
 * Export a report as PDF or Excel.
 */
reportsRouter.get('/export', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  const parsed = exportSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const { format, type, targetId, from, to } = parsed.data;
    const dateRange = from && to ? { from: new Date(from), to: new Date(to) } : undefined;

    let reportData;
    switch (type) {
      case 'student':
        if (!targetId) throw new AppError(400, 'VALIDATION_ERROR', 'targetId is required for student reports');
        reportData = await reportService.getStudentReport(req.schoolId, targetId, dateRange);
        break;
      case 'class':
        if (!targetId) throw new AppError(400, 'VALIDATION_ERROR', 'targetId is required for class reports');
        reportData = await reportService.getClassReport(req.schoolId, targetId, dateRange);
        break;
      case 'department':
        if (!targetId) throw new AppError(400, 'VALIDATION_ERROR', 'targetId is required for department reports');
        reportData = await reportService.getDepartmentReport(req.schoolId, targetId, dateRange);
        break;
      case 'school':
        reportData = await reportService.getSchoolReport(req.schoolId, dateRange);
        break;
    }

    const buffer = await reportService.exportReport(reportData, format);

    const contentType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const extension = format === 'pdf' ? 'pdf' : 'xlsx';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="report.${extension}"`);
    res.send(buffer);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to export report');
  }
});
