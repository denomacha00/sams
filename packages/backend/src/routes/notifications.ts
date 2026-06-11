import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { getSocketIO } from '../lib/socket';
import { AppError } from '../middleware/errors';
import {
  NOTIFICATION_ATTACHMENTS_DIR,
  notificationAttachmentPublicUrl,
} from '../config/uploads';
import {
  ScopedNotificationError,
  sendScopedNotification,
} from '../services/scopedNotificationSend';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const sendNotificationSchema = z.object({
  scope: z.enum(['school', 'department', 'class']),
  targetId: z.string().optional(),
  // Optional role filter: 'TEACHER', 'STUDENT', 'HOD', or omit for all roles in scope
  targetRole: z.enum(['TEACHER', 'STUDENT', 'HOD', 'SCHOOL_ADMIN']).optional(),
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(1000),
  channels: z.array(z.enum(['inapp', 'sms'])).min(1),
});

const editNotificationSchema = z.object({
  message: z.string().min(1).max(1000),
});

const replyNotificationSchema = z.object({
  parentNotificationId: z.string().min(1),
  message: z.string().min(1).max(1000),
});

const supportNotificationSchema = z.object({
  message: z.string().min(1).max(2000),
});

const testSmsSchema = z.object({
  phone: z.string().min(9).max(20),
  message: z.string().min(1).max(160).optional(),
});

const testEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200).optional(),
});

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_MAX_FILES = 5;
const SUPER_NOTIFICATION_TYPE = 'SUPER_ADMIN';
const SUPER_SUPPORT_NOTIFICATION_TYPE = 'SUPER_ADMIN_SUPPORT';
const ATTACHMENT_MIME_TYPES = new Map<string, string>([
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

type AttachmentResponse = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: Date;
};

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_BYTES, files: ATTACHMENT_MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new AppError(400, 'INVALID_ATTACHMENT', 'Only images, videos, PDF, Office documents, and text files are allowed'));
  },
});

function uploadNotificationAttachments(req: Request, res: Response, next: NextFunction): void {
  attachmentUpload.array('attachments', ATTACHMENT_MAX_FILES)(req, res, (err: unknown) => {
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
        next(new AppError(400, 'TOO_MANY_FILES', `Attach up to ${ATTACHMENT_MAX_FILES} files`));
        return;
      }
    }

    next(err instanceof AppError ? err : new AppError(400, 'INVALID_ATTACHMENT', 'Invalid attachment upload'));
  });
}

function normalizeChannels(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return [trimmed];
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeOptionalString(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function normalizeSendNotificationBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    targetId: normalizeOptionalString(body.targetId),
    targetRole: normalizeOptionalString(body.targetRole),
    title: normalizeOptionalString(body.title),
    channels: normalizeChannels(body.channels),
  };
}

function uploadedNotificationFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
}

function safeOriginalName(name: string): string {
  return path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 160) || 'attachment';
}

