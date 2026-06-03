import { prisma } from '../lib/prisma';
import {
  getAppTimezone,
  getTodayYmdInTimezone,
  schemaDayOfWeekInTimezone,
  zonedMidnightUtc,
} from '../lib/appTimezone';
import {
  formatTimetableSlotLines,
  schemaDayName,
  type TimetableSlotRow,
} from '../lib/studentScheduleHelpers';

export const DAILY_SCHEDULE_NOTIFICATION_TYPE = 'DAILY_SCHEDULE';

/** Default on; set STUDENT_DAILY_SCHEDULE_REMINDERS=false to disable. */
export function isStudentDailyScheduleRemindersEnabled(): boolean {
  const flag = process.env.STUDENT_DAILY_SCHEDULE_REMINDERS ?? 'true';
  return flag.toLowerCase() !== 'false';
}

export function formatDailyScheduleNotificationMessage(
  dayName: string,
  entries: TimetableSlotRow[],
): string {
  const lines = formatTimetableSlotLines(entries).replace(/^  /gm, '');
  return `${dayName}:\n${lines}`;
}

/**
 * Create one in-app notification per active student who has classes today.
 * No SMS, email, or push — uses prisma.notification.createMany only.
 */
export async function runStudentDailyScheduleReminders(
  now: Date = new Date(),
): Promise<{ sent: number; skipped: number }> {
  if (!isStudentDailyScheduleRemindersEnabled()) {
    console.log('[ScheduleReminders] Disabled (STUDENT_DAILY_SCHEDULE_REMINDERS=false)');
    return { sent: 0, skipped: 0 };
  }

  const timeZone = getAppTimezone();
  const todayYmd = getTodayYmdInTimezone(now, timeZone);
  const todayStart = zonedMidnightUtc(todayYmd, timeZone);
  const dayOfWeek = schemaDayOfWeekInTimezone(now, timeZone);
  const dayName = schemaDayName(dayOfWeek);

  const students = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      isLocked: false,
      classId: { not: null },
      school: { isSuspended: false },
    },
    select: { id: true, schoolId: true, classId: true },
  });

  const byClass = new Map<string, typeof students>();
  for (const student of students) {
    const classId = student.classId!;
    const list = byClass.get(classId) ?? [];
    list.push(student);
    byClass.set(classId, list);
  }

  let sent = 0;
  let skipped = 0;

  for (const [classId, classStudents] of byClass) {
    const entries = await prisma.timetableEntry.findMany({
      where: { classId, dayOfWeek },
      orderBy: { startTime: 'asc' },
      include: { teacher: { select: { fullName: true } } },
    });

    if (entries.length === 0) {
      continue;
    }

    const slots: TimetableSlotRow[] = entries.map((e) => ({
      startTime: e.startTime,
      endTime: e.endTime,
      subject: e.subject,
      teacherName: e.teacher.fullName,
    }));
    const message = formatDailyScheduleNotificationMessage(dayName, slots);
    const studentIds = classStudents.map((s) => s.id);

    const alreadySent = await prisma.notification.findMany({
      where: {
        userId: { in: studentIds },
        type: DAILY_SCHEDULE_NOTIFICATION_TYPE,
        createdAt: { gte: todayStart },
      },
      select: { userId: true },
    });
    const alreadySet = new Set(alreadySent.map((n) => n.userId));

    const toCreate = classStudents
      .filter((s) => !alreadySet.has(s.id))
      .map((s) => ({
        schoolId: s.schoolId,
        userId: s.id,
        senderId: null as string | null,
        title: "Today's classes",
        message,
        type: DAILY_SCHEDULE_NOTIFICATION_TYPE,
      }));

    skipped += classStudents.length - toCreate.length;

    if (toCreate.length === 0) {
      continue;
    }

    await prisma.notification.createMany({ data: toCreate });
    sent += toCreate.length;
  }

  console.log(
    `[ScheduleReminders] Daily in-app schedule reminders: sent=${sent}, skipped=${skipped} (${dayName}, tz=${timeZone})`,
  );

  return { sent, skipped };
}
