import { prisma } from './prisma';

function pushUnique(target: string[], value?: string | null): void {
  if (value && !target.includes(value)) target.push(value);
}

/**
 * Effective class for a teacher. Prefers live DB assignment over JWT hints (token classId can be stale).
 * Order: Class.classTeacherId → User.classId in DB → optional hint (e.g. JWT).
 */
export async function resolveTeacherClassId(
  userId: string,
  classIdHint?: string | null,
): Promise<string | null> {
  const asClassTeacher = await prisma.class.findFirst({
    where: { classTeacherId: userId },
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  if (asClassTeacher) return asClassTeacher.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { classId: true },
  });
  if (user?.classId) return user.classId;

  return classIdHint ?? null;
}

/**
 * Classes where this teacher can manage class-rep style actions.
 * This intentionally excludes timetable-only classes and JWT hints.
 */
export async function resolveTeacherManagedClassIds(
  userId: string,
  _classIdHint?: string | null,
): Promise<string[]> {
  const classIds: string[] = [];

  const asClassTeacher = await prisma.class.findMany({
    where: { classTeacherId: userId },
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  for (const cls of asClassTeacher) pushUnique(classIds, cls.id);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { classId: true },
  });
  pushUnique(classIds, user?.classId);

  return classIds;
}

/**
 * All classes visible to a teacher: live managed classes plus timetable teaching assignments.
 */
export async function resolveTeacherTeachingClassIds(
  userId: string,
  classIdHint?: string | null,
): Promise<string[]> {
  const classIds = await resolveTeacherManagedClassIds(userId, classIdHint);

  const timetableClasses = await prisma.timetableEntry.findMany({
    where: { teacherId: userId },
    select: { classId: true },
    distinct: ['classId'],
  });

  for (const entry of timetableClasses) pushUnique(classIds, entry.classId);

  return classIds;
}