function safeHeaderFileName(name: string): string {
  return safeOriginalName(name).replace(/["\\\r\n]/g, '_');
}

function notificationAttachmentFilePath(schoolId: string, batchId: string, storedName: string): string {
  const root = path.resolve(NOTIFICATION_ATTACHMENTS_DIR);
  const filePath = path.resolve(root, schoolId, batchId, storedName);
  if (!filePath.startsWith(root + path.sep)) {
    throw new AppError(400, 'INVALID_ATTACHMENT_PATH', 'Invalid attachment path');
  }
  return filePath;
}

async function saveNotificationAttachments(
  files: Express.Multer.File[],
  schoolId: string,
  senderId: string,
  batchId: string,
): Promise<AttachmentResponse[]> {
  if (files.length === 0) return [];

  const dir = path.join(NOTIFICATION_ATTACHMENTS_DIR, schoolId, batchId);
  await fs.promises.mkdir(dir, { recursive: true });

  const rows = await Promise.all(
    files.map(async (file) => {
      const id = createId();
      const ext = ATTACHMENT_MIME_TYPES.get(file.mimetype) || path.extname(file.originalname).toLowerCase() || '.bin';
      const storedName = `${id}${ext}`;
      const fileName = safeOriginalName(file.originalname);
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
    }),
  );

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

async function loadAttachmentsByBatch(
  batchIds: string[],
  schoolId?: string,
): Promise<Map<string, AttachmentResponse[]>> {
  const uniqueBatchIds = [...new Set(batchIds.filter(Boolean))];
  if (uniqueBatchIds.length === 0) return new Map();

  const attachments = await prisma.notificationAttachment.findMany({
    where: {
      batchId: { in: uniqueBatchIds },
      ...(schoolId ? { schoolId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  const map = new Map<string, AttachmentResponse[]>();
  for (const a of attachments) {
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

async function deleteAttachmentsForBatch(batchId: string, senderId: string): Promise<void> {
  const attachments = await prisma.notificationAttachment.findMany({
    where: { batchId, senderId },
  });

  await prisma.notificationAttachment.deleteMany({ where: { batchId, senderId } });

  await Promise.all(
    attachments.map(async (a) => {
      try {
        const filePath = notificationAttachmentFilePath(a.schoolId, batchId, a.storedName);
        await fs.promises.unlink(filePath);
      } catch {
        // Best effort: DB cleanup matters more than a stale file.
      }
    }),
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const notificationsRouter = Router();

/** Resolve human-readable target scope label for a notification batch. */
async function resolveTargetScopeLabel(
  scope: string | null | undefined,
  targetId: string | null | undefined,
  targetRole: string | null | undefined,
): Promise<string> {
  let label = 'Message';
  if (scope === 'school') {
    label = 'Whole School';
  } else if (scope === 'department' && targetId) {
    const dept = await prisma.department.findUnique({ where: { id: targetId }, select: { name: true } });
    label = dept ? `Department: ${dept.name}` : 'Department';
  } else if (scope === 'class' && targetId) {
    const cls = await prisma.class.findUnique({ where: { id: targetId }, select: { name: true } });
    label = cls ? `Class: ${cls.name}` : 'Class';
  } else if (scope) {
    label = scope.charAt(0).toUpperCase() + scope.slice(1);
  }
  if (targetRole) {
    label += ` (${targetRole.replace('_', ' ').toLowerCase()}s)`;
  }
  return label;
}

/** Teachers assigned to a student's class (class teacher + timetable). */
async function getTeachersForClass(classId: string): Promise<string[]> {
  const teacherIds = new Set<string>();
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: { classTeacherId: true },
  });
  if (cls?.classTeacherId) teacherIds.add(cls.classTeacherId);
  const entries = await prisma.timetableEntry.findMany({
    where: { classId },
    select: { teacherId: true },
  });
  for (const e of entries) teacherIds.add(e.teacherId);
  return [...teacherIds];
}

async function getSuperAdminRecipientId(): Promise<string | null> {
  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return superAdmin?.id ?? null;
}

function emitNotificationToUser(userId: string, payload: Record<string, unknown>): void {
  setImmediate(() => {
    getSocketIO().to(`user:${userId}`).emit('notification:new', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  });
}

/**
 * GET /api/v1/notifications/sms-status
 * Africa's Talking configuration status (no secrets).
 */
notificationsRouter.get('/sms-status', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'SCHOOL_ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only school admins can view SMS status');
  }
  const { notificationService } = await import('../services/notificationService');
  res.status(200).json(notificationService.getSmsStatus());
});

/**
 * POST /api/v1/notifications/test-sms
 * Send a test SMS (school admin). Sandbox only delivers to numbers added in AT dashboard.
 */
notificationsRouter.post('/test-sms', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'SCHOOL_ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only school admins can send test SMS');
  }

  const parsed = testSmsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { notificationService } = await import('../services/notificationService');
  const status = notificationService.getSmsStatus();
  if (!status.configured) {
    res.status(503).json({
      error: 'SMS not configured. Set AT_API_KEY and AT_USERNAME on the server.',
      code: 'SMS_NOT_CONFIGURED',
    });
    return;
  }

  const message =
    parsed.data.message?.trim() ||
    'SAMS test SMS — Africa\'s Talking is connected successfully.';

  const result = await notificationService.sendSMSTest(parsed.data.phone, message);
  if (!result.ok) {
    const { formatSmsDeliveryError } = await import('../services/notificationService');
    res.status(502).json({
      error: formatSmsDeliveryError(result.error || 'SMS send failed', status.sandbox),
      code: 'SMS_SEND_FAILED',
      sandbox: status.sandbox,
      hint: status.sandbox
        ? 'Register the recipient at account.africastalking.com → SMS → phone numbers (E.164, e.g. +2547XXXXXXXX).'
        : undefined,
    });
    return;
  }

  res.status(200).json({
    success: true,
    sandbox: status.sandbox,
    hint: status.sandbox
      ? 'Sandbox SMS only reaches phone numbers registered in your Africa\'s Talking sandbox.'
      : undefined,
    recipients: result.recipients,
  });
});

/**
 * GET /api/v1/notifications/email-status
 */
notificationsRouter.get('/email-status', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'SCHOOL_ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only school admins can view email status');
  }
  const { notificationService } = await import('../services/notificationService');
  res.status(200).json(notificationService.getEmailStatus());
});

/**
 * POST /api/v1/notifications/test-email
 */
notificationsRouter.post('/test-email', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'SCHOOL_ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only school admins can send test email');
  }

  const parsed = testEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { notificationService } = await import('../services/notificationService');
  const status = notificationService.getEmailStatus();
  if (!status.configured) {
    res.status(503).json({
      error: 'Email not configured. Set SMTP_USER and SMTP_PASS on the server.',
      code: 'EMAIL_NOT_CONFIGURED',
    });
    return;
  }

  const subject = parsed.data.subject?.trim() || 'SAMS test email';
  const result = await notificationService.sendEmail(
    parsed.data.to,
    subject,
    '<p>This is a test email from <strong>SAMS</strong>. SMTP is working correctly.</p>',
  );

  if (!result.ok) {
    res.status(502).json({ error: result.error || 'Email send failed', code: 'EMAIL_SEND_FAILED' });
    return;
  }

  res.status(200).json({ success: true });
});

