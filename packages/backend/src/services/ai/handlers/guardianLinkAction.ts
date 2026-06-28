import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Resolve a user by name within the current school scope.
 * Returns the full user record, or null if not found / ambiguous.
 */
async function resolveUserByName(
  name: string,
  role: 'GUARDIAN' | 'STUDENT',
  schoolId: string,
) {
  const { prisma } = await import('../../../lib/prisma');

  const users = await prisma.user.findMany({
    where: {
      schoolId,
      role,
      fullName: { contains: name, mode: 'insensitive' },
    },
    select: { id: true, fullName: true },
    take: 5,
  });

  if (users.length === 0) return null;
  // Exact match wins; otherwise return the first if only one candidate
  const exact = users.find((u) => u.fullName.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  if (users.length === 1) return users[0];
  // Multiple matches – return null to let the handler ask for clarification
  return null;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

const linkGuardianHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const guardianName = (params.guardianName as string)?.trim();
  const studentName = (params.studentName as string)?.trim();

  if (!guardianName || !studentName) {
    return { answer: 'Please provide both the guardian name and the student name.' };
  }

  const guardian = await resolveUserByName(guardianName, 'GUARDIAN', scope.schoolId);
  if (!guardian) {
    return {
      answer: `Could not find a guardian named "${guardianName}" in your school. Please check the name and try again.`,
    };
  }

  const student = await resolveUserByName(studentName, 'STUDENT', scope.schoolId);
  if (!student) {
    return {
      answer: `Could not find a student named "${studentName}" in your school. Please check the name and try again.`,
    };
  }

  // Check if link already exists
  const existing = await prisma.guardian.findUnique({
    where: {
      guardianId_studentId: { guardianId: guardian.id, studentId: student.id },
    },
  });
  if (existing) {
    return {
      answer: `${guardian.fullName} is already linked to ${student.fullName}.`,
      data: { linkId: existing.id },
    };
  }

  const link = await prisma.guardian.create({
    data: {
      schoolId: scope.schoolId,
      guardianId: guardian.id,
      studentId: student.id,
    },
  });

  return {
    answer: `✅ ${guardian.fullName} has been linked as guardian of ${student.fullName}.`,
    data: { linkId: link.id, guardianId: guardian.id, studentId: student.id },
  };
};

const unlinkGuardianHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const guardianName = (params.guardianName as string)?.trim();
  const studentName = (params.studentName as string)?.trim();

  if (!guardianName || !studentName) {
    return { answer: 'Please provide both the guardian name and the student name.' };
  }

  const guardian = await resolveUserByName(guardianName, 'GUARDIAN', scope.schoolId);
  if (!guardian) {
    return {
      answer: `Could not find a guardian named "${guardianName}" in your school.`,
    };
  }

  const student = await resolveUserByName(studentName, 'STUDENT', scope.schoolId);
  if (!student) {
    return {
      answer: `Could not find a student named "${studentName}" in your school.`,
    };
  }

  const link = await prisma.guardian.findUnique({
    where: {
      guardianId_studentId: { guardianId: guardian.id, studentId: student.id },
    },
  });

  if (!link) {
    return {
      answer: `${guardian.fullName} is not linked to ${student.fullName}.`,
    };
  }

  await prisma.guardian.delete({ where: { id: link.id } });

  return {
    answer: `✅ ${guardian.fullName} has been unlinked from ${student.fullName}.`,
    data: { removedLinkId: link.id },
  };
};

const listLinkedGuardiansHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const studentName = (params.studentName as string)?.trim();
  if (!studentName) {
    return { answer: 'Which student would you like to check guardians for? Please provide the student name.' };
  }

  const student = await resolveUserByName(studentName, 'STUDENT', scope.schoolId);
  if (!student) {
    return {
      answer: `Could not find a student named "${studentName}" in your school.`,
    };
  }

  const links = await prisma.guardian.findMany({
    where: { studentId: student.id, schoolId: scope.schoolId },
    include: {
      guardian: {
        select: { id: true, fullName: true, email: true, phone: true },
      },
    },
  });

  if (links.length === 0) {
    return {
      answer: `No guardians are currently linked to ${student.fullName}.`,
      data: { studentId: student.id, guardians: [] },
    };
  }

  const lines = links.map((link, i) => {
    const g = link.guardian;
    const contact = [g.email, g.phone].filter(Boolean).join(' / ');
    return `${i + 1}. ${g.fullName}${contact ? ` (${contact})` : ''}`;
  });

  return {
    answer: `Guardians for ${student.fullName}:\n${lines.join('\n')}`,
    data: { studentId: student.id, guardians: links.map((l) => l.guardian) },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const guardianLinkActions: ActionDefinition[] = [
  {
    action: 'link_guardian',
    description: 'Link a guardian to a student (school admin)',
    destructive: false,
    patterns: [
      /link\s+(?:guardian|parent)\s+(.+?)\s+(?:to|with)\s+(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      if (!match) return {};
      return {
        guardianName: match[1]?.trim() ?? '',
        studentName: match[2]?.trim() ?? '',
      };
    },
    descriptionTemplate: (params) =>
      `Link guardian "${params.guardianName}" to student "${params.studentName}".`,
    handler: linkGuardianHandler,
  },
  {
    action: 'unlink_guardian',
    description: 'Remove a guardian-student link (school admin)',
    destructive: true,
    patterns: [
      /unlink\s+(?:guardian|parent)\s+(.+?)\s+(?:from|with)\s+(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      if (!match) return {};
      return {
        guardianName: match[1]?.trim() ?? '',
        studentName: match[2]?.trim() ?? '',
      };
    },
    descriptionTemplate: (params) =>
      `Unlink guardian "${params.guardianName}" from student "${params.studentName}". This cannot be undone.`,
    handler: unlinkGuardianHandler,
  },
  {
    action: 'list_linked_guardians',
    description: 'List guardians linked to a student (school admin)',
    destructive: false,
    patterns: [
      /guardians?\s+(?:for|of)\s+(?:student\s+)?(.+)/i,
      /who\s+(?:is|are)\s+(?:the\s+)?guardians?(?:\s+of)?\s+(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      if (!match) return {};
      return {
        studentName: match[1]?.trim() ?? '',
      };
    },
    descriptionTemplate: (params) =>
      `List guardians for student "${params.studentName}".`,
    handler: listLinkedGuardiansHandler,
  },
];