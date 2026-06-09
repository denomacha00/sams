import path from 'path';

/** Root folder for all uploaded files (avatars, etc.). */
export const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR || '/var/www/sams/uploads');

/** Avatar images are stored under uploads/avatars/. */
export const AVATARS_DIR = path.join(UPLOADS_ROOT, 'avatars');

/** Notification attachments are stored under uploads/notifications/. */
export const NOTIFICATION_ATTACHMENTS_DIR = path.join(UPLOADS_ROOT, 'notifications');

export function avatarPublicUrl(userId: string): string {
  return `/uploads/avatars/${userId}.jpg`;
}

export function notificationAttachmentPublicUrl(
  schoolId: string,
  batchId: string,
  filename: string,
): string {
  return `/uploads/notifications/${schoolId}/${batchId}/${filename}`;
}
