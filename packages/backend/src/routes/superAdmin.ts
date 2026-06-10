import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { createId } from '@paralleldrive/cuid2';
import { PlanTier } from '@sams/shared';
import { encodeLicenseKey } from '@sams/shared';
import { getLicenseSecret } from '../config/secrets';
import { getSmtpConfig, isEmailConfigured } from '../config/email';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { getSocketIO } from '../lib/socket';
import { licenseService } from '../services/licenseService';
import { auditService } from '../services/auditService';
import { requirePermission } from '../middleware/rbac';
import { AppError } from '../middleware/errors';
import {
  NOTIFICATION_ATTACHMENTS_DIR,
  notificationAttachmentPublicUrl,
} from '../config/uploads';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const generateLicenseSchema = z.object({
  schoolName: z.string().min(2).max(100),
  planTier: z.nativeEnum(PlanTier),
  expiresAt: z.string().datetime(),
});

const extendLicenseSchema = z.object({
  newExpiry: z.string().datetime(),
});

const updateSchoolPlanSchema = z.object({
  planTier: z.nativeEnum(PlanTier),
  newExpiry: z.string().datetime().optional(),
});

const SUPER_NOTIFICATION_TYPE = 'SUPER_ADMIN';
const SUPER_NOTIFICATION_MAX_BYTES = 10 * 1024 * 1024;
const SUPER_NOTIFICATION_MAX_FILES = 5;
const SUPER_NOTIFICATION_MIME_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
]);

const superNotificationSchema = z.object({
  audience: z.enum(['all_schools', 'school']),
  schoolId: z.string().optional(),
  targetRole: z.enum(['ALL', 'SCHOOL_ADMIN', 'HOD', 'TEACHER', 'STUDENT']).default('ALL'),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
});

const editSuperNotificationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(2000).optional(),
}).refine((value) => !!value.title || !!value.message, {
  message: 'Title or message is required',
});

type SuperNotificationAttachmentResponse = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: Date;
};

const superNotificationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SUPER_NOTIFICATION_MAX_BYTES, files: SUPER_NOTIFICATION_MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (SUPER_NOTIFICATION_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new AppError(400, 'INVALID_ATTACHMENT', 'Only images, videos, PDF, Office documents, and text files are allowed'));
  },
});

function uploadSuperNotificationAttachments(req: Request, res: Response, next: NextFunction): void {
  superNotificationUpload.array('attachments', SUPER_NOTIFICATION_MAX_FILES)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(413, 'FILE_TOO_LARGE', 'Each attachment must be 10MB or smaller'));
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        next(new AppError(400, 'TOO_MANY_FILES', `Attach up to ${SUPER_NOTIFICATION_MAX_FILES} files`));
        return;
      }
    }

    next(err instanceof AppError ? err : new AppError(400, 'INVALID_ATTACHMENT', 'Invalid attachment upload'));
  });
}

function uploadedSuperNotificationFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
}

function normalizeSuperNotificationBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    schoolId: typeof body.schoolId === 'string' && body.schoolId.trim() === '' ? undefined : body.schoolId,
    targetRole: typeof body.targetRole === 'string' && body.targetRole.trim() === '' ? 'ALL' : body.targetRole,
  };
}

function safeSuperNotificationOriginalName(name: string): string {
  return path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 160) || 'attachment';
}

function superNotificationAttachmentFilePath(schoolId: string, batchId: string, storedName: string): string {
  const root = path.resolve(NOTIFICATION_ATTACHMENTS_DIR);
  const filePath = path.resolve(root, schoolId, batchId, storedName);
  if (!filePath.startsWith(root + path.sep)) {
    throw new AppError(400, 'INVALID_ATTACHMENT_PATH', 'Invalid attachment path');
  }
  return filePath;
}

