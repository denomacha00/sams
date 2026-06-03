import { prisma } from './prisma';

/**
 * Effective class for a teacher: explicit user.classId, or the class they are assigned as class teacher.
 */
export async function resolveTeacherClassId(
  userId: string,
  classIdFromToken?: string | null,
): Promise<string | null> {
  if (classIdFromToken) return classIdFromToken;

  const taught = await prisma.class.findFirst({
    where: { classTeacherId: userId },
    select: { id: true },
    orderBy: { name: 'asc' },
  });

  return taught?.id ?? null;
}
