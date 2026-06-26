import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

const NOTIFICATION_WORD = /\b(?:alerts?|notifications?|messages?|inbox)\b/i;

export const markNotificationsReadHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const result = await prisma.notification.updateMany({
    where: { userId: scope.userId, read: false },
    data: { read: true },
  });

  return {
    answer: `Done. I marked **${result.count}** inbox notification(s) as read.`,
    data: { updatedCount: result.count },
  };
};

export const clearInboxNotificationsHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const result = await prisma.notification.deleteMany({
    where: { userId: scope.userId },
  });

  return {
    answer: `Done. I deleted **${result.count}** notification(s) from your inbox. Sent messages are not deleted by this action.`,
    data: { deletedCount: result.count },
  };
};

export const markNotificationsReadActionDef: ActionDefinition = {
  action: 'mark_notifications_read',
  description: 'Mark all inbox notifications as read for the logged-in user',
  destructive: false,
  patterns: [
    /mark\s+(?:all\s+)?(?:my\s+)?(?:alerts?|notifications?|messages?|inbox)\s+(?:as\s+)?read/i,
    /read\s+(?:all\s+)?(?:my\s+)?(?:alerts?|notifications?|messages?|inbox)/i,
  ],
  extractParams: () => ({}),
  descriptionTemplate: () => 'Mark all inbox notifications as read.',
  handler: markNotificationsReadHandler,
};

export const clearInboxNotificationsActionDef: ActionDefinition = {
  action: 'clear_inbox_notifications',
  description: 'Delete all inbox notifications for the logged-in user',
  destructive: true,
  patterns: [
    /(?:clear|delete|remove)\s+(?:all\s+)?(?:my\s+)?(?:alerts?|notifications?|messages?|inbox)/i,
    /(?:clear|delete|remove)\s+(?:all\s+)?(?:alerts?|notifications?|messages?)\s+from\s+(?:my\s+)?inbox/i,
  ],
  extractParams: () => ({}),
  descriptionTemplate: () => 'Delete all notifications from your inbox. Sent messages are not deleted.',
  handler: clearInboxNotificationsHandler,
};

export const notificationInboxActions: ActionDefinition[] = [
  markNotificationsReadActionDef,
  clearInboxNotificationsActionDef,
];

export function looksLikeNotificationInboxRequest(message: string): boolean {
  return NOTIFICATION_WORD.test(message);
}
