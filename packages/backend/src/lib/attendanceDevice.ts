import crypto from 'crypto';

const DEVICE_ID_MAX_LENGTH = 200;

export function buildAttendanceDeviceHash(
  schoolId: string,
  deviceId?: string | null,
  userAgent?: string | null,
): string | null {
  const normalizedDeviceId = deviceId?.trim();
  if (!normalizedDeviceId) return null;

  const boundedDeviceId = normalizedDeviceId.slice(0, DEVICE_ID_MAX_LENGTH);
  const boundedUserAgent = (userAgent ?? '').slice(0, 300);
  return crypto
    .createHash('sha256')
    .update(`${schoolId}:${boundedDeviceId}:${boundedUserAgent}`)
    .digest('hex');
}