/**
 * GET /api/v1/notifications/attachments/:id
 * Stream an attachment to a sender or recipient without relying on public /uploads.
 */
notificationsRouter.get('/attachments/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const attachment = await prisma.notificationAttachment.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!attachment || attachment.schoolId !== req.schoolId) {
      throw new AppError(404, 'NOT_FOUND', 'Attachment not found');
    }

    const visibleNotification = await prisma.notification.findFirst({
      where: {
        schoolId: req.schoolId,
        batchId: attachment.batchId,
        OR: [
          { userId: req.user.sub },
          { senderId: req.user.sub },
        ],
      },
      select: { id: true },
    });

    if (!visibleNotification) {
      throw new AppError(404, 'NOT_FOUND', 'Attachment not found');
    }

    const filePath = notificationAttachmentFilePath(
      attachment.schoolId,
      attachment.batchId,
      attachment.storedName,
    );
    await fs.promises.access(filePath, fs.constants.R_OK);

    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${safeHeaderFileName(attachment.fileName)}"`,
    );
    res.sendFile(filePath, (err) => {
      if (err) next(new AppError(404, 'NOT_FOUND', 'Attachment file not found'));
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to load attachment'));
  }
});

/**
 * GET /api/v1/notifications/sent
 * Get notifications sent by the current user, with recipient count per batch.
 */
