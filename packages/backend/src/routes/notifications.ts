import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../index';
import { io } from '../index';
import { AppError } from '../middleware/errors';

const NOTIFICATION_INSERT_CHUNK = 500;
/** Cap parallel SMS attempts so whole-school sends do not spawn hundreds of 60s retries */
const SMS_MAX_RECIPIENTS = 25;

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

const testSmsSchema = z.object({
  phone: z.string().min(9).max(20),
  message: z.string().min(1).max(160).optional(),
});

const testEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200).optional(),
});

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
    res.status(502).json({
      error: result.error || 'SMS send failed',
      code: 'SMS_SEND_FAILED',
      sandbox: status.sandbox,
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

    // For each batch, count recipients
    const enriched = await Promise.all(
      batches.map(async (n) => {
        const recipientCount = n.batchId
          ? await prisma.notification.count({ where: { batchId: n.batchId } })
          : 1;
        const targetScopeLabel = await resolveTargetScopeLabel(n.scope, n.targetId, n.targetRole);
        return { ...n, recipientCount, targetScopeLabel };
      }),
    );

    res.status(200).json(enriched);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to fetch sent notifications');
  }
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

      return { ...n, senderName, senderRole, targetScopeLabel };
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
        io.to(`user:${n.userId}`).emit('notification:updated', {
          id: n.id,
          message,
          updatedAt: now.toISOString(),
        });
      }
    } else {
      await prisma.notification.update({ where: { id }, data: { message, updatedAt: now } });
      io.to(`user:${notification.userId}`).emit('notification:updated', {
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

    if (isSchoolAdmin) {
      await prisma.notification.deleteMany({ where: { batchId, senderId: req.user.sub } });
    } else {
      await prisma.notification.deleteMany({ where: { batchId, senderId: req.user.sub } });
    }

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

    const isSchoolAdmin = req.user.role === 'SCHOOL_ADMIN';
    const isRecipient = notification.userId === req.user.sub;
    const isSender = notification.senderId === req.user.sub;

    // Recipients may remove from their inbox; senders use batch delete for outbound messages
    if (isRecipient && !isSender) {
      await prisma.notification.delete({ where: { id } });
      res.status(204).send();
      return;
    }

    if (!isSchoolAdmin && !isSender) {
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
      io.to(`user:${parent.senderId}`).emit('notification:new', {
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
notificationsRouter.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const allowedRoles = ['SCHOOL_ADMIN', 'HOD', 'TEACHER'];
    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to send notifications');
    }

    const parsed = sendNotificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      return;
    }

    let { scope, targetId, targetRole, message, channels } = parsed.data;
    const title = parsed.data.title || 'New Message';
    const batchId = createId();

    // Teachers: default to their assigned class when none selected in the UI
    if (req.user.role === 'TEACHER' && scope === 'class' && !targetId && req.user.classId) {
      targetId = req.user.classId;
    }

    // ── Build user filter ──────────────────────────────────────────────────
    const userFilter: any = { schoolId: req.schoolId };

    if (scope === 'department') {
      if (!targetId) throw new AppError(400, 'VALIDATION_ERROR', 'targetId is required for department scope');
      userFilter.departmentId = targetId;
    } else if (scope === 'class') {
      if (!targetId) throw new AppError(400, 'VALIDATION_ERROR', 'targetId is required for class scope');
      userFilter.classId = targetId;
    }

    // Apply role filter if specified
    if (targetRole) {
      userFilter.role = targetRole;
    }

    // ── Role-based scope enforcement ───────────────────────────────────────
    if (req.user.role === 'HOD') {
      if (scope === 'school') {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only send to their department or classes within it');
      }
      if (scope === 'department' && targetId !== req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only send to their own department');
      }
      if (scope === 'class' && targetId) {
        const classRecord = await prisma.class.findUnique({ where: { id: targetId }, select: { departmentId: true } });
        if (!classRecord || classRecord.departmentId !== req.user.departmentId) {
          throw new AppError(403, 'FORBIDDEN', 'HODs can only send to classes in their own department');
        }
      }
    } else if (req.user.role === 'TEACHER') {
      if (scope !== 'class') {
        throw new AppError(403, 'FORBIDDEN', 'Teachers can only send to their class');
      }
      if (!req.user.classId) {
        throw new AppError(403, 'FORBIDDEN', 'You are not assigned to a class');
      }
      if (targetId !== req.user.classId) {
        throw new AppError(403, 'FORBIDDEN', 'Teachers can only send notifications to their own class');
      }
      // Teachers can only message students
      if (targetRole && targetRole !== 'STUDENT') {
        throw new AppError(403, 'FORBIDDEN', 'Teachers can only send notifications to students');
      }
      // Force student-only if no targetRole specified
      if (!targetRole) {
        userFilter.role = 'STUDENT';
      }
    }

    // ── Fetch target users ─────────────────────────────────────────────────
    const targetUsers = await prisma.user.findMany({
      where: userFilter,
      select: { id: true, phone: true },
    });

    if (targetUsers.length === 0) {
      res.status(200).json({
        success: false,
        recipientCount: 0,
        batchId,
        warning:
          'No users matched this target. Check that students/teachers are assigned to the selected class or department, and that the role filter is not too narrow.',
      });
      return;
    }

    if (!channels.includes('inapp') && channels.includes('sms')) {
      console.warn(
        `[Notifications] Send by ${req.user.sub}: SMS-only (no in-app). ${targetUsers.length} target(s); AT sandbox may not deliver to real numbers.`,
      );
    }

    // ── In-app: chunked bulk insert (whole-school can be hundreds of rows) ─
    if (channels.includes('inapp')) {
      const rows = targetUsers.map((u) => ({
        schoolId: req.schoolId,
        userId: u.id,
        senderId: req.user.sub,
        batchId,
        title,
        message,
        type: 'MESSAGE',
        scope,
        targetId: targetId ?? null,
        targetRole: targetRole ?? null,
      }));
      for (let i = 0; i < rows.length; i += NOTIFICATION_INSERT_CHUNK) {
        await prisma.notification.createMany({
          data: rows.slice(i, i + NOTIFICATION_INSERT_CHUNK),
        });
      }
    }

    const recipientCount = targetUsers.length;
    const schoolId = req.schoolId;
    const senderId = req.user.sub;
    const payload = {
      title,
      message,
      type: 'MESSAGE' as const,
      senderId,
      batchId,
      timestamp: new Date().toISOString(),
    };

    // Respond immediately — do not block on sockets/SMS (fixes "Sending..." forever)
    res.status(200).json({ success: true, recipientCount, batchId });

    setImmediate(() => {
      try {
        if (channels.includes('inapp')) {
          // One broadcast per school (all connected clients joined school:{id} on connect)
          io.to(`school:${schoolId}`).emit('notification:new', payload);
        }
        if (channels.includes('sms')) {
          void import('../services/notificationService').then(({ notificationService }) => {
            const usersWithPhone = targetUsers.filter((u) => u.phone).slice(0, SMS_MAX_RECIPIENTS);
            if (targetUsers.filter((u) => u.phone).length > SMS_MAX_RECIPIENTS) {
              console.warn(
                `[Notifications] SMS capped at ${SMS_MAX_RECIPIENTS} of ${targetUsers.length} users with phone numbers`,
              );
            }
            for (const u of usersWithPhone) {
              void notificationService.sendSMS(u.phone!, message).catch(() => {});
            }
          }).catch((err) => console.error('[Notifications] SMS module load failed:', err));
        }
      } catch (bgErr) {
        console.error('[Notifications] Background delivery error:', bgErr);
      }
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to send notification');
  }
});
