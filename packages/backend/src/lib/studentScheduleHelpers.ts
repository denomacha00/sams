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

export async function fetchTodayTimetableForClass(classId: string, date: Date = new Date()) {
  const { prisma } = await import('../index');
  const dayOfWeek = jsDateToSchemaDayOfWeek(date);

  const entries = await prisma.timetableEntry.findMany({
    where: { classId, dayOfWeek },
    orderBy: { startTime: 'asc' },
    include: { teacher: { select: { fullName: true } } },
  });

  return {
    dayOfWeek,
    dayName: schemaDayName(dayOfWeek),
    entries: entries.map((e) => ({
      startTime: e.startTime,
      endTime: e.endTime,
      subject: e.subject,
      teacherName: e.teacher.fullName,
    })),
  };
}
