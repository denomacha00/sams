import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const addTeacherHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const teacherName = params.teacherName as string;
  if (!teacherName) return { answer: 'Please provide the teacher name.' };

  if (!scope.departmentId) {
    return { answer: 'Your account is not associated with a department.' };
  }

  const teacher = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'TEACHER',
      fullName: { contains: teacherName, mode: 'insensitive' },
    },
  });

  if (!teacher) return { answer: `Teacher "${teacherName}" not found in your school.` };

  await prisma.user.update({
    where: { id: teacher.id },
    data: { departmentId: scope.departmentId },
  });

  return {
    answer: `✅ Teacher "${teacher.fullName}" assigned to your department.`,
    data: { teacherId: teacher.id, departmentId: scope.departmentId },
  };
};

const viewDepartmentStatsHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');

  if (!scope.departmentId) {
    return { answer: 'Your account is not associated with a department.' };
  }

  const [teacherCount, classCount] = await Promise.all([
    prisma.user.count({
      where: { schoolId: scope.schoolId, departmentId: scope.departmentId, role: 'TEACHER' },
    }),
    prisma.class.count({
      where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
    }),
  ]);

  return {
    answer: `📊 **Department Stats**\n\n• Teachers: ${teacherCount}\n• Classes: ${classCount}`,
    data: { teacherCount, classCount, departmentId: scope.departmentId },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const hodActions: ActionDefinition[] = [
  {
    action: 'add_teacher',
    description: 'Assign a teacher to your department',
    destructive: false,
    patterns: [
      /add\s+teacher\s+(.+)/i,
      /assign\s+(.+)\s+to\s+(?:my\s+)?department/i,
      /add\s+(.+)\s+to\s+(?:my\s+)?department/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const teacherName = match && match[1] ? match[1].trim() : '';
      return { teacherName };
    },
    descriptionTemplate: (params) =>
      `Assign teacher "${params.teacherName}" to your department.`,
    handler: addTeacherHandler,
  },
  {
    action: 'view_department_stats',
    description: 'View statistics for your department',
    destructive: false,
    patterns: [
      /department\s+stats/i,
      /my\s+department/i,
      /show\s+department\s+(?:stats|statistics|info)/i,
      /view\s+department/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () =>
      `View department statistics (teachers, classes, attendance).`,
    handler: viewDepartmentStatsHandler,
  },
];
