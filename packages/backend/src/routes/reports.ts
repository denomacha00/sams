import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@sams/shared';
import { requirePermission } from '../middleware/rbac';
import { reportService } from '../services/reportService';
import { AppError } from '../middleware/errors';
import { prisma } from '../index';

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
 * Role-based scope:
 *   - Students can only view their own report
 *   - Teachers can view reports for students in their assigned class
 *   - HODs can view reports for students in their department
 *   - School Admins can view any student report in their school
 * Requirements: 10.1, 10.7
 */
reportsRouter.get('/student/:id', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, sub: userId, classId: userClassId, departmentId: userDeptId } = req.user;
    const targetStudentId = req.params.id as string;

    // Students can only view their own report
    if (role === UserRole.STUDENT && targetStudentId !== userId) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Students can only view their own report' });
      return;
    }

    // Teachers can only view reports for students in their assigned class
    if (role === UserRole.TEACHER) {
      const student = await prisma.user.findUnique({
        where: { id: targetStudentId },
        select: { classId: true, schoolId: true },
      });
      if (!student || student.schoolId !== req.schoolId) {
        throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
      }
      if (student.classId !== userClassId) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Teachers can only view reports for students in their assigned class' });
        return;
      }
    }

    // HODs can only view reports for students in their department
    if (role === UserRole.HOD) {
      const student = await prisma.user.findUnique({
        where: { id: targetStudentId },
        select: { departmentId: true, schoolId: true },
      });
      if (!student || student.schoolId !== req.schoolId) {
        throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
      }
      if (student.departmentId !== userDeptId) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'HODs can only view reports for students in their department' });
        return;
      }
    }

    const dateRange = parseDateRange(req.query as Record<string, unknown>);
    const report = await reportService.getStudentReport(req.schoolId, targetStudentId, dateRange);
    res.status(200).json(report);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get student report');
  }
});

/**
 * GET /api/v1/reports/class/:classId
 * Get class attendance report.
 * Role-based scope:
 *   - Students cannot access class reports
 *   - Teachers can only view reports for their assigned class
 *   - HODs can view reports for classes in their department
 *   - School Admins can view any class report in their school
 * Requirements: 10.2, 10.7
 */
reportsRouter.get('/class/:classId', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, classId: userClassId, departmentId: userDeptId } = req.user;
    const targetClassId = req.params.classId as string;

    // Students cannot access class reports
    if (role === UserRole.STUDENT) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Students cannot access class reports' });
      return;
    }

    // Teachers can only view reports for their assigned class
    if (role === UserRole.TEACHER && targetClassId !== userClassId) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Teachers can only view reports for their assigned class' });
      return;
    }

    // HODs can only view reports for classes in their department
    if (role === UserRole.HOD) {
      const classData = await prisma.class.findUnique({
        where: { id: targetClassId },
        select: { departmentId: true, schoolId: true },
      });
      if (!classData || classData.schoolId !== req.schoolId) {
        throw new AppError(404, 'CLASS_NOT_FOUND', 'Class not found');
      }
      if (classData.departmentId !== userDeptId) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'HODs can only view reports for classes in their department' });
        return;
      }
    }

    const dateRange = parseDateRange(req.query as Record<string, unknown>);
    const report = await reportService.getClassReport(req.schoolId, targetClassId, dateRange);
    res.status(200).json(report);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get class report');
  }
});

/**
 * GET /api/v1/reports/department/:deptId
 * Get department attendance report.
 * Role-based scope:
 *   - Students and Teachers cannot access department reports
 *   - HODs can only view reports for their own department
 *   - School Admins can view any department report in their school
 * Requirements: 10.3, 10.7
 */
reportsRouter.get('/department/:deptId', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, departmentId: userDeptId } = req.user;
    const targetDeptId = req.params.deptId as string;

    // Students cannot access department reports
    if (role === UserRole.STUDENT) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Students cannot access department reports' });
      return;
    }

    // Teachers cannot access department reports
    if (role === UserRole.TEACHER) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Teachers cannot access department reports' });
      return;
    }

    // HODs can only view reports for their own department
    if (role === UserRole.HOD && targetDeptId !== userDeptId) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'HODs can only view reports for their own department' });
      return;
    }

    const dateRange = parseDateRange(req.query as Record<string, unknown>);
    const report = await reportService.getDepartmentReport(req.schoolId, targetDeptId, dateRange);
    res.status(200).json(report);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get department report');
  }
});

