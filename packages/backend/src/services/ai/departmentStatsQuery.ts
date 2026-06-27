import { prisma } from '../../lib/prisma';

export interface DepartmentStatsCounts {
  teacherCount: number;
  studentCount: number;
  classCount: number;
  departmentId: string;
  teacherNames: string[];
  studentNames: string[];
  className: string | null;
}

export async function fetchDepartmentStats(
  schoolId: string,
  departmentId: string,
): Promise<DepartmentStatsCounts> {
  const [teacherCount, studentCount, classCount, teachers, students] = await Promise.all([
    prisma.user.count({
      where: { schoolId, departmentId, role: 'TEACHER' },
    }),
    prisma.user.count({
      where: { schoolId, departmentId, role: 'STUDENT' },
    }),
    prisma.class.count({
      where: { schoolId, departmentId },
    }),
    prisma.user.findMany({
      where: { schoolId, departmentId, role: 'TEACHER' },
      select: { fullName: true },
      orderBy: { fullName: 'asc' },
    }),
    prisma.user.findMany({
      where: { schoolId, departmentId, role: 'STUDENT' },
      select: { fullName: true, admissionNumber: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { name: true },
  });

  return {
    teacherCount,
    studentCount,
    classCount,
    departmentId,
    teacherNames: teachers.map((t) => t.fullName),
    studentNames: students.map((s) => {
      return s.admissionNumber ? `${s.fullName} (${s.admissionNumber})` : s.fullName;
    }),
    className: department?.name ?? null,
  };
}

export function formatDepartmentStatsAnswer(stats: DepartmentStatsCounts): string {
  const lines: string[] = [
    `📊 **${stats.className ? `${stats.className} Department` : 'Department'} Stats**`,
    '',
    `• Teachers: ${stats.teacherCount}`,
    `• Students: ${stats.studentCount}`,
    `• Classes: ${stats.classCount}`,
  ];

  if (stats.teacherNames.length > 0) {
    lines.push('');
    lines.push(`**Teachers:**`);
    stats.teacherNames.forEach((name) => lines.push(`  👤 ${name}`));
  }

  if (stats.studentNames.length > 0) {
    lines.push('');
    lines.push(`**Students:**`);
    stats.studentNames.forEach((name) => lines.push(`  🧑‍🎓 ${name}`));
  }

  if (stats.studentNames.length === 0 && stats.teacherNames.length === 0) {
    lines.push('');
    lines.push('No teachers or students are assigned to this department yet.');
  }

  return lines.join('\n');
}

export async function fetchDepartmentStudents(
  schoolId: string,
  departmentId: string,
  limit: number = 100,
): Promise<Array<{ fullName: string; admissionNumber: string | null; className: string | null }>> {
  const students = await prisma.user.findMany({
    where: { schoolId, departmentId, role: 'STUDENT' },
    select: {
      fullName: true,
      admissionNumber: true,
      class: { select: { name: true } },
    },
    orderBy: { fullName: 'asc' },
    take: limit,
  });

  return students.map((s) => ({
    fullName: s.fullName,
    admissionNumber: s.admissionNumber,
    className: s.class?.name ?? null,
  }));
}

export async function fetchDepartmentTeachers(
  schoolId: string,
  departmentId: string,
  limit: number = 100,
): Promise<Array<{ fullName: string }>> {
  const teachers = await prisma.user.findMany({
    where: { schoolId, departmentId, role: 'TEACHER' },
    select: { fullName: true },
    orderBy: { fullName: 'asc' },
    take: limit,
  });

  return teachers;
}
