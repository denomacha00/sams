import { createId } from '@paralleldrive/cuid2';
import { UserRole, type AccessTokenPayload } from '@sams/shared';
import {
  HOD_DEPARTMENT_UNLINKED_MESSAGE,
  resolveHodDepartmentId,
} from '../lib/hodScope';
import { prisma } from '../lib/prisma';
import { getSocketIO } from '../lib/socket';
import { resolveTeacherTeachingClassIds } from '../lib/teacherScope';

const NOTIFICATION_INSERT_CHUNK = 500;
const SMS_MAX_RECIPIENTS = 25;

export type NotificationScope = 'school' | 'department' | 'class';
export type NotificationTargetRole = 'TEACHER' | 'STUDENT' | 'HOD' | 'SCHOOL_ADMIN';
export type NotificationChannel = 'inapp' | 'sms';

export interface SendScopedNotificationInput {
  scope: NotificationScope;
  targetId?: string;
  targetRole?: NotificationTargetRole;
  title?: string;
  message: string;
  channels: NotificationChannel[];
}

export interface SendScopedNotificationResult {
  success: boolean;
  recipientCount: number;
  batchId: string;
  warning?: string;
}

export class ScopedNotificationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ScopedNotificationError';
  }
}

/** Mirrors POST /notifications/send RBAC — shared by HTTP routes and AI handlers. */
export async function sendScopedNotification(
  sender: Pick<AccessTokenPayload, 'sub' | 'role' | 'schoolId' | 'departmentId' | 'classId'>,
  input: SendScopedNotificationInput,
): Promise<SendScopedNotificationResult> {
  const allowedRoles: string[] = [UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER];
  if (!allowedRoles.includes(sender.role)) {
    throw new ScopedNotificationError(403, 'FORBIDDEN', 'You do not have permission to send notifications');
  }

  const hodDepartmentId =
    sender.role === UserRole.HOD ? await resolveHodDepartmentId(sender) : sender.departmentId;
  const effectiveSender =
    sender.role === UserRole.HOD
      ? { ...sender, departmentId: hodDepartmentId }
      : sender;

  let { scope, targetId, targetRole, message, channels } = input;
  const title = input.title?.trim() || 'New Message';
  const batchId = createId();

  if (!message?.trim()) {
    throw new ScopedNotificationError(400, 'VALIDATION_ERROR', 'message is required');
  }
  if (!channels.length) {
    throw new ScopedNotificationError(400, 'VALIDATION_ERROR', 'At least one channel is required');
  }

  const teacherClassIds =
    effectiveSender.role === UserRole.TEACHER
      ? await resolveTeacherTeachingClassIds(effectiveSender.sub, effectiveSender.classId)
      : [];

  if (effectiveSender.role === UserRole.TEACHER && scope === 'class' && !targetId) {
    if (teacherClassIds.length === 1) {
      targetId = teacherClassIds[0];
    } else if (teacherClassIds.length > 1) {
      throw new ScopedNotificationError(400, 'VALIDATION_ERROR', 'Choose one of your taught classes');
    }
  }

  if (effectiveSender.role === UserRole.HOD) {
    if (!hodDepartmentId) {
      throw new ScopedNotificationError(403, 'FORBIDDEN', HOD_DEPARTMENT_UNLINKED_MESSAGE);
    }
    if (scope === 'department' && !targetId) {
      targetId = hodDepartmentId;
    }
  }

  const userFilter: {
    schoolId: string;
    departmentId?: string;
    classId?: string;
    role?: UserRole;
  } = { schoolId: effectiveSender.schoolId };

  if (scope === 'department') {
    if (!targetId) {
      throw new ScopedNotificationError(400, 'VALIDATION_ERROR', 'targetId is required for department scope');
    }
    userFilter.departmentId = targetId;
  } else if (scope === 'class') {
    if (!targetId) {
      throw new ScopedNotificationError(400, 'VALIDATION_ERROR', 'targetId is required for class scope');
    }
    userFilter.classId = targetId;
  }

  if (targetRole) {
    userFilter.role = targetRole as UserRole;
  }

  if (effectiveSender.role === UserRole.HOD) {
    if (scope === 'school') {
      throw new ScopedNotificationError(
        403,
        'FORBIDDEN',
        'HODs can only send to their department or classes within it',
      );
    }
    if (scope === 'department' && targetId !== hodDepartmentId) {
      throw new ScopedNotificationError(403, 'FORBIDDEN', 'HODs can only send to their own department');
    }
    if (scope === 'class' && targetId) {
      const classRecord = await prisma.class.findUnique({
        where: { id: targetId },
        select: { departmentId: true },
      });
      if (!classRecord || classRecord.departmentId !== hodDepartmentId) {
        throw new ScopedNotificationError(
          403,
          'FORBIDDEN',
          'HODs can only send to classes in their own department',
        );
      }
    }
  } else if (effectiveSender.role === UserRole.TEACHER) {
    if (scope !== 'class') {
      throw new ScopedNotificationError(403, 'FORBIDDEN', 'Teachers can only send to classes they teach');
    }
    if (teacherClassIds.length === 0) {
      throw new ScopedNotificationError(403, 'FORBIDDEN', 'You are not assigned to any taught class');
    }
    if (!targetId || !teacherClassIds.includes(targetId)) {
      throw new ScopedNotificationError(
        403,
        'FORBIDDEN',
        'Teachers can only send notifications to classes they teach',
      );
    }
    if (targetRole && targetRole !== 'STUDENT') {
      throw new ScopedNotificationError(403, 'FORBIDDEN', 'Teachers can only send notifications to students');
    }
    if (!targetRole) {
      userFilter.role = UserRole.STUDENT;
    }
    if (channels.includes('sms')) {
      throw new ScopedNotificationError(
        403,
        'FORBIDDEN',
        'Teachers cannot send SMS via AI — use in-app messages or ask your school admin',
      );
    }
  }

  const targetUsers = (await prisma.user.findMany({
    where: userFilter,
    select: { id: true, phone: true },
  })).filter((u) => u.id !== effectiveSender.sub);

  if (targetUsers.length === 0) {
    return {
      success: false,
      recipientCount: 0,
      batchId,
      warning:
        'No users matched this target. Check that students/teachers are assigned to the selected class or department.',
    };
  }

  if (channels.includes('inapp')) {
    const rows = targetUsers.map((u) => ({
      schoolId: effectiveSender.schoolId,
      userId: u.id,
      senderId: effectiveSender.sub,
      batchId,
      title,
      message: message.trim(),
      type: 'MESSAGE' as const,
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

  const payload = {
    title,
    message: message.trim(),
    type: 'MESSAGE' as const,
    senderId: effectiveSender.sub,
    batchId,
    timestamp: new Date().toISOString(),
  };

  setImmediate(() => {
    try {
      if (channels.includes('inapp')) {
        const io = getSocketIO();
        for (const u of targetUsers) {
          io.to(`user:${u.id}`).emit('notification:new', payload);
        }
      }
      if (channels.includes('sms')) {
        void import('./notificationService').then(({ notificationService }) => {
          const usersWithPhone = targetUsers.filter((u) => u.phone).slice(0, SMS_MAX_RECIPIENTS);
          for (const u of usersWithPhone) {
            void notificationService.sendSMS(u.phone!, message.trim()).catch(() => {});
          }
        });
      }
    } catch (bgErr) {
      console.error('[scopedNotificationSend] Background delivery error:', bgErr);
    }
  });

  return { success: true, recipientCount: targetUsers.length, batchId };
}

/** AI actions may only use in-app delivery; SMS is reserved for OTP/password-reset flows for now. */
export function assertAiNotificationChannels(channels: NotificationChannel[]): void {
  if (channels.includes('sms')) {
    throw new ScopedNotificationError(
      403,
      'FORBIDDEN',
      'SMS cannot be sent via AI. Notifications are in-app only for now.',
    );
  }
  if (!channels.includes('inapp')) {
    throw new ScopedNotificationError(400, 'VALIDATION_ERROR', 'AI notifications must use the in-app channel');
  }
}
