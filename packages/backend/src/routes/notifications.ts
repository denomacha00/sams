import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../index';
import { io } from '../index';
import { AppError } from '../middleware/errors';

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

// ─── Router ───────────────────────────────────────────────────────────────────

export const notificationsRouter = Router();

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
        return { ...n, recipientCount };
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

    const enriched = notifications.map((n) => {
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

      return { ...n, senderName, senderRole };
    });

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

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new AppError(404, 'NOT_FOUND', 'Notification not found');

    const isAdmin = req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'HOD';
    if (!isAdmin && notification.senderId !== req.user.sub) {
      throw new AppError(403, 'FORBIDDEN', 'You can only edit notifications you sent');
    }

    if (!isAdmin) {
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
    const batchNotification = await prisma.notification.findFirst({ where: { batchId } });
    if (!batchNotification) throw new AppError(404, 'NOT_FOUND', 'Batch not found');

    const isAdmin = req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'HOD';
    if (!isAdmin && batchNotification.senderId !== req.user.sub) {
      throw new AppError(403, 'FORBIDDEN', 'You can only delete notifications you sent');
    }

    if (!isAdmin) {
      const hoursSince = (Date.now() - batchNotification.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSince > 24) {
        throw new AppError(403, 'WINDOW_EXPIRED', 'Notifications can only be deleted within 24 hours of sending');
      }
    }

    if (isAdmin) {
      await prisma.notification.deleteMany({ where: { batchId } });
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

    const isAdmin = req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'HOD';
    const isRecipient = notification.userId === req.user.sub;
    const isSender = notification.senderId === req.user.sub;

    if (!isAdmin && !isRecipient && !isSender) {
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

    const { scope, targetId, targetRole, message, channels } = parsed.data;
    const title = parsed.data.title || 'New Message';
    const batchId = createId();

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
      res.status(200).json({ success: true, recipientCount: 0, batchId });
      return;
    }

    // ── In-app: bulk insert once (no duplicate via sendInApp) ──────────────
    if (channels.includes('inapp')) {
      await prisma.notification.createMany({
        data: targetUsers.map((u) => ({
          schoolId: req.schoolId,
          userId: u.id,
          senderId: req.user.sub,
          batchId,
          title,
          message,
          type: 'MESSAGE',
        })),
      });

      // Emit real-time socket event to each recipient (no extra DB write)
      for (const u of targetUsers) {
        io.to(`user:${u.id}`).emit('notification:new', {
          title,
          message,
          type: 'MESSAGE',
          senderId: req.user.sub,
          batchId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ── SMS: fire-and-forget ───────────────────────────────────────────────
    if (channels.includes('sms')) {
      const { notificationService } = await import('../services/notificationService');
      const usersWithPhone = targetUsers.filter((u) => u.phone);
      for (const u of usersWithPhone) {
        notificationService.sendSMS(u.phone!, message).catch(() => {});
      }
    }

    res.status(200).json({ success: true, recipientCount: targetUsers.length, batchId });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to send notification');
  }
});