async function saveSuperNotificationAttachments(
  files: Express.Multer.File[],
  schoolId: string,
  senderId: string,
  batchId: string,
): Promise<SuperNotificationAttachmentResponse[]> {
  if (files.length === 0) return [];

  const dir = path.join(NOTIFICATION_ATTACHMENTS_DIR, schoolId, batchId);
  await fs.promises.mkdir(dir, { recursive: true });

  const rows = await Promise.all(files.map(async (file) => {
    const id = createId();
    const ext = SUPER_NOTIFICATION_MIME_TYPES.get(file.mimetype) || path.extname(file.originalname).toLowerCase() || '.bin';
    const storedName = `${id}${ext}`;
    const fileName = safeSuperNotificationOriginalName(file.originalname);
    const url = notificationAttachmentPublicUrl(schoolId, batchId, storedName);

    await fs.promises.writeFile(path.join(dir, storedName), file.buffer);

    return {
      id,
      schoolId,
      senderId,
      batchId,
      fileName,
      storedName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      url,
    };
  }));

  await prisma.notificationAttachment.createMany({ data: rows });

  return rows.map(({ id, fileName, mimeType, sizeBytes, url }) => ({
    id,
    fileName,
    mimeType,
    sizeBytes,
    url,
    createdAt: new Date(),
  }));
}

async function deleteSuperNotificationAttachments(batchId: string, senderId: string): Promise<void> {
  const attachments = await prisma.notificationAttachment.findMany({ where: { batchId, senderId } });
  await prisma.notificationAttachment.deleteMany({ where: { batchId, senderId } });

  await Promise.all(attachments.map(async (a) => {
    try {
      await fs.promises.unlink(superNotificationAttachmentFilePath(a.schoolId, batchId, a.storedName));
    } catch {
      // Best-effort file cleanup.
    }
  }));
}

