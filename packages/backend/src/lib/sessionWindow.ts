export const SESSION_WINDOW_TOLERANCE_MINUTES = 0;

export interface TimetableWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * Get the current day-of-week and minutes in the configured timezone.
 * Uses APP_TIMEZONE env var (defaults to Africa/Nairobi).
 * This fixes the bug where the VPS runs UTC but timetable entries
 * are stored in Nairobi local time (UTC+3).
 */
export function getLocalTimetableClock(date: Date = new Date()): { dayOfWeek: number; minutes: number } {
  const tz = process.env.APP_TIMEZONE || 'Africa/Nairobi';

  // Use Intl.DateTimeFormat to get timezone-aware day and time.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);

  let hours = 0;
  let minutes = 0;
  let dayName = '';

  for (const part of parts) {
    switch (part.type) {
      case 'weekday':
        dayName = part.value;
        break;
      case 'hour':
        hours = parseInt(part.value, 10);
        break;
      case 'minute':
        minutes = parseInt(part.value, 10);
        break;
    }
  }

  // Map weekday abbreviation to schema dayOfWeek (0=Monday ... 6=Sunday)
  const dayMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const dayOfWeek = dayMap[dayName] ?? schemaDayOfWeekFromDate(date);

  return { dayOfWeek, minutes: hours * 60 + minutes };
}

export function schemaDayOfWeekFromDate(date: Date = new Date()): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
  return (hours * 60) + minutes;
}

export function isWithinTimetableStartWindow(
  entry: TimetableWindow,
  date: Date = new Date(),
  toleranceMinutes: number = SESSION_WINDOW_TOLERANCE_MINUTES,
): boolean {
  const local = getLocalTimetableClock(date);
  if (local.dayOfWeek !== entry.dayOfWeek) return false;

  const scheduledStart = minutesFromTime(entry.startTime);
  const scheduledEnd = minutesFromTime(entry.endTime);
  if (!Number.isFinite(scheduledStart) || !Number.isFinite(scheduledEnd)) return false;

  return (
    local.minutes >= scheduledStart - toleranceMinutes &&
    local.minutes <= scheduledEnd + toleranceMinutes
  );
}

export function isTimetableWindowExpired(
  entry: TimetableWindow,
  date: Date = new Date(),
  toleranceMinutes: number = SESSION_WINDOW_TOLERANCE_MINUTES,
): boolean {
  const local = getLocalTimetableClock(date);
  if (local.dayOfWeek !== entry.dayOfWeek) return true;

  const scheduledEnd = minutesFromTime(entry.endTime);
  if (!Number.isFinite(scheduledEnd)) return false;

  return local.minutes > scheduledEnd + toleranceMinutes;
}
