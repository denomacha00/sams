"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const cuid2_1 = require("@paralleldrive/cuid2");
const index_1 = require("../index");
const notificationService_1 = require("../services/notificationService");
const errors_1 = require("../middleware/errors");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const sendNotificationSchema = zod_1.z.object({
    scope: zod_1.z.enum(['school', 'department', 'class']),
    targetId: zod_1.z.string().optional(),
    message: zod_1.z.string().min(1).max(1000),
    channels: zod_1.z.array(zod_1.z.enum(['inapp', 'sms'])).min(1),
});
const editNotificationSchema = zod_1.z.object({
    message: zod_1.z.string().min(1).max(1000),
});
// ─── Router ───────────────────────────────────────────────────────────────────
exports.notificationsRouter = (0, express_1.Router)();
/**
 * GET /api/v1/notifications
 * Get the current user's in-app notifications with sender name resolution.
 */
exports.notificationsRouter.get('/', async (req, res) => {
    try {
        const notifications = await index_1.prisma.notification.findMany({
            where: { userId: req.user.sub },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        // Collect unique senderIds to resolve names in a single query
        const senderIds = [...new Set(notifications
                .map((n) => n.senderId)
                .filter((id) => id !== null))];
        const senders = senderIds.length > 0
            ? await index_1.prisma.user.findMany({
                where: { id: { in: senderIds } },
                select: { id: true, fullName: true },
            })
            : [];
        const senderMap = new Map(senders.map((s) => [s.id, s.fullName]));
        const enrichedNotifications = notifications.map((n) => {
            let senderName;
            if (n.senderId === null) {
                senderName = 'System';
            }
            else if (senderMap.has(n.senderId)) {
                senderName = senderMap.get(n.senderId);
            }
            else {
                senderName = 'Deleted User';
            }
            return {
                ...n,
                senderId: n.senderId,
                senderName,
                batchId: n.batchId,
                updatedAt: n.updatedAt,
            };
        });
        res.status(200).json(enrichedNotifications);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to fetch notifications');
    }
});
/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a notification as read.
 */
exports.notificationsRouter.patch('/:id/read', async (req, res) => {
    try {
        const id = String(req.params.id);
        const notification = await index_1.prisma.notification.findUnique({
            where: { id },
        });
        if (!notification || notification.userId !== req.user.sub) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Notification not found');
        }
        await index_1.prisma.notification.update({
            where: { id },
            data: { read: true },
        });
        res.status(200).json({ success: true });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to mark notification as read');
    }
});
/**
 * PATCH /api/v1/notifications/:id
 * Edit a notification's message. Only the original sender can edit within 24 hours.
 * Updates all notifications sharing the same batchId and senderId.
 */
exports.notificationsRouter.patch('/:id', async (req, res) => {
    const parsed = editNotificationSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    const { message } = parsed.data;
    const id = String(req.params.id);
    try {
        const notification = await index_1.prisma.notification.findUnique({
            where: { id },
        });
        if (!notification) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Notification not found');
        }
        // Verify sender ownership
        if (notification.senderId !== req.user.sub) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'You can only edit notifications you sent');
        }
        // Check 24-hour modification window
        const hoursSinceCreation = (Date.now() - notification.createdAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCreation > 24) {
            throw new errors_1.AppError(403, 'WINDOW_EXPIRED', 'Notifications can only be edited within 24 hours of sending');
        }
        // Update all notifications in the same batch from the same sender
        const now = new Date();
        if (notification.batchId) {
            await index_1.prisma.notification.updateMany({
                where: {
                    batchId: notification.batchId,
                    senderId: notification.senderId,
                },
                data: {
                    message,
                    updatedAt: now,
                },
            });
        }
        else {
            // If no batchId, just update this single notification
            await index_1.prisma.notification.update({
                where: { id },
                data: {
                    message,
                    updatedAt: now,
                },
            });
        }
        // Fetch the updated notification to return
        const updated = await index_1.prisma.notification.findUnique({ where: { id } });
        // Emit socket event to affected recipients for real-time update
        if (notification.batchId) {
            const affectedNotifications = await index_1.prisma.notification.findMany({
                where: {
                    batchId: notification.batchId,
                    senderId: notification.senderId,
                },
                select: { userId: true },
            });
            for (const n of affectedNotifications) {
                notificationService_1.notificationService.sendInApp(n.userId, {
                    title: 'Notification Updated',
                    message,
                    type: 'NOTIFICATION_UPDATED',
                });
            }
        }
        res.status(200).json(updated);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to edit notification');
    }
});
/**
 * DELETE /api/v1/notifications/batch/:batchId
 * Delete all notifications in a batch. Only the original sender can delete within 24 hours.
 */
