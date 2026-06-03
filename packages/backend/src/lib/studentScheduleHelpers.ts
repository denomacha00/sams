import { prisma } from './prisma';
import { getAppTimezone, schemaDayOfWeekInTimezone } from './appTimezone';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** SAMS schema: 0 = Monday … 6 = Sunday (see sessionService / TimetableEntry). */
export function jsDateToSchemaDayOfWeek(date: Date = new Date()): number {
  const jsDay = date.getDay(); // 0 = Sunday … 6 = Saturday
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function schemaDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`;
}

export type TimetableSlotRow = {
  startTime: string;
  endTime: string;
  subject: string;
  teacherName: string;
};

export function formatTimetableSlotLines(entries: TimetableSlotRow[]): string {
  return entries
    .map((e) => `  • ${e.startTime}–${e.endTime}: ${e.subject} (${e.teacherName})`)
    .join('\n');
}

export async function fetchTimetableSlotsForClassDay(classId: string, dayOfWeek: number) {
  const entries = await prisma.timetableEntry.findMany({
    where: { classId, dayOfWeek },
    orderBy: { startTime: 'asc' },
    include: { teacher: { select: { fullName: true } } },
  });

  return entries.map((e) => ({
    startTime: e.startTime,
    endTime: e.endTime,
    subject: e.subject,
    teacherName: e.teacher.fullName,
  }));
}

export async function fetchTodayTimetableForClass(
  classId: string,
  options?: { date?: Date; timeZone?: string },
) {
  const timeZone = options?.timeZone ?? getAppTimezone();
  const date = options?.date ?? new Date();
  const dayOfWeek = schemaDayOfWeekInTimezone(date, timeZone);
  const entries = await fetchTimetableSlotsForClassDay(classId, dayOfWeek);

  return {
    dayOfWeek,
    dayName: schemaDayName(dayOfWeek),
    entries,
  };
}