notificationsRouter.get('/sent', async (req: Request, res: Response): Promise<void> => {
  try {
    const senderId = req.user.sub;

    const sentNotifications = await prisma.notification.findMany({
      where: { senderId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Group by batchId, keeping only the first (representative) per batch
    const seen = new Set<string>();
    const batches: any[] = [];
    for (const n of sentNotifications) {
      const key = n.batchId ?? n.id;
      if (!seen.has(key)) {
        seen.add(key);
        batches.push(n);
      }
    }

    const attachmentMap = await loadAttachmentsByBatch(
      batches.map((n) => n.batchId ?? n.id).filter(Boolean),
      req.schoolId,
    );

    // For each batch, count recipients
    const enriched = await Promise.all(
      batches.map(async (n) => {
        const key = n.batchId ?? n.id;
        const recipientCount = n.batchId
          ? await prisma.notification.count({ where: { batchId: n.batchId } })
          : 1;
        const targetScopeLabel = await resolveTargetScopeLabel(n.scope, n.targetId, n.targetRole);
        return { ...n, recipientCount, targetScopeLabel, attachments: attachmentMap.get(key) ?? [] };
      }),
    );

    res.status(200).json(enriched);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to fetch sent notifications');
  }
});

/**
 * GET /api/v1/notifications/support-thread
 * School admins can see their direct support conversation with Super Admin.
 */
notificationsRouter.get('/support-thread', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'SCHOOL_ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only school admins can open Super Admin support');
  }

  const notifications = await prisma.notification.findMany({
    where: {
      schoolId: req.schoolId,
      type: SUPER_SUPPORT_NOTIFICATION_TYPE,
      OR: [
        { userId: req.user.sub },
        { senderId: req.user.sub },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  const senderIds = [...new Set(
    notifications.map((n) => n.senderId).filter((id): id is string => id !== null),
  )];
  const senders = senderIds.length
    ? await prisma.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, fullName: true, role: true },
      })
    : [];
  const senderMap = new Map(senders.map((s) => [s.id, { name: s.fullName, role: s.role }]));

  res.status(200).json(notifications.map((n) => {
    const sender = n.senderId ? senderMap.get(n.senderId) : null;
    return {
      ...n,
      senderName: sender?.name ?? (n.senderId ? 'SAMS Super Admin' : 'System'),
      senderRole: sender?.role ?? (n.senderId ? 'SUPER_ADMIN' : null),
      isMine: n.senderId === req.user.sub,
    };
  }));
});

/**
 * POST /api/v1/notifications/support
 * School admins send a direct in-app support message to Super Admin.
 */
notificationsRouter.post('/support', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'SCHOOL_ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only school admins can contact Super Admin support');
  }

  const parsed = supportNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const recipientId = await getSuperAdminRecipientId();
  if (!recipientId) {
    throw new AppError(503, 'SUPER_ADMIN_NOT_READY', 'Super Admin account is not ready yet');
  }

  const sender = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { fullName: true, school: { select: { name: true, schoolCode: true } } },
  });
  const batchId = createId();
  const title = `Support from ${sender?.school?.name ?? 'School Admin'}`;

  const notification = await prisma.notification.create({
    data: {
      schoolId: req.schoolId,
      userId: recipientId,
      senderId: req.user.sub,
      batchId,
      title,
      message: parsed.data.message,
      type: SUPER_SUPPORT_NOTIFICATION_TYPE,
      scope: 'support',
      targetId: req.schoolId,
      targetRole: 'SUPER_ADMIN',
    },
  });

  res.status(200).json({ success: true, notification });

  emitNotificationToUser(recipientId, {
    id: notification.id,
    title,
    message: notification.message,
    type: SUPER_SUPPORT_NOTIFICATION_TYPE,
    senderId: req.user.sub,
    senderName: sender?.fullName ?? 'School Admin',
    senderRole: 'SCHOOL_ADMIN',
    schoolName: sender?.school?.name,
    schoolCode: sender?.school?.schoolCode,
    batchId,
  });
});

/**
 * GET /api/v1/notifications
 * Get the current user's in-app notifications with sender name + role resolution.
 */
notificationsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Resolve sender names in a single query
    const senderIds = [...new Set(
      notifications.map((n) => n.senderId).filter((id): id is string => id !== null),
    )];

    const senders = senderIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: senderIds } },
          select: { id: true, fullName: true, role: true },
        })
      : [];

    const senderMap = new Map<string, { name: string; role: string }>(
      senders.map((s) => [s.id, { name: s.fullName, role: s.role }]),
    );
    const attachmentMap = await loadAttachmentsByBatch(
      notifications.map((n) => n.batchId ?? n.id).filter(Boolean),
      req.schoolId,
    );

    const enriched = await Promise.all(
      notifications.map(async (n) => {
      let senderName: string;
      let senderRole: string | null = null;

      if (n.senderId === null) {
        senderName = 'System';
      } else {
        const sender = senderMap.get(n.senderId);
        if (sender) {
          senderName = sender.name || 'Unknown';
          senderRole = sender.role;
        } else {
          senderName = 'Deleted User';
        }
      }

      const targetScopeLabel = await resolveTargetScopeLabel(n.scope, n.targetId, n.targetRole);
      const attachmentKey = n.batchId ?? n.id;

      return {
        ...n,
        senderName,
        senderRole,
        targetScopeLabel,
        attachments: attachmentMap.get(attachmentKey) ?? [],
      };
    }),
    );

    res.status(200).json(enriched);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to fetch notifications');
  }
});

/**
 * GET /api/v1/notifications/unread-count
 * Returns the count of unread notifications for the current user.
 */
notificationsRouter.get('/unread-count', async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.sub, read: false },
    });
    res.status(200).json({ count });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to fetch unread count');
  }
});

/**
 * PATCH /api/v1/notifications/read-all
 * Mark all of the current user's notifications as read.
 */