/**
 * GET /api/v1/reports/school
 * Get school-wide attendance report.
 * Role-based scope:
 *   - Only School Admins can access school-wide reports
 * Requirements: 10.4, 10.7
 */
reportsRouter.get('/school', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { role } = req.user;

    // Only School Admins can access school-wide reports
    if (role !== UserRole.SCHOOL_ADMIN && role !== UserRole.SUPER_ADMIN) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Only School Admins can access school-wide reports' });
      return;
    }

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
 * Export a report as PDF or Excel (query-based approach).
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

/**
 * GET /api/v1/reports/:reportId/export
 * Export a report by reportId as PDF or Excel.
 * reportId format: "type:targetId" (e.g., "student:student-1", "class:class-1")
 * For school reports: "school"
 * Role-based scope:
 *   - Students can only export their own student report
 *   - Teachers can export class reports for their assigned class and student reports within it
 *   - HODs can export department reports for their department and class/student reports within it
 *   - School Admins can export any report in their school
 * Requirements: 10.6, 10.7
 */
reportsRouter.get('/:reportId/export', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  const formatParam = req.query.format as string | undefined;
  if (!formatParam || !['pdf', 'excel'].includes(formatParam)) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      message: 'format query parameter must be "pdf" or "excel"',
    });
    return;
  }

  const format = formatParam as 'pdf' | 'excel';

  try {
    const { role, sub: userId, classId: userClassId, departmentId: userDeptId } = req.user;
    const dateRange = parseDateRange(req.query as Record<string, unknown>);
    const reportId = req.params.reportId as string;
    const parts = reportId.split(':');
    const type = parts[0];
    const targetId = parts.length > 1 ? parts.slice(1).join(':') : undefined;

    // Enforce role-based scope on export
    if (role === UserRole.STUDENT) {
      // Students can only export their own student report
      if (type !== 'student' || targetId !== userId) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Students can only export their own report' });
        return;
      }
    }

    if (role === UserRole.TEACHER) {
      // Teachers can export student reports for students in their class, or their class report
      if (type === 'student' && targetId) {
        const student = await prisma.user.findUnique({
          where: { id: targetId },
          select: { classId: true, schoolId: true },
        });
        if (!student || student.schoolId !== req.schoolId || student.classId !== userClassId) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Teachers can only export reports for students in their assigned class' });
          return;
        }
      } else if (type === 'class') {
        if (targetId !== userClassId) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Teachers can only export reports for their assigned class' });
          return;
        }
      } else if (type === 'department' || type === 'school') {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'Teachers cannot export department or school reports' });
        return;
      }
    }

    if (role === UserRole.HOD) {
      // HODs can export student/class reports within their department, or their department report
      if (type === 'student' && targetId) {
        const student = await prisma.user.findUnique({
          where: { id: targetId },
          select: { departmentId: true, schoolId: true },
        });
        if (!student || student.schoolId !== req.schoolId || student.departmentId !== userDeptId) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'HODs can only export reports for students in their department' });
          return;
        }
      } else if (type === 'class' && targetId) {
        const classData = await prisma.class.findUnique({
          where: { id: targetId },
          select: { departmentId: true, schoolId: true },
        });
        if (!classData || classData.schoolId !== req.schoolId || classData.departmentId !== userDeptId) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'HODs can only export reports for classes in their department' });
          return;
        }
      } else if (type === 'department') {
        if (targetId !== userDeptId) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'HODs can only export reports for their own department' });
          return;
        }
      } else if (type === 'school') {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', message: 'HODs cannot export school-wide reports' });
        return;
      }
    }

    // Reconstruct reportId with the authenticated user's schoolId for security
    const secureReportId = targetId
      ? `${type}:${req.schoolId}:${targetId}`
      : `${type}:${req.schoolId}`;

    const buffer = await reportService.exportReportById(secureReportId, format, dateRange);

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
