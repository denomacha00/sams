import { prisma } from '../../lib/prisma';

export interface DepartmentStatsCounts {
  teacherCount: number;
  studentCount: number;
  classCount: number;
  departmentId: string;
}

export async function fetchDepartmentStats(
  schoolId: string,
  departmentId: string,
): Promise<DepartmentStatsCounts> {
  const [teacherCount, studentCount, classCount] = await Promise.all([
    prisma.user.count({
      where: { schoolId, departmentId, role: 'TEACHER' },
    }),
    prisma.user.count({
      where: { schoolId, departmentId, role: 'STUDENT' },
    }),
    prisma.class.count({
      where: { schoolId, departmentId },
    }),
  ]);

  return { teacherCount, studentCount, classCount, departmentId };
}

export function formatDepartmentStatsAnswer(stats: DepartmentStatsCounts): string {
  return (
    `📊 **Department Stats**\n\n` +
    `• Teachers: ${stats.teacherCount}\n` +
    `• Students: ${stats.studentCount}\n` +
    `• Classes: ${stats.classCount}`
  );
}