exports.notificationsRouter.delete('/batch/:batchId', async (req, res) => {
    const batchId = String(req.params.batchId);
    try {
        // Find at least one notification in this batch to verify ownership
        const batchNotification = await index_1.prisma.notification.findFirst({
            where: { batchId },
        });
        if (!batchNotification) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Batch not found');
        }
        // Verify sender ownership
        if (batchNotification.senderId !== req.user.sub) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'You can only delete notifications you sent');
        }
        // Check 24-hour modification window
        const hoursSinceCreation = (Date.now() - batchNotification.createdAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCreation > 24) {
            throw new errors_1.AppError(403, 'WINDOW_EXPIRED', 'Notifications can only be deleted within 24 hours of sending');
        }
        // Delete all notifications matching batchId and senderId
        await index_1.prisma.notification.deleteMany({
            where: {
                batchId,
                senderId: req.user.sub,
            },
        });
        res.status(204).send();
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to delete notification batch');
    }
});
/**
 * POST /api/v1/notifications/send
 * Send a notification/message to a scope of users.
 * Admin can send to: whole school, specific department, specific class
 * HOD can send to: their department, specific class
 * Teacher can send to: their class students
 */
exports.notificationsRouter.post('/send', async (req, res) => {
    const allowedRoles = ['SCHOOL_ADMIN', 'HOD', 'TEACHER'];
    if (!allowedRoles.includes(req.user.role)) {
        throw new errors_1.AppError(403, 'FORBIDDEN', 'You do not have permission to send notifications');
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
        // Generate a batchId for this send operation
        const batchId = (0, cuid2_1.createId)();
        // Build the user filter based on scope
        const userFilter = { schoolId: req.schoolId };
        if (scope === 'department') {
            if (!targetId)
                throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'targetId is required for department scope');
            userFilter.departmentId = targetId;
        }
        else if (scope === 'class') {
            if (!targetId)
                throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'targetId is required for class scope');
            userFilter.classId = targetId;
        }
        // scope === 'school' → all users in the school
        // Enforce role-based scope restrictions
        if (req.user.role === 'HOD') {
            if (scope === 'school') {
                throw new errors_1.AppError(403, 'FORBIDDEN', 'HODs can only send to their department or classes');
            }
            // HOD can only target their own department
            if (scope === 'department' && targetId !== req.user.departmentId) {
                throw new errors_1.AppError(403, 'FORBIDDEN', 'HODs can only send to their own department');
            }
        }
        else if (req.user.role === 'TEACHER') {
            if (scope !== 'class') {
                throw new errors_1.AppError(403, 'FORBIDDEN', 'Teachers can only send to their class');
            }
        }
        // Get target users
        const targetUsers = await index_1.prisma.user.findMany({
            where: userFilter,
            select: { id: true, phone: true, email: true },
        });
        // Create in-app notifications with senderId and batchId
        if (channels.includes('inapp')) {
            const notificationData = targetUsers.map((u) => ({
                schoolId: req.schoolId,
                userId: u.id,
                senderId: req.user.sub,
                batchId,
                title: 'New Message',
                message,
                type: 'MESSAGE',
            }));
            await index_1.prisma.notification.createMany({ data: notificationData });
            // Also emit via socket for real-time
            for (const u of targetUsers) {
                await notificationService_1.notificationService.sendInApp(u.id, {
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
                notificationService_1.notificationService.sendSMS(u.phone, message).catch(() => { });
            }
        }
        res.status(200).json({
            success: true,
            recipientCount: targetUsers.length,
            batchId,
        });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to send notification');
    }
});
//# sourceMappingURL=notifications.js.map