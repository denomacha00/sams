import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@sams/shared';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/rbac';
import { AppError } from '../middleware/errors';
import { schemeOfWorkService } from '../services/schemeOfWorkService';

export const schemeOfWorkRouter = Router();

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

// ─── GET /api/v1/schemes ───────────────────────────────────────────────────
// List schemes visible to the current user
schemeOfWorkRouter.get('/', requirePermission('view:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const schemes = await schemeOfWorkService.list({
      schoolId: req.schoolId,
      userId: req.user.sub,
      role: req.user.role as UserRole,
      departmentId: req.user.departmentId,
    });
    res.json(schemes);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load schemes of work');
  }
});

// ─── GET /api/v1/schemes/:id ───────────────────────────────────────────────
// Returns data needed by the frontend to build scheme: classes, terms, subjects.
// This route must stay before "/:id" so "generate-info" is not treated as an ID.
schemeOfWorkRouter.get('/generate-info', requirePermission('view:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const [classes, terms, teacherSubjects] = await Promise.all([
      prisma.class.findMany({
        where: { schoolId: req.schoolId },
        select: { id: true, name: true, departmentId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.academicTerm.findMany({
        where: { schoolId: req.schoolId },
        select: { id: true, name: true, isActive: true },
        orderBy: { startDate: 'desc' },
      }),
      prisma.teacherSubject.findMany({
        where: { teacherId: req.user.sub, schoolId: req.schoolId },
        select: { subject: true },
        distinct: ['subject'],
        orderBy: { subject: 'asc' },
      }),
    ]);

    const subjects = teacherSubjects.map((s) => s.subject);

    res.json({ classes, terms, subjects });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load generator info');
  }
});

// GET /api/v1/schemes/:id
schemeOfWorkRouter.get('/:id', requirePermission('view:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = routeParam(req, 'id');
    const scheme = await schemeOfWorkService.getById(id, req.schoolId);
    if (!scheme) {
      res.status(404).json({ error: 'Scheme of work not found', code: 'NOT_FOUND' });
      return;
    }
    res.json(scheme);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load scheme');
  }
});

// ─── POST /api/v1/schemes ─────────────────────────────────────────────────
const createSchemeSchema = z.object({
  subject: z.string().min(1).max(200),
  classId: z.string().min(1),
  termId: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
});

schemeOfWorkRouter.post('/', requirePermission('manage:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createSchemeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const scheme = await schemeOfWorkService.create({
      schoolId: req.schoolId,
      ...parsed.data,
      createdById: req.user.sub,
    });

    res.status(201).json(scheme);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create scheme');
  }
});

// ─── PUT /api/v1/schemes/:id ──────────────────────────────────────────────
// Update scheme metadata (title, description, subject)
const updateSchemeSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  subject: z.string().min(1).max(200).optional(),
});

schemeOfWorkRouter.put('/:id', requirePermission('manage:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = routeParam(req, 'id');
    const parsed = updateSchemeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      return;
    }

    await schemeOfWorkService.updateMeta(id, req.schoolId, parsed.data);
    const scheme = await schemeOfWorkService.getById(id, req.schoolId);
    res.json(scheme);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update scheme');
  }
});

// ─── POST /api/v1/schemes/:id/generate-weeks ─────────────────────────────
// AI-powered generation of weeks + lesson plans from a prompt
const generateWeeksSchema = z.object({
  weeks: z.array(z.object({
    weekNumber: z.number().int().min(1).max(52),
    topic: z.string().min(1).max(300),
    objectives: z.string().max(5000).optional(),
    teachingMethods: z.string().max(500).optional(),
    resources: z.string().max(500).optional(),
    assessment: z.string().max(500).optional(),
  })).min(1).max(52),
});

schemeOfWorkRouter.post('/:id/generate-weeks', requirePermission('manage:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = routeParam(req, 'id');
    const parsed = generateWeeksSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      return;
    }

    await schemeOfWorkService.generateWeeksForScheme(id, req.schoolId, parsed.data.weeks);
    const scheme = await schemeOfWorkService.getById(id, req.schoolId);
    res.json(scheme);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to generate weeks');
  }
});

