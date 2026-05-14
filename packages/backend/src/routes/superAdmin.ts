import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createHash } from 'crypto';
import { PlanTier } from '@sams/shared';
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

// ─── Host Restriction Middleware ──────────────────────────────────────────────
// Requirement 2.4, 15.1: Super Admin panel is accessible only via super.sams.ke.
// In development/testing, the SUPER_ADMIN_HOST env var can override the allowed host.
// If SUPER_ADMIN_HOST_CHECK is set to "disabled", the check is skipped entirely
// (useful for local development and testing).

function requireSuperAdminHost(req: Request, res: Response, next: NextFunction): void {
  const hostCheckDisabled = process.env.SUPER_ADMIN_HOST_CHECK === 'disabled';
  if (hostCheckDisabled) {
    next();
    return;
  }

  const allowedHost = process.env.SUPER_ADMIN_HOST || 'super.sams.ke';
  const requestHost = req.hostname;

  if (requestHost !== allowedHost) {
    res.status(403).json({
      error: 'Forbidden',
      code: 'HOST_NOT_ALLOWED',
      message: 'Super Admin routes are only accessible via the Super Admin panel.',
    });
    return;
  }

  next();
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const superAdminRouter = Router();

// Task 22.2: Restrict all /super/* routes to SUPER_ADMIN role AND super.sams.ke host
superAdminRouter.use(requireSuperAdminHost);
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
  const expiryDate = new Date(expiresAt as string);

  const secret = process.env.LICENSE_SECRET || process.env.JWT_SECRET || 'default-license-secret';

  // Generate the raw license key
  const rawKey = encodeLicenseKey(
    { schoolName, planTier: planTier as any, expiresAt: expiryDate },
    secret,
  );

  // Store SHA-256 hash of the key (raw key is never stored)
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

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

// ─── GET /super/licenses — List all license keys ──────────────────────────────

superAdminRouter.get('/licenses', async (req: Request, res: Response): Promise<void> => {
  const { planTier, used, expired } = req.query;

  const where: any = {};
  if (planTier && typeof planTier === 'string') {
    where.planTier = planTier;
  }
  if (used === 'true') {
    where.usedAt = { not: null };
  } else if (used === 'false') {
    where.usedAt = null;
  }
  if (expired === 'true') {
    where.expiresAt = { lt: new Date() };
  } else if (expired === 'false') {
    where.expiresAt = { gte: new Date() };
  }

  const licenses = await prisma.licenseKey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      planTier: true,
      schoolName: true,
      expiresAt: true,
      usedAt: true,
      usedBySchoolId: true,
      createdAt: true,
    },
  });

  res.json({ licenses, count: licenses.length });
});

// ─── POST /super/licenses/:id/revoke — Revoke a license key ──────────────────

superAdminRouter.post('/licenses/:id/revoke', async (req: Request, res: Response): Promise<void> => {
  const licenseId = req.params.id as string;

  const license = await prisma.licenseKey.findUnique({
    where: { id: licenseId },
  });

  if (!license) {
    res.status(404).json({ error: 'License key not found', code: 'NOT_FOUND' });
    return;
  }

  if (license.usedAt) {
    res.status(400).json({
      error: 'Cannot revoke a license key that has already been used',
      code: 'LICENSE_ALREADY_USED',
    });
    return;
  }

  await prisma.licenseKey.delete({
    where: { id: licenseId },
  });

  // Audit log
  await auditService.log({
    eventType: 'LICENSE_ACTIVATION',
    actorId: req.user?.sub,
    actorRole: req.user?.role,
    resourceSnapshot: {
      action: 'LICENSE_REVOKED',
      licenseId,
      schoolName: license.schoolName,
      planTier: license.planTier,
      revokedAt: new Date().toISOString(),
    },
  });

  res.json({ message: 'License key revoked successfully', licenseId });
});

// ─── GET /super/analytics — System-wide analytics ─────────────────────────────

superAdminRouter.get('/analytics', async (_req: Request, res: Response): Promise<void> => {
  const [totalSchools, totalStudents, activeSessions, totalTeachers, totalUsers] = await Promise.all([
    prisma.school.count(),
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.attendanceSession.count({ where: { isActive: true } }),
    prisma.user.count({ where: { role: 'TEACHER' } }),
    prisma.user.count(),
  ]);

  const schoolsByPlan = await prisma.school.groupBy({
    by: ['planTier'],
    _count: { id: true },
  });

  const suspendedSchools = await prisma.school.count({ where: { isSuspended: true } });
  const expiredSchools = await prisma.school.count({
    where: { licenseExpiresAt: { lt: new Date() } },
  });

  res.json({
    totalSchools,
    totalStudents,
    totalTeachers,
    totalUsers,
    activeSessions,
    suspendedSchools,
    expiredSchools,
    schoolsByPlan: schoolsByPlan.map((g: any) => ({
      planTier: g.planTier,
      count: g._count.id,
    })),
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

  const result = schools.map((school: any) => ({
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

// ─── DELETE /super/schools/:id — Delete a school and all its data ─────────────

superAdminRouter.delete('/schools/:id', async (req: Request, res: Response): Promise<void> => {
  const schoolId = req.params.id as string;

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
    return;
  }

  // Delete all related data in order (respecting foreign keys)
  await prisma.$transaction(async (tx: any) => {
    await tx.attendanceRecord.deleteMany({ where: { schoolId } });
    await tx.attendanceSession.deleteMany({ where: { schoolId } });
    await tx.registrationLink.deleteMany({ where: { schoolId } });
    await tx.timetableEntry.deleteMany({ where: { schoolId } });
    await tx.riskScore.deleteMany({ where: { schoolId } });
    await tx.payment.deleteMany({ where: { schoolId } });
    await tx.auditLog.deleteMany({ where: { schoolId } });
    await tx.refreshToken.deleteMany({ where: { user: { schoolId } } });
    await tx.biometricTemplate.deleteMany({ where: { schoolId } });
    await tx.user.deleteMany({ where: { schoolId } });
    await tx.class.deleteMany({ where: { schoolId } });
    await tx.department.deleteMany({ where: { schoolId } });
    await tx.licenseKey.updateMany({ where: { usedBySchoolId: schoolId }, data: { usedBySchoolId: null, usedAt: null } });
    await tx.school.delete({ where: { id: schoolId } });
  });

  // Audit log
  await auditService.log({
    eventType: 'SCHOOL_SUSPENDED',
    actorId: req.user?.sub,
    actorRole: req.user?.role,
    resourceSnapshot: {
      schoolId,
      schoolName: school.name,
      action: 'SCHOOL_DELETED',
      deletedAt: new Date().toISOString(),
    },
  });

  res.json({ message: 'School deleted successfully', schoolId });
});

// ─── GET /super/revenue — Aggregate payment totals by plan tier ───────────────

superAdminRouter.get('/revenue', async (_req: Request, res: Response): Promise<void> => {
  const revenue = await prisma.payment.groupBy({
    by: ['planTier'],
    where: { status: 'SUCCESS' },
    _sum: { amount: true },
    _count: { id: true },
  });

  const totalRevenue = revenue.reduce((sum: number, r: any) => sum + (r._sum.amount || 0), 0);

  res.json({
    totalRevenue,
    byPlanTier: revenue.map((r: any) => ({
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
