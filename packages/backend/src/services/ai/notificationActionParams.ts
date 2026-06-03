import type { NotificationTargetRole } from '../scopedNotificationSend';

/** Infer TEACHER vs STUDENT audience from natural language. */
export function parseNotificationTargetRole(text: string): NotificationTargetRole | undefined {
  if (/\bteachers?\b/i.test(text) && !/\bstudents?\b/i.test(text)) return 'TEACHER';
  if (/\bstudents?\b/i.test(text) && !/\bteachers?\b/i.test(text)) return 'STUDENT';
  if (/\bstudents?\b/i.test(text) && /\bteachers?\b/i.test(text)) return undefined;
  return undefined;
}

export function extractMessageBody(match: RegExpMatchArray | null, fallback = ''): string {
  return match && match[1] ? match[1].trim() : fallback.trim();
}
