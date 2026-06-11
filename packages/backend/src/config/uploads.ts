import path from 'path';

/** Root folder for all uploaded files (avatars, etc.). */
const configuredUploadsDir = path.resolve(process.env.UPLOADS_DIR || '/var/www/sams/uploads');
const configuredAvatarDir = path.basename(configuredUploadsDir).toLowerCase() === 'avatars';

export const UPLOADS_ROOT = configuredAvatarDir
  ? path.dirname(configuredUploadsDir)
  : configuredUploadsDir;

/** Avatar images are stored under uploads/avatars/. */
export const AVATARS_DIR = configuredAvatarDir
  ? configuredUploadsDir
  : path.join(UPLOADS_ROOT, 'avatars');

/** Notification attachments are stored under uploads/notifications/. */
export const NOTIFICATION_ATTACHMENTS_DIR = path.join(UPLOADS_ROOT, 'notifications');

export function avatarPublicUrl(userId: string): string {
  return `/uploads/avatars/${userId}.jpg`;
}

export function notificationAttachmentPublicUrl(
  _schoolId: string,
  _batchId: string,
  filename: string,
): string {
  const id = path.basename(filename, path.extname(filename));
  return `/api/v1/notifications/attachments/${id}`;
}