notificationsRouter.patch('/read-all', async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.sub, read: false },
      data: { read: true },
    });
    res.status(200).json({ success: true });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to mark all as read');
  }
});

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a single notification as read.
 */
notificationsRouter.patch('/:id/read', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification || notification.userId !== req.user.sub) {
      throw new AppError(404, 'NOT_FOUND', 'Notification not found');
    }

    await prisma.notification.update({ where: { id }, data: { read: true } });
    res.status(200).json({ success: true });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to mark notification as read');
  }
});

/**
 * PATCH /api/v1/notifications/:id
 * Edit a notification's message. Updates all notifications in the same batch.
 * Only the original sender can edit (admins bypass the 24h window).
 * Does NOT create new notification rows — only updates existing ones.
 */
notificationsRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = editNotificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const { message } = parsed.data;
    const id = String(req.params.id);

    // Must be the sender's outbound copy (prevents editing admin/HOD messages via inbox row ids)
    const notification = await prisma.notification.findFirst({
      where: { id, senderId: req.user.sub },
    });
    if (!notification) {
      throw new AppError(403, 'FORBIDDEN', 'You can only edit notifications you sent');
    }

    const isSchoolAdmin = req.user.role === 'SCHOOL_ADMIN';
    if (!isSchoolAdmin) {
      const hoursSince = (Date.now() - notification.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSince > 24) {
        throw new AppError(403, 'WINDOW_EXPIRED', 'Notifications can only be edited within 24 hours of sending');
      }
    }

    const now = new Date();

    // Update all notifications in the same batch (or just this one if no batch)
    if (notification.batchId) {
      await prisma.notification.updateMany({
        where: { batchId: notification.batchId, senderId: notification.senderId },
        data: { message, updatedAt: now },
      });

      // Emit real-time update to affected users via socket (no new DB rows)
      const affected = await prisma.notification.findMany({
        where: { batchId: notification.batchId, senderId: notification.senderId },
        select: { userId: true, id: true },
      });
      for (const n of affected) {
        getSocketIO().to(`user:${n.userId}`).emit('notification:updated', {
          id: n.id,
          message,
          updatedAt: now.toISOString(),
        });
      }
    } else {
      await prisma.notification.update({ where: { id }, data: { message, updatedAt: now } });
      getSocketIO().to(`user:${notification.userId}`).emit('notification:updated', {
        id,
        message,
        updatedAt: now.toISOString(),
      });
    }

    const updated = await prisma.notification.findUnique({ where: { id } });
    res.status(200).json(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to edit notification');
  }
});

/**
 * DELETE /api/v1/notifications/batch/:batchId
 * Delete all notifications in a batch. Only the original sender or admin can do this.
 * MUST be registered before DELETE /:id to avoid Express matching "batch" as an :id.
 */
notificationsRouter.delete('/batch/:batchId', async (req: Request, res: Response): Promise<void> => {
  const batchId = String(req.params.batchId);

  try {
    const batchNotification = await prisma.notification.findFirst({
      where: { batchId, senderId: req.user.sub },
    });
    if (!batchNotification) {
      throw new AppError(403, 'FORBIDDEN', 'You can only delete notifications you sent');
    }

    const isSchoolAdmin = req.user.role === 'SCHOOL_ADMIN';
    if (!isSchoolAdmin) {
      const hoursSince = (Date.now() - batchNotification.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSince > 24) {
        throw new AppError(403, 'WINDOW_EXPIRED', 'Notifications can only be deleted within 24 hours of sending');
      }
    }

    await prisma.notification.deleteMany({ where: { batchId, senderId: req.user.sub } });
    await deleteAttachmentsForBatch(batchId, req.user.sub);

    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete notification batch');
  }
});

/**
 * DELETE /api/v1/notifications/:id
 * Delete a single notification (for non-batched system notifications).
 * Users can only delete their own received notifications.
 */
notificationsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification) throw new AppError(404, 'NOT_FOUND', 'Notification not found');

    const isRecipient = notification.userId === req.user.sub;
    const isSender = notification.senderId === req.user.sub;

    // Recipients may remove from their inbox; senders use batch delete for outbound messages
    if (isRecipient && !isSender) {
      await prisma.notification.delete({ where: { id } });
      res.status(204).send();
      return;
    }

    if (!isSender) {
      throw new AppError(403, 'FORBIDDEN', 'You cannot delete this notification');
    }

    await prisma.notification.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete notification');
  }
});

