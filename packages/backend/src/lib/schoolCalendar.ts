import { getAppTimezone, getTodayYmdInTimezone } from './appTimezone';
import { prisma } from './prisma';

export interface SchoolClosureInfo {
  id: string;
  date: string;
  title: string;
  reason: string | null;
}

export async function getSchoolClosureForDate(
  schoolId: string,
  date: Date = new Date(),
  timeZone: string = getAppTimezone(),
): Promise<SchoolClosureInfo | null> {
  const ymd = getTodayYmdInTimezone(date, timeZone);
  return prisma.schoolClosure.findUnique({
    where: { schoolId_date: { schoolId, date: ymd } },
    select: { id: true, date: true, title: true, reason: true },
  });
}

export async function isSchoolClosedOnDate(
  schoolId: string,
  date: Date = new Date(),
  timeZone: string = getAppTimezone(),
): Promise<boolean> {
  return (await getSchoolClosureForDate(schoolId, date, timeZone)) !== null;
}
