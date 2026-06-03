import { prisma } from './prisma';

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
