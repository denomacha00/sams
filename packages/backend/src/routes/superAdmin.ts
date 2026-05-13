import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { PlanTier } from '@prisma/client';
import { encodeLicenseKey } from '@sams/shared';
import { prisma } from '../index';
import { licenseService } from '../services/licenseService';
import { auditService } from '../services/auditService';
import { requirePermission } from '../middleware/rbac';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const generateLicenseSchema = z.object({
  schoolName: z.string().min(2).max(100),
  planTier: z.nativeEnum(PlanTier),
  expiresAt: z.string().datetime(),
});

const extendLicenseSchema = z.object({
  newExpiry: z.string().datetime(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const superAdminRouter = Router();

// All routes require super:admin permission
superAdminRouter.use(requirePermission('super:admin'));

// ─── POST /super/licenses — Generate a new license key ────────────────────────

superAdminRouter.post('/licenses', async (req: Request, res: Response): Promise<void> => {
  const parsed = generateLicenseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { schoolName, planTier, expiresAt } = parsed.data;
  const expiryDate = new Date(expiresAt);

  const secret = process.env.LICENSE_SECRET || process.env.JWT_SECRET || 'default-license-secret';

  // Generate the raw license key
  const rawKey = encodeLicenseKey(
    { schoolName, planTier: planTier as any, expiresAt: expiryDate },
    secret,
  );

  // Store bcrypt hash of the key (raw key is never stored)
  const keyHash = await bcrypt.hash(rawKey, 10);

  await prisma.licenseKey.create({
    data: {
      keyHash,
      planTier,
      schoolName,
      expiresAt: expiryDate,
    },
  });

  // Audit log
  await auditService.log({
    eventType: 'LICENSE_ACTIVATION',
    actorId: req.user?.sub,
    actorRole: req.user?.role,
    resourceSnapshot: {
      action: 'LICENSE_GENERATED',
      schoolName,
      planTier,
      expiresAt: expiryDate.toISOString(),
    },
  });

  // Return raw key once — it cannot be retrieved again
  res.status(201).json({
    licenseKey: rawKey,
    schoolName,
    planTier,
    expiresAt: expiryDate.toISOString(),
    message: 'License key generated. Store it securely — it cannot be retrieved again.',
  });
});

// ─── GET /super/schools — List all schools with stats ─────────────────────────

superAdminRouter.get('/schools', async (_req: Request, res: Response): Promise<void> => {
  const schools = await prisma.school.findMany({
    include: {
      _count: {
        select: {
          users: true,
          sessions: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = schools.map((school) => ({
    id: school.id,
    name: school.name,
    schoolCode: school.schoolCode,
    planTier: school.planTier,
    licenseExpiresAt: school.licenseExpiresAt,
    isSuspended: school.isSuspended,
    isReadOnly: school.isReadOnly,
    createdAt: school.createdAt,
    stats: {
      totalUsers: school._count.users,
      totalSessions: school._count.sessions,
    },
  }));

  res.json({ schools: result });
});

// ─── GET /super/schools/:id — Get school details ──────────────────────────────

superAdminRouter.get('/schools/:id', async (req: Request, res: Response): Promise<void> => {
  const schoolId = req.params.id as string;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: {
      _count: {
        select: {
          users: true,
          sessions: true,
          payments: true,
        },
      },
      payments: {
        where: { status: 'SUCCESS' },
        orderBy: { completedAt: 'desc' },
        take: 5,
      },
    },
  });

  if (!school) {
    res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
    return;
  }

  res.json({
    id: school.id,
    name: school.name,
    schoolCode: school.schoolCode,
    planTier: school.planTier,
    licenseExpiresAt: school.licenseExpiresAt,
    isSuspended: school.isSuspended,
    isReadOnly: school.isReadOnly,
    logoUrl: school.logoUrl,
    primaryColor: school.primaryColor,
    createdAt: school.createdAt,
    updatedAt: school.updatedAt,
    stats: {
      totalUsers: (school as any)._count.users,
      totalSessions: (school as any)._count.sessions,
      totalPayments: (school as any)._count.payments,
    },
    recentPayments: (school as any).payments,
  });
});

// ─── POST /super/schools/:id/suspend — Suspend a school ──────────────────────

superAdminRouter.post('/schools/:id/suspend', async (req: Request, res: Response): Promise<void> => {
  const schoolId = req.params.id as string;

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
    return;
  }

  await licenseService.suspendSchool(schoolId);

  res.json({ message: 'School suspended successfully', schoolId });
});

// ─── POST /super/schools/:id/unsuspend — Clear suspension ─────────────────────

superAdminRouter.post('/schools/:id/unsuspend', async (req: Request, res: Response): Promise<void> => {
  const schoolId = req.params.id as string;

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
    return;
  }

  await prisma.school.update({
    where: { id: schoolId },
    data: { isSuspended: false },
  });

  // Audit log
  await auditService.log({
    eventType: 'SCHOOL_SUSPENDED',
    actorId: req.user?.sub,
    actorRole: req.user?.role,
    schoolId,
    resourceSnapshot: {
      schoolId,
      schoolName: school.name,
      action: 'SCHOOL_UNSUSPENDED',
      unsuspendedAt: new Date().toISOString(),
    },
  });

  res.json({ message: 'School unsuspended successfully', schoolId });
});

// ─── POST /super/schools/:id/extend — Extend license ─────────────────────────

superAdminRouter.post('/schools/:id/extend', async (req: Request, res: Response): Promise<void> => {
  const schoolId = req.params.id as string;

  const parsed = extendLicenseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
    return;
  }

  const newExpiry = new Date(parsed.data.newExpiry);
  await licenseService.extendLicense(schoolId, newExpiry);

  res.json({
    message: 'License extended successfully',
    schoolId,
    newExpiresAt: newExpiry.toISOString(),
  });
});

// ─── GET /super/revenue — Aggregate payment totals by plan tier ───────────────

superAdminRouter.get('/revenue', async (_req: Request, res: Response): Promise<void> => {
  const revenue = await prisma.payment.groupBy({
    by: ['planTier'],
    where: { status: 'SUCCESS' },
    _sum: { amount: true },
    _count: { id: true },
  });

  const totalRevenue = revenue.reduce((sum, r) => sum + (r._sum.amount || 0), 0);

  res.json({
    totalRevenue,
    byPlanTier: revenue.map((r) => ({
      planTier: r.planTier,
      totalAmount: r._sum.amount || 0,
      paymentCount: r._count.id,
    })),
  });
});

// ─── GET /super/audit-logs — Query audit logs with filters ────────────────────

superAdminRouter.get('/audit-logs', async (req: Request, res: Response): Promise<void> => {
  const { schoolId, eventType, dateFrom, dateTo, limit, offset } = req.query;

  const filters: any = {};
  if (schoolId && typeof schoolId === 'string') filters.schoolId = schoolId;
  if (eventType && typeof eventType === 'string') filters.eventType = eventType;
  if (dateFrom && typeof dateFrom === 'string') filters.dateFrom = new Date(dateFrom);
  if (dateTo && typeof dateTo === 'string') filters.dateTo = new Date(dateTo);
  if (limit) filters.limit = parseInt(limit as string, 10) || 50;
  if (offset) filters.offset = parseInt(offset as string, 10) || 0;

  // Default limit
  if (!filters.limit) filters.limit = 50;

  const logs = await auditService.query(filters);

  res.json({ logs, count: logs.length });
});
