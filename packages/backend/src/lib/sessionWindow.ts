export const SESSION_WINDOW_TOLERANCE_MINUTES = 30;

export interface TimetableWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
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
  if (schemaDayOfWeekFromDate(date) !== entry.dayOfWeek) return false;

  const currentMinutes = (date.getHours() * 60) + date.getMinutes();
  const scheduledStart = minutesFromTime(entry.startTime);
  const scheduledEnd = minutesFromTime(entry.endTime);
  if (!Number.isFinite(scheduledStart) || !Number.isFinite(scheduledEnd)) return false;

  return (
    currentMinutes >= scheduledStart - toleranceMinutes &&
    currentMinutes <= scheduledEnd + toleranceMinutes
  );
}

export function isTimetableWindowExpired(
  entry: TimetableWindow,
  date: Date = new Date(),
  toleranceMinutes: number = SESSION_WINDOW_TOLERANCE_MINUTES,
): boolean {
  if (schemaDayOfWeekFromDate(date) !== entry.dayOfWeek) return true;

  const scheduledEnd = minutesFromTime(entry.endTime);
  if (!Number.isFinite(scheduledEnd)) return false;

  const currentMinutes = (date.getHours() * 60) + date.getMinutes();
  return currentMinutes > scheduledEnd + toleranceMinutes;
}