// ─── POST /api/v1/schemes/:id/submit ──────────────────────────────────────
// Submit for HOD approval
schemeOfWorkRouter.post('/:id/submit', requirePermission('manage:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = routeParam(req, 'id');
    const count = await schemeOfWorkService.submitForApproval(id, req.schoolId);
    if (count.count === 0) {
      res.status(400).json({ error: 'Scheme cannot be submitted (not in DRAFT status or not found)', code: 'INVALID_STATUS' });
      return;
    }
    res.json({ message: 'Scheme submitted for approval' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to submit scheme');
  }
});

// ─── POST /api/v1/schemes/:id/approve ─────────────────────────────────────
// HOD approves
schemeOfWorkRouter.post('/:id/approve', requirePermission('approve:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = routeParam(req, 'id');
    const count = await schemeOfWorkService.approve(id, req.schoolId, req.user.sub);
    if (count.count === 0) {
      res.status(400).json({ error: 'Scheme cannot be approved (not PENDING_APPROVAL or not found)', code: 'INVALID_STATUS' });
      return;
    }
    res.json({ message: 'Scheme approved' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to approve scheme');
  }
});

// ─── POST /api/v1/schemes/:id/reject ──────────────────────────────────────
// HOD rejects
const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

schemeOfWorkRouter.post('/:id/reject', requirePermission('approve:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = routeParam(req, 'id');
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Rejection reason required', code: 'VALIDATION_ERROR' });
      return;
    }

    const count = await schemeOfWorkService.reject(id, req.schoolId, parsed.data.reason);
    if (count.count === 0) {
      res.status(400).json({ error: 'Scheme cannot be rejected (not PENDING_APPROVAL or not found)', code: 'INVALID_STATUS' });
      return;
    }
    res.json({ message: 'Scheme rejected', reason: parsed.data.reason });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to reject scheme');
  }
});

// ─── DELETE /api/v1/schemes/:id ───────────────────────────────────────────
schemeOfWorkRouter.delete('/:id', requirePermission('manage:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = routeParam(req, 'id');
    await schemeOfWorkService.delete(id, req.schoolId);
    res.json({ message: 'Scheme deleted' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && err.message === 'Cannot delete an approved scheme') {
      res.status(400).json({ error: err.message, code: 'INVALID_STATUS' });
      return;
    }
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete scheme');
  }
});

// ─── PATCH /api/v1/schemes/weeks/:weekId ─────────────────────────────────
// Update a week
const updateWeekSchema = z.object({
  topic: z.string().min(1).max(300).optional(),
  objectives: z.string().max(5000).optional(),
  teachingMethods: z.string().max(500).optional(),
  resources: z.string().max(500).optional(),
  assessment: z.string().max(500).optional(),
});

schemeOfWorkRouter.patch('/weeks/:weekId', requirePermission('manage:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const weekId = routeParam(req, 'weekId');
    const parsed = updateWeekSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR' });
      return;
    }
    const updated = await schemeOfWorkService.updateWeek(weekId, parsed.data);
    res.json(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update week');
  }
});

// ─── PATCH /api/v1/schemes/lesson-plans/:planId ───────────────────────────
// Update a lesson plan
const updateLessonPlanSchema = z.object({
  topic: z.string().min(1).max(300).optional(),
  objectives: z.string().max(5000).optional(),
  introduction: z.string().max(10000).optional(),
  mainActivity: z.string().max(10000).optional(),
  conclusion: z.string().max(10000).optional(),
  materials: z.string().max(500).optional(),
  homework: z.string().max(500).optional(),
  status: z.enum(['DRAFT', 'COMPLETED', 'SKIPPED']).optional(),
});

schemeOfWorkRouter.patch('/lesson-plans/:planId', requirePermission('manage:schemes'), async (req: Request, res: Response): Promise<void> => {
  try {
    const planId = routeParam(req, 'planId');
    const parsed = updateLessonPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR' });
      return;
    }
    const updated = await schemeOfWorkService.updateLessonPlan(planId, parsed.data);
    res.json(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update lesson plan');
  }
});

