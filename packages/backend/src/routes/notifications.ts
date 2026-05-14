import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { notificationService } from '../services/notificationService';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const sendNotificationSchema = z.object({
  scope: z.enum(['school', 'department', 'class']),
  targetId: z.string().optional(),
  message: z.string().min(1).max(1000),
  channels: z.array(z.enum(['inapp', 'sms'])).min(1),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const notificationsRouter = Router();

/**
 * GET /api/v1/notifications
 * Get the current user's in-app notifications.
 */
notificationsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.status(200).json(notifications);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to fetch notifications');
  }
});

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a notification as read.
 */
notificationsRouter.patch('/:id/read', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification || notification.userId !== req.user.sub) {
      throw new AppError(404, 'NOT_FOUND', 'Notification not found');
    }

    await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    res.status(200).json({ success: true });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to mark notification as read');
  }
});

/**
 * POST /api/v1/notifications/send
 * Send a notification/message to a scope of users.
 * Admin can send to: whole school, specific department, specific class
 * HOD can send to: their department, specific class
 * Teacher can send to: their class students
 */
notificationsRouter.post('/send', async (req: Request, res: Response): Promise<void> => {
  const allowedRoles = ['SCHOOL_ADMIN', 'HOD', 'TEACHER'];
  if (!allowedRoles.includes(req.user.role)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to send notifications');
  }

  const parsed = sendNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { scope, targetId, message, channels } = parsed.data;

  try {
    // Build the user filter based on scope
    const userFilter: any = { schoolId: req.schoolId };

    if (scope === 'department') {
      if (!targetId) throw new AppError(400, 'VALIDATION_ERROR', 'targetId is required for department scope');
      userFilter.departmentId = targetId;
    } else if (scope === 'class') {
      if (!targetId) throw new AppError(400, 'VALIDATION_ERROR', 'targetId is required for class scope');
      userFilter.classId = targetId;
    }
    // scope === 'school' → all users in the school

    // Enforce role-based scope restrictions
    if (req.user.role === 'HOD') {
      if (scope === 'school') {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only send to their department or classes');
      }
      // HOD can only target their own department
      if (scope === 'department' && targetId !== req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only send to their own department');
      }
    } else if (req.user.role === 'TEACHER') {
      if (scope !== 'class') {
        throw new AppError(403, 'FORBIDDEN', 'Teachers can only send to their class');
      }
    }

    // Get target users
    const targetUsers = await prisma.user.findMany({
      where: userFilter,
      select: { id: true, phone: true, email: true },
    });

    // Create in-app notifications
    if (channels.includes('inapp')) {
      const notificationData = targetUsers.map((u) => ({
        schoolId: req.schoolId,
        userId: u.id,
        title: 'New Message',
        message,
        type: 'MESSAGE',
      }));

      await prisma.notification.createMany({ data: notificationData });

      // Also emit via socket for real-time
      for (const u of targetUsers) {
        await notificationService.sendInApp(u.id, {
          title: 'New Message',
          message,
          type: 'MESSAGE',
        });
      }
    }

    // Send SMS
    if (channels.includes('sms')) {
      const usersWithPhone = targetUsers.filter((u) => u.phone);
      for (const u of usersWithPhone) {
        // Fire and forget — don't block the response
        notificationService.sendSMS(u.phone!, message).catch(() => {});
      }
    }

    res.status(200).json({
      success: true,
      recipientCount: targetUsers.length,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to send notification');
  }
});
