import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const setClassRepHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const studentName = (params.studentName as string)?.trim() || '';
  if (!studentName) {
    return { answer: 'Which student should be assigned as class representative? Please provide their name.' };
  }

  // Find student in the same school
  const student = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'STUDENT',
      fullName: { contains: studentName, mode: 'insensitive' },
    },
    select: { id: true, fullName: true, isClassRep: true, class: { select: { name: true } } },
  });

  if (!student) {
    return { answer: `Student "${studentName}" not found in your school.` };
  }

  if (student.isClassRep) {
    return {
      answer: `**${student.fullName}** is already the class representative${student.class?.name ? ` for ${student.class.name}` : ''}.`,
      data: { studentId: student.id, fullName: student.fullName, isClassRep: true },
    };
  }

  await prisma.user.update({
    where: { id: student.id },
    data: { isClassRep: true },
  });

  return {
    answer: `✅ **${student.fullName}** has been assigned as class representative${student.class?.name ? ` for ${student.class.name}` : ''}.`,
    data: { studentId: student.id, fullName: student.fullName, isClassRep: true },
  };
};

const unsetClassRepHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const studentName = (params.studentName as string)?.trim() || '';
  if (!studentName) {
    return { answer: 'Which student should be removed as class representative? Please provide their name.' };
  }

  // Find student in the same school
  const student = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'STUDENT',
      fullName: { contains: studentName, mode: 'insensitive' },
    },
    select: { id: true, fullName: true, isClassRep: true, class: { select: { name: true } } },
  });

  if (!student) {
    return { answer: `Student "${studentName}" not found in your school.` };
  }

  if (!student.isClassRep) {
    return {
      answer: `**${student.fullName}** is not currently a class representative${student.class?.name ? ` for ${student.class.name}` : ''}.`,
      data: { studentId: student.id, fullName: student.fullName, isClassRep: false },
    };
  }

  await prisma.user.update({
    where: { id: student.id },
    data: { isClassRep: false },
  });

  return {
    answer: `✅ **${student.fullName}** has been removed as class representative${student.class?.name ? ` for ${student.class.name}` : ''}.`,
    data: { studentId: student.id, fullName: student.fullName, isClassRep: false },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const classRepActions: ActionDefinition[] = [
  {
    action: 'set_class_rep',
    description: 'Assign a student as class representative',
    destructive: false,
    patterns: [
      /(?:set|make|assign)\s+(.+?)\s+(?:as|the)\s+(?:class\s+)?rep(?:resentative)?/i,
      /(?:set|make|assign)\s+(?:the\s+)?(?:class\s+)?rep(?:resentative)?\s+(.+)/i,
      /appoint\s+(.+?)\s+(?:as|the)\s+(?:class\s+)?rep(?:resentative)?/i,
      /nominate\s+(.+?)\s+(?:as|the\s+)?(?:class\s+)?rep(?:resentative)?/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      let studentName = match && match[1] ? match[1].trim() : '';
      // Clean up trailing role words
      studentName = studentName.replace(/\s+(?:as|the)\s+(?:class\s+)?rep(?:resentative)?\s*$/i, '').trim();
      return { studentName };
    },
    descriptionTemplate: (params) =>
      `Assign student "${params.studentName}" as class representative.`,
    handler: setClassRepHandler,
  },
  {
    action: 'unset_class_rep',
    description: 'Remove a student as class representative',
    destructive: false,
    patterns: [
      /(?:remove|unset|unassign)\s+(?:the\s+)?(?:class\s+)?rep(?:resentative)?\s+(.+)/i,
      /(?:remove|unset|unassign)\s+(.+?)\s+(?:as|from)\s+(?:the\s+)?(?:class\s+)?rep(?:resentative)?/i,
      /demote\s+(.+?)\s+(?:from|as)\s+(?:the\s+)?(?:class\s+)?rep(?:resentative)?/i,
      /cancel\s+(?:the\s+)?(?:class\s+)?rep(?:resentative)?\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      let studentName = match && match[1] ? match[1].trim() : '';
      // Clean up trailing role words
      studentName = studentName.replace(/\s+(?:as|from)\s+(?:the\s+)?(?:class\s+)?rep(?:resentative)?\s*$/i, '').trim();
      return { studentName };
    },
    descriptionTemplate: (params) =>
      `Remove student "${params.studentName}" as class representative.`,
    handler: unsetClassRepHandler,
  },
];