/**
 * POST /api/v1/notifications/reply
 * Class representatives may reply to teachers who teach their class.
 */
notificationsRouter.post('/reply', async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.user.role !== 'STUDENT') {
      throw new AppError(403, 'FORBIDDEN', 'Only students can use direct reply');
    }

    const student = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { isClassRep: true, classId: true, fullName: true },
    });
    if (!student?.isClassRep) {
      throw new AppError(403, 'FORBIDDEN', 'Only class representatives can reply to teachers');
    }
    if (!student.classId) {
      throw new AppError(403, 'FORBIDDEN', 'You are not assigned to a class');
    }

    const parsed = replyNotificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const { parentNotificationId, message } = parsed.data;
    const parent = await prisma.notification.findUnique({ where: { id: parentNotificationId } });
    if (!parent || parent.userId !== req.user.sub) {
      throw new AppError(404, 'NOT_FOUND', 'Message not found');
    }
    if (!parent.senderId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cannot reply to system messages');
    }

    const sender = await prisma.user.findUnique({
      where: { id: parent.senderId },
      select: { role: true },
    });
    if (!sender || sender.role !== 'TEACHER') {
      throw new AppError(403, 'FORBIDDEN', 'You can only reply to teachers');
    }

    const allowedTeachers = await getTeachersForClass(student.classId);
    if (!allowedTeachers.includes(parent.senderId)) {
      throw new AppError(403, 'FORBIDDEN', 'You can only reply to teachers who teach your class');
    }

    const batchId = createId();
    const title = `Reply from ${student.fullName} (Class Rep)`;

    await prisma.notification.create({
      data: {
        schoolId: req.schoolId,
        userId: parent.senderId,
        senderId: req.user.sub,
        batchId,
        title,
        message,
        type: 'MESSAGE',
        scope: 'class',
        targetId: student.classId,
        targetRole: 'TEACHER',
      },
    });

    res.status(200).json({ success: true, batchId });

    setImmediate(() => {
      getSocketIO().to(`user:${parent.senderId}`).emit('notification:new', {
        title,
        message,
        type: 'MESSAGE',
        senderId: req.user.sub,
        batchId,
        timestamp: new Date().toISOString(),
      });
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to send reply');
  }
});

/**
 * POST /api/v1/notifications/send
 * Send a notification to a scoped group of users.
 *
 * Scope + targetRole combinations:
 *   school                        → all users in school (admin only)
 *   school + targetRole=TEACHER   → all teachers in school
 *   school + targetRole=STUDENT   → all students in school
 *   department + targetId         → all users in dept
 *   department + targetId + targetRole=TEACHER → teachers in dept only
 *   department + targetId + targetRole=STUDENT → students in dept only
 *   class + targetId              → all users in class
 *   class + targetId + targetRole=STUDENT → students in class only
 *
 * Role permissions:
 *   SCHOOL_ADMIN → school / department / class, any targetRole
 *   HOD          → their department / classes within it, any targetRole
 *   TEACHER      → their own class, targetRole=STUDENT only
 */
notificationsRouter.post('/send', uploadNotificationAttachments, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = sendNotificationSchema.safeParse(normalizeSendNotificationBody(req.body));
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const { scope, targetId, targetRole, message, channels } = parsed.data;
    const title = parsed.data.title || 'New Message';

    if (!channels.includes('inapp') && channels.includes('sms')) {
      console.warn(
        `[Notifications] Send by ${req.user.sub}: SMS-only (no in-app). AT sandbox may not deliver to real numbers.`,
      );
    }

    const result = await sendScopedNotification(req.user, {
      scope,
      targetId,
      targetRole,
      title,
      message,
      channels,
    });

    if (!result.success) {
      res.status(200).json({
        success: false,
        recipientCount: result.recipientCount,
        batchId: result.batchId,
        warning: result.warning,
      });
      return;
    }

    const attachments = await saveNotificationAttachments(
      uploadedNotificationFiles(req),
      req.schoolId,
      req.user.sub,
      result.batchId,
    );

    res.status(200).json({
      success: true,
      recipientCount: result.recipientCount,
      batchId: result.batchId,
      attachments,
    });
  } catch (err) {
    if (err instanceof ScopedNotificationError) {
      next(new AppError(err.statusCode, err.code, err.message));
      return;
    }
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to send notification'));
  }
});
