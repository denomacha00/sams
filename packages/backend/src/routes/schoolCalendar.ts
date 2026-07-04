import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@sams/shared';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { requirePermission } from '../middleware/rbac';

const closureSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  title: z.string().min(1).max(120),
  reason: z.string().max(500).optional(),
});

export const schoolCalendarRouter = Router();

schoolCalendarRouter.get('/closures', async (req: Request, res: Response): Promise<void> => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;

  const closures = await prisma.schoolClosure.findMany({
    where: {
      schoolId: req.schoolId,
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { date: 'asc' },
  });
  res.status(200).json(closures);
});

schoolCalendarRouter.post('/closures', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  if (![UserRole.SCHOOL_ADMIN, UserRole.HOD].includes(req.user.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only school admins and HODs can manage school closures');
  }

  const parsed = closureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const closure = await prisma.schoolClosure.upsert({
    where: { schoolId_date: { schoolId: req.schoolId, date: parsed.data.date } },
    update: { title: parsed.data.title, reason: parsed.data.reason ?? null },
    create: {
      schoolId: req.schoolId,
      date: parsed.data.date,
      title: parsed.data.title,
      reason: parsed.data.reason ?? null,
    },
  });

  res.status(200).json(closure);
});

schoolCalendarRouter.delete('/closures/:date', requirePermission('manage:timetable'), async (req: Request, res: Response): Promise<void> => {
  if (![UserRole.SCHOOL_ADMIN, UserRole.HOD].includes(req.user.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only school admins and HODs can manage school closures');
  }

  const date = String(req.params.date);
  await prisma.schoolClosure.deleteMany({
    where: { schoolId: req.schoolId, date },
  });
  res.status(204).send();
});
