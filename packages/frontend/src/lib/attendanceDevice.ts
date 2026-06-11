const ATTENDANCE_DEVICE_KEY = 'sams-attendance-device-id';
let fallbackDeviceId: string | null = null;

export function getAttendanceDeviceId(): string {
  try {
    const existing = localStorage.getItem(ATTENDANCE_DEVICE_KEY);
    if (existing && existing.length >= 8) return existing;

    const generated =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(ATTENDANCE_DEVICE_KEY, generated);
    return generated;
  } catch {
    fallbackDeviceId =
      fallbackDeviceId ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `memory-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return fallbackDeviceId;
  }
}