async function loadSuperNotificationAttachments(
  batchIds: string[],
  senderId: string,
): Promise<Map<string, SuperNotificationAttachmentResponse[]>> {
  const uniqueBatchIds = [...new Set(batchIds.filter(Boolean))];
  if (uniqueBatchIds.length === 0) return new Map();

  const attachments = await prisma.notificationAttachment.findMany({
    where: { batchId: { in: uniqueBatchIds }, senderId },
    orderBy: { createdAt: 'asc' },
  });

  const seen = new Set<string>();
  const map = new Map<string, SuperNotificationAttachmentResponse[]>();
  for (const a of attachments) {
    const dedupeKey = `${a.batchId}:${a.fileName}:${a.sizeBytes}:${a.mimeType}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const list = map.get(a.batchId) ?? [];
    list.push({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      url: a.url,
      createdAt: a.createdAt,
    });
    map.set(a.batchId, list);
  }
  return map;
}

async function resolveSuperNotificationTargetLabel(
  scope: string | null,
  targetId: string | null,
  targetRole: string | null,
): Promise<string> {
  let label = scope === 'all_schools' ? 'All schools' : 'Selected school';
  if (scope === 'school' && targetId) {
    const school = await prisma.school.findUnique({ where: { id: targetId }, select: { name: true } });
    label = school?.name ?? 'Selected school';
  }
  if (targetRole) {
    label += ` (${targetRole.replace('_', ' ').toLowerCase()}s)`;
  }
  return label;
}

// ─── Host Restriction Middleware ──────────────────────────────────────────────
// Requirement 2.4, 15.1: Super Admin panel is accessible only via super.smart-managment.com.
// In development/testing, the SUPER_ADMIN_HOST env var can override the allowed host.
// If SUPER_ADMIN_HOST_CHECK is set to "disabled", the check is skipped entirely
// (useful for local development and testing).

function getAllowedSuperAdminHosts(): string[] {
  const fromEnv = process.env.SUPER_ADMIN_HOST || 'super.smart-managment.com';
  const hosts = fromEnv.split(',').map((h) => h.trim()).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    hosts.push('localhost', '127.0.0.1');
  }
  return [...new Set(hosts)];
}

function requireSuperAdminHost(req: Request, res: Response, next: NextFunction): void {
  const hostCheckDisabled = process.env.SUPER_ADMIN_HOST_CHECK === 'disabled';
  if (hostCheckDisabled) {
    next();
    return;
  }

  const allowedHosts = getAllowedSuperAdminHosts();
  const requestHost = req.hostname;

  if (!allowedHosts.includes(requestHost)) {
    res.status(403).json({
      error: 'Forbidden',
      code: 'HOST_NOT_ALLOWED',
      message:
        'Super Admin API must be reached via the Super Admin subdomain (same-origin /api proxy). ' +
        `Allowed Host: ${allowedHosts.join(', ')}. Received: ${requestHost}. ` +
        'Set SUPER_ADMIN_HOST on the API server or call /api from super.smart-managment.com, not api.smart-managment.com.',
    });
    return;
  }

  next();
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const superAdminRouter = Router();

// Task 22.2: Restrict all /super/* routes to SUPER_ADMIN role AND super admin host
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

  const secret = getLicenseSecret();

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

  // Audit log — super admin is not in the User table so actorId must be null
  await auditService.log({
    eventType: 'LICENSE_ACTIVATION',
    actorId: undefined,
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
    actorId: undefined, // super admin not in User table
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

// ─── GET /super/system-status — Platform health (no secrets, no SMS) ────────────

superAdminRouter.get('/system-status', async (_req: Request, res: Response): Promise<void> => {
  let dbOk = false;
  let redisOk = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  try {
    redisOk = (await redis.ping()) === 'PONG';
  } catch {
    redisOk = false;
  }

  const smtpCfg = isEmailConfigured() ? getSmtpConfig() : null;
  const ready = dbOk && redisOk;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? 'development',
    checks: { database: dbOk, redis: redisOk },
    email: smtpCfg
      ? { configured: true, host: smtpCfg.host, from: smtpCfg.fromEmail }
      : { configured: false },
    otp: {
      loginEnabled: process.env.OTP_LOGIN_ENABLED === 'true',
      passwordResetEnabled: process.env.OTP_PASSWORD_RESET_ENABLED === 'true',
    },
  });
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
    actorId: undefined, // super admin not in User table
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

// POST /super/schools/:id/plan - Change plan tier, optionally with a new expiry.
superAdminRouter.post('/schools/:id/plan', async (req: Request, res: Response): Promise<void> => {
  const schoolId = req.params.id as string;

  const parsed = updateSchoolPlanSchema.safeParse(req.body);
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

  const updated = await prisma.school.update({
    where: { id: schoolId },
    data: {
      planTier: parsed.data.planTier,
      ...(parsed.data.newExpiry ? { licenseExpiresAt: new Date(parsed.data.newExpiry) } : {}),
      isReadOnly: false,
    },
    select: {
      id: true,
      name: true,
      planTier: true,
      licenseExpiresAt: true,
      isReadOnly: true,
    },
  });

  await auditService.log({
    eventType: 'LICENSE_ACTIVATION',
    actorId: undefined,
    actorRole: req.user?.role,
    schoolId,
    resourceSnapshot: {
      action: 'SCHOOL_PLAN_CHANGED',
      schoolId,
      schoolName: school.name,
      previousPlanTier: school.planTier,
      planTier: updated.planTier,
      previousLicenseExpiresAt: school.licenseExpiresAt.toISOString(),
      licenseExpiresAt: updated.licenseExpiresAt.toISOString(),
      changedAt: new Date().toISOString(),
    },
  });

  res.json({
    message: 'School plan updated successfully',
    school: updated,
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
    await tx.notification.deleteMany({ where: { schoolId } });
    await tx.conversationRecord.deleteMany({ where: { thread: { schoolId } } });
    await tx.conversationThread.deleteMany({ where: { schoolId } });
    await tx.aIKnowledge.deleteMany({ where: { schoolId } });
    await tx.registrationLink.deleteMany({ where: { schoolId } });
    await tx.timetableEntry.deleteMany({ where: { schoolId } });
    await tx.riskScore.deleteMany({ where: { schoolId } });
    await tx.payment.deleteMany({ where: { schoolId } });
    await tx.auditLog.deleteMany({ where: { schoolId } });
    await tx.refreshToken.deleteMany({ where: { user: { schoolId } } });
    await tx.webAuthnCredential.deleteMany({ where: { user: { schoolId } } });
    await tx.biometricTemplate.deleteMany({ where: { schoolId } });
    await tx.user.deleteMany({ where: { schoolId } });
    await tx.class.deleteMany({ where: { schoolId } });
    await tx.department.deleteMany({ where: { schoolId } });
    await tx.licenseKey.updateMany({ where: { usedBySchoolId: schoolId }, data: { usedBySchoolId: null, usedAt: null } });
    await tx.school.delete({ where: { id: schoolId } });
  });

  // Audit log — wrapped in try-catch since the school no longer exists
  try {
    await auditService.log({
      eventType: 'SCHOOL_SUSPENDED',
      actorId: undefined, // super admin not in User table
      actorRole: req.user?.role,
      resourceSnapshot: {
        schoolId,
        schoolName: school.name,
        action: 'SCHOOL_DELETED',
        deletedAt: new Date().toISOString(),
      },
    });
  } catch {
    // School was deleted, audit log may fail — that's ok
  }

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

  // Serialize BigInt values to strings for JSON compatibility
  const serializedLogs = JSON.parse(JSON.stringify(logs, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  res.json({ logs: serializedLogs, count: serializedLogs.length });
});

// ─── DELETE /super/audit-logs — Clear audit logs (super admin only) ───────────

superAdminRouter.delete('/audit-logs', async (req: Request, res: Response): Promise<void> => {
  const { schoolId, eventType, dateFrom, dateTo } = req.query;

  const filters: Parameters<typeof auditService.clear>[0] = {};
  if (schoolId && typeof schoolId === 'string') filters.schoolId = schoolId;
  if (eventType && typeof eventType === 'string') filters.eventType = eventType;
  if (dateFrom && typeof dateFrom === 'string') filters.dateFrom = new Date(dateFrom);
  if (dateTo && typeof dateTo === 'string') filters.dateTo = new Date(dateTo);

  const deletedCount = await auditService.clear(filters);

  await auditService.log({
    eventType: 'AI_ACTION_EXECUTED',
    actorRole: req.user?.role,
    resourceSnapshot: {
      action: 'AUDIT_LOGS_CLEARED',
      deletedCount,
      filters,
      clearedAt: new Date().toISOString(),
    },
  });

  res.json({ message: `Cleared ${deletedCount} audit log record(s).`, deletedCount });
});

// ─── Super Admin Notifications ────────────────────────────────────────────────

superAdminRouter.get('/notifications/sent', async (req: Request, res: Response): Promise<void> => {
  const senderId = req.user.sub;

  const sentNotifications = await prisma.notification.findMany({
    where: { senderId, type: SUPER_NOTIFICATION_TYPE },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });

  const seen = new Set<string>();
  const batches: typeof sentNotifications = [];
  for (const notification of sentNotifications) {
    const key = notification.batchId ?? notification.id;
    if (seen.has(key)) continue;
    seen.add(key);
    batches.push(notification);
  }

  const attachmentMap = await loadSuperNotificationAttachments(
    batches.map((notification) => notification.batchId ?? notification.id),
    senderId,
  );

  const enriched = await Promise.all(batches.map(async (notification) => {
    const key = notification.batchId ?? notification.id;
    const recipientCount = notification.batchId
      ? await prisma.notification.count({
          where: { batchId: notification.batchId, senderId, type: SUPER_NOTIFICATION_TYPE },
        })
      : 1;
    const schoolCount = notification.batchId
      ? await prisma.notification.groupBy({
          by: ['schoolId'],
          where: { batchId: notification.batchId, senderId, type: SUPER_NOTIFICATION_TYPE },
        }).then((rows) => rows.length)
      : 1;
    const targetScopeLabel = await resolveSuperNotificationTargetLabel(
      notification.scope,
      notification.targetId,
      notification.targetRole,
    );

    return {
      ...notification,
      recipientCount,
      schoolCount,
      targetScopeLabel,
      attachments: attachmentMap.get(key) ?? [],
    };
  }));

  res.status(200).json(enriched);
});

superAdminRouter.post(
  '/notifications/send',
  uploadSuperNotificationAttachments,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = superNotificationSchema.safeParse(
        normalizeSuperNotificationBody(req.body as Record<string, unknown>),
      );
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const { audience, schoolId, targetRole, title, message } = parsed.data;
      if (audience === 'school' && !schoolId) {
        throw new AppError(400, 'SCHOOL_REQUIRED', 'Select a school or choose all schools');
      }

      if (audience === 'school') {
        const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
        if (!school) throw new AppError(404, 'NOT_FOUND', 'School not found');
      }

      const where: any = targetRole === 'ALL'
        ? { role: { not: 'SUPER_ADMIN' } }
        : { role: targetRole };
      if (audience === 'school') where.schoolId = schoolId;

      const recipients = await prisma.user.findMany({
        where,
        select: { id: true, schoolId: true },
      });

      const batchId = createId();
      if (recipients.length === 0) {
        res.status(200).json({
          success: false,
          recipientCount: 0,
          schoolCount: 0,
          batchId,
          warning: 'No users matched this audience.',
        });
        return;
      }

      const effectiveTargetRole = targetRole === 'ALL' ? null : targetRole;
      const rows = recipients.map((recipient) => ({
        schoolId: recipient.schoolId,
        userId: recipient.id,
        senderId: req.user.sub,
        batchId,
        title,
        message,
        type: SUPER_NOTIFICATION_TYPE,
        scope: audience,
        targetId: audience === 'school' ? schoolId! : null,
        targetRole: effectiveTargetRole,
      }));

      for (let i = 0; i < rows.length; i += 500) {
        await prisma.notification.createMany({ data: rows.slice(i, i + 500) });
      }

      const files = uploadedSuperNotificationFiles(req);
      const schoolIds = [...new Set(recipients.map((recipient) => recipient.schoolId))];
      const attachmentResults: SuperNotificationAttachmentResponse[] = [];
      for (const targetSchoolId of schoolIds) {
        const saved = await saveSuperNotificationAttachments(files, targetSchoolId, req.user.sub, batchId);
        if (attachmentResults.length === 0) attachmentResults.push(...saved);
      }

      res.status(200).json({
        success: true,
        recipientCount: recipients.length,
        schoolCount: schoolIds.length,
        batchId,
        attachments: attachmentResults,
      });

      setImmediate(() => {
        for (const recipient of recipients) {
          getSocketIO().to(`user:${recipient.id}`).emit('notification:new', {
            title,
            message,
            type: SUPER_NOTIFICATION_TYPE,
            senderId: req.user.sub,
            batchId,
            timestamp: new Date().toISOString(),
          });
        }
      });
    } catch (err) {
      next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to send Super Admin notification'));
    }
  },
);

superAdminRouter.patch('/notifications/:id', async (req: Request, res: Response): Promise<void> => {
  const parsed = editSuperNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const id = req.params.id as string;
  const notification = await prisma.notification.findFirst({
    where: { id, senderId: req.user.sub, type: SUPER_NOTIFICATION_TYPE },
  });
  if (!notification) {
    throw new AppError(404, 'NOT_FOUND', 'Notification not found');
  }

  const data = {
    ...(parsed.data.title ? { title: parsed.data.title } : {}),
    ...(parsed.data.message ? { message: parsed.data.message } : {}),
    updatedAt: new Date(),
  };

  if (notification.batchId) {
    await prisma.notification.updateMany({
      where: { batchId: notification.batchId, senderId: req.user.sub, type: SUPER_NOTIFICATION_TYPE },
      data,
    });
  } else {
    await prisma.notification.update({ where: { id }, data });
  }

  const affected = await prisma.notification.findMany({
    where: notification.batchId
      ? { batchId: notification.batchId, senderId: req.user.sub, type: SUPER_NOTIFICATION_TYPE }
      : { id },
    select: { id: true, userId: true },
  });

  for (const item of affected) {
    getSocketIO().to(`user:${item.userId}`).emit('notification:updated', {
      id: item.id,
      title: parsed.data.title,
      message: parsed.data.message ?? notification.message,
      updatedAt: data.updatedAt.toISOString(),
    });
  }

  const updated = await prisma.notification.findUnique({ where: { id } });
  res.status(200).json(updated);
});

superAdminRouter.delete('/notifications/batch/:batchId', async (req: Request, res: Response): Promise<void> => {
  const batchId = req.params.batchId as string;
  const existing = await prisma.notification.findFirst({
    where: { batchId, senderId: req.user.sub, type: SUPER_NOTIFICATION_TYPE },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Notification batch not found');
  }

  await prisma.notification.deleteMany({
    where: { batchId, senderId: req.user.sub, type: SUPER_NOTIFICATION_TYPE },
  });
  await deleteSuperNotificationAttachments(batchId, req.user.sub);

  res.status(204).send();
});

// ─── AI Knowledge Base CRUD ────────────────────────────────────────────────────

const aiKnowledgeSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  category: z.string().default('general'),
});

// GET /super/ai-knowledge — List all knowledge entries
superAdminRouter.get('/ai-knowledge', async (_req: Request, res: Response): Promise<void> => {
  const entries = await prisma.aIKnowledge.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json({ entries });
});

// POST /super/ai-knowledge — Add a new knowledge entry
superAdminRouter.post('/ai-knowledge', async (req: Request, res: Response): Promise<void> => {
  const parsed = aiKnowledgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const entry = await prisma.aIKnowledge.create({
    data: {
      ...parsed.data,
      schoolId: req.user.schoolId,
      createdById: req.user.sub,
    },
  });

  res.status(201).json({ entry });
});

// PUT /super/ai-knowledge/:id — Update a knowledge entry
superAdminRouter.put('/ai-knowledge/:id', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const parsed = aiKnowledgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const existing = await prisma.aIKnowledge.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Knowledge entry not found', code: 'NOT_FOUND' });
    return;
  }

  const entry = await prisma.aIKnowledge.update({
    where: { id },
    data: parsed.data,
  });

  res.json({ entry });
});

// DELETE /super/ai-knowledge/:id — Delete a knowledge entry
superAdminRouter.delete('/ai-knowledge/:id', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;

  const existing = await prisma.aIKnowledge.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Knowledge entry not found', code: 'NOT_FOUND' });
    return;
  }

  await prisma.aIKnowledge.delete({ where: { id } });
  res.json({ message: 'Knowledge entry deleted successfully' });
});

// ─── POST /super/ai-action — Execute admin actions via AI ─────────────────────

const aiActionSchema = z.object({
  action: z.enum([
    'generate_license',
    'suspend_school',
    'unsuspend_school',
    'extend_license',
    'get_school_info',
    'get_system_stats',
    'clear_audit_logs',
    'reset_user_password',
  ]),
  params: z.record(z.unknown()).default({}),
});

superAdminRouter.post('/ai-action', async (req: Request, res: Response): Promise<void> => {
  const parsed = aiActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { action, params } = parsed.data;

  try {
    switch (action) {
      case 'generate_license': {
        const planTier = (params.planTier as string) || 'BASIC';
        const schoolName = (params.schoolName as string) || 'Unnamed School';
        const daysValid = (params.daysValid as number) || 365;

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + daysValid);

        const validTiers = ['TRIAL', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'];
        if (!validTiers.includes(planTier)) {
          res.status(400).json({
            error: `Invalid plan tier "${planTier}". Must be one of: ${validTiers.join(', ')}`,
            code: 'INVALID_PLAN_TIER',
          });
          return;
        }

        const secret = getLicenseSecret();
        const rawKey = encodeLicenseKey(
          { schoolName, planTier: planTier as any, expiresAt },
          secret,
        );

        const keyHash = createHash('sha256').update(rawKey).digest('hex');

        await prisma.licenseKey.create({
          data: {
            keyHash,
            planTier: planTier as any,
            schoolName,
            expiresAt,
          },
        });

        await auditService.log({
          eventType: 'LICENSE_ACTIVATION',
          actorId: undefined, // super admin not in User table
          actorRole: req.user?.role,
          resourceSnapshot: {
            action: 'LICENSE_GENERATED_VIA_AI',
            schoolName,
            planTier,
            expiresAt: expiresAt.toISOString(),
          },
        });

        res.json({
          message: `✅ License generated successfully!\n\n**License Key:** \`${rawKey}\`\n\n**Details:**\n• School: ${schoolName}\n• Plan: ${planTier}\n• Expires: ${expiresAt.toLocaleDateString()}\n\n⚠️ Store this key securely — it cannot be retrieved again.`,
          result: { licenseKey: rawKey, schoolName, planTier, expiresAt: expiresAt.toISOString() },
        });
        return;
      }

      case 'suspend_school': {
        const schoolName = params.schoolName as string;
        if (!schoolName) {
          res.status(400).json({ error: 'School name is required', code: 'MISSING_PARAM' });
          return;
        }

        const school = await prisma.school.findFirst({
          where: { name: { contains: schoolName, mode: 'insensitive' } },
        });

        if (!school) {
          res.status(404).json({
            error: `School "${schoolName}" not found. Please check the name and try again.`,
            code: 'NOT_FOUND',
          });
          return;
        }

        if (school.isSuspended) {
          res.json({ message: `⚠️ School "${school.name}" is already suspended.` });
          return;
        }

        await licenseService.suspendSchool(school.id);

        res.json({
          message: `✅ School "${school.name}" has been suspended.\n\n• All active sessions revoked\n• Users cannot log in\n• Audit log entry created`,
          result: { schoolId: school.id, schoolName: school.name, action: 'suspended' },
        });
        return;
      }

      case 'unsuspend_school': {
        const schoolName = params.schoolName as string;
        if (!schoolName) {
          res.status(400).json({ error: 'School name is required', code: 'MISSING_PARAM' });
          return;
        }

        const school = await prisma.school.findFirst({
          where: { name: { contains: schoolName, mode: 'insensitive' } },
        });

        if (!school) {
          res.status(404).json({
            error: `School "${schoolName}" not found. Please check the name and try again.`,
            code: 'NOT_FOUND',
          });
          return;
        }

        if (!school.isSuspended) {
          res.json({ message: `ℹ️ School "${school.name}" is not currently suspended.` });
          return;
        }

        await prisma.school.update({
          where: { id: school.id },
          data: { isSuspended: false },
        });

        await auditService.log({
          eventType: 'SCHOOL_SUSPENDED',
          actorId: undefined, // super admin not in User table
          actorRole: req.user?.role,
          schoolId: school.id,
          resourceSnapshot: {
            schoolId: school.id,
            schoolName: school.name,
            action: 'SCHOOL_UNSUSPENDED_VIA_AI',
            unsuspendedAt: new Date().toISOString(),
          },
        });

        res.json({
          message: `✅ School "${school.name}" has been unsuspended.\n\n• Users can now log in\n• Full access restored`,
          result: { schoolId: school.id, schoolName: school.name, action: 'unsuspended' },
        });
        return;
      }

      case 'extend_license': {
        const schoolName = params.schoolName as string;
        const daysToAdd = (params.daysToAdd as number) || 30;

        if (!schoolName) {
          res.status(400).json({ error: 'School name is required', code: 'MISSING_PARAM' });
          return;
        }

        const school = await prisma.school.findFirst({
          where: { name: { contains: schoolName, mode: 'insensitive' } },
        });

        if (!school) {
          res.status(404).json({
            error: `School "${schoolName}" not found. Please check the name and try again.`,
            code: 'NOT_FOUND',
          });
          return;
        }

        const currentExpiry = school.licenseExpiresAt;
        const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
        const newExpiry = new Date(baseDate);
        newExpiry.setDate(newExpiry.getDate() + daysToAdd);

        await licenseService.extendLicense(school.id, newExpiry);

        res.json({
          message: `✅ License extended for "${school.name}".\n\n• Previous expiry: ${currentExpiry.toLocaleDateString()}\n• New expiry: ${newExpiry.toLocaleDateString()}\n• Days added: ${daysToAdd}\n• Read-only mode cleared`,
          result: {
            schoolId: school.id,
            schoolName: school.name,
            previousExpiry: currentExpiry.toISOString(),
            newExpiry: newExpiry.toISOString(),
            daysAdded: daysToAdd,
          },
        });
        return;
      }

      case 'get_school_info': {
        const schoolName = params.schoolName as string;
        if (!schoolName) {
          res.status(400).json({ error: 'School name is required', code: 'MISSING_PARAM' });
          return;
        }

        const school = await prisma.school.findFirst({
          where: { name: { contains: schoolName, mode: 'insensitive' } },
          include: {
            _count: { select: { users: true, sessions: true, payments: true } },
          },
        });

        if (!school) {
          res.status(404).json({
            error: `School "${schoolName}" not found.`,
            code: 'NOT_FOUND',
          });
          return;
        }

        res.json({
          message: `📋 **School Info: ${school.name}**\n\n• ID: ${school.id}\n• Code: ${school.schoolCode}\n• Plan: ${school.planTier}\n• License Expires: ${school.licenseExpiresAt.toLocaleDateString()}\n• Suspended: ${school.isSuspended ? 'Yes ⚠️' : 'No ✅'}\n• Read-Only: ${school.isReadOnly ? 'Yes' : 'No'}\n• Total Users: ${(school as any)._count.users}\n• Total Sessions: ${(school as any)._count.sessions}\n• Total Payments: ${(school as any)._count.payments}\n• Created: ${school.createdAt.toLocaleDateString()}`,
          result: school,
        });
        return;
      }

      case 'get_system_stats': {
        const [totalSchools, totalStudents, totalTeachers, activeSessions, suspendedSchools] =
          await Promise.all([
            prisma.school.count(),
            prisma.user.count({ where: { role: 'STUDENT' } }),
            prisma.user.count({ where: { role: 'TEACHER' } }),
            prisma.attendanceSession.count({ where: { isActive: true } }),
            prisma.school.count({ where: { isSuspended: true } }),
          ]);

        const revenue = await prisma.payment.aggregate({
          where: { status: 'SUCCESS' },
          _sum: { amount: true },
        });

        res.json({
          message: `📊 **System Stats**\n\n• Schools: ${totalSchools}\n• Students: ${totalStudents}\n• Teachers: ${totalTeachers}\n• Active Sessions: ${activeSessions}\n• Suspended: ${suspendedSchools}\n• Revenue: KES ${(revenue._sum.amount || 0).toLocaleString()}`,
          result: {
            totalSchools,
            totalStudents,
            totalTeachers,
            activeSessions,
            suspendedSchools,
            totalRevenue: revenue._sum.amount || 0,
          },
        });
        return;
      }

      case 'reset_user_password': {
        const { resetUserPasswordBySuperAdmin } = await import('../services/passwordResetService');
        const identifier = (params.identifier as string) || (params.username as string) || '';
        const schoolCode = params.schoolCode as string | undefined;
        const schoolId = params.schoolId as string | undefined;
        const modeRaw = (params.mode as string) || 'temp_password';
        const mode = modeRaw === 'trigger_reset' ? 'trigger_reset' : 'temp_password';

        if (!identifier.trim()) {
          res.status(400).json({ error: 'identifier is required', code: 'MISSING_PARAM' });
          return;
        }

        const result = await resetUserPasswordBySuperAdmin({
          identifier,
          schoolCode,
          schoolId,
          mode,
          actorRole: req.user?.role,
        });

        if (!result.ok) {
          res.status(400).json({
            error: result.answer,
            code: 'RESET_FAILED',
            result: result.data,
          });
          return;
        }

        res.json({ message: result.answer, result: result.data });
        return;
      }

      case 'clear_audit_logs': {
        const filters: Parameters<typeof auditService.clear>[0] = {};
        if (params.schoolId && typeof params.schoolId === 'string') {
          filters.schoolId = params.schoolId;
        }
        if (params.eventType && typeof params.eventType === 'string') {
          filters.eventType = params.eventType;
        }

        const deletedCount = await auditService.clear(filters);

        await auditService.log({
          eventType: 'AI_ACTION_EXECUTED',
          actorRole: req.user?.role,
          resourceSnapshot: {
            action: 'AUDIT_LOGS_CLEARED',
            deletedCount,
            filters,
            clearedVia: 'SUPER_ADMIN_AI_ACTION',
          },
        });

        res.json({
          message: `✅ Cleared ${deletedCount} audit log record(s). A new audit entry documents this purge.`,
          result: { deletedCount },
        });
        return;
      }

      default:
        res.status(400).json({ error: `Unknown action: ${action}`, code: 'UNKNOWN_ACTION' });
    }
  } catch (err: any) {
    console.error('[SuperAdmin/AI-Action] Error:', err);
    res.status(500).json({
      error: err.message || 'Failed to execute action',
      code: 'ACTION_FAILED',
    });
  }
});
