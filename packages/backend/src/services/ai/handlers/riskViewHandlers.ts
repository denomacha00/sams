import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const viewRiskScoresHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  // Get students in scope
  let studentIds: string[] = [];

  if (scope.role === 'TEACHER') {
    const { resolveTeacherTeachingClassIds } = await import('../../../lib/teacherScope');
    const classIds = await resolveTeacherTeachingClassIds(scope.userId, scope.classId);
    if (classIds.length > 0) {
      const students = await prisma.user.findMany({
        where: { schoolId: scope.schoolId, classId: { in: classIds }, role: 'STUDENT' },
        select: { id: true },
      });
      studentIds = students.map((s) => s.id);
    }
  } else if (scope.role === 'HOD' && scope.departmentId) {
    const students = await prisma.user.findMany({
      where: { schoolId: scope.schoolId, departmentId: scope.departmentId, role: 'STUDENT' },
      select: { id: true },
    });
    studentIds = students.map((s) => s.id);
  } else if (scope.role === 'SCHOOL_ADMIN' || scope.role === 'SUPER_ADMIN') {
    const students = await prisma.user.findMany({
      where: { schoolId: scope.schoolId, role: 'STUDENT' },
      select: { id: true },
    });
    studentIds = students.map((s) => s.id);
  }

  if (studentIds.length === 0) {
    return { answer: 'No students found in your scope.', data: { scores: [] } };
  }

  const scores = await prisma.riskScore.findMany({
    where: { schoolId: scope.schoolId, studentId: { in: studentIds } },
    orderBy: { score: 'desc' },
    take: 50,
  });

  if (scores.length === 0) {
    return { answer: 'No risk scores have been calculated yet.', data: { count: 0 } };
  }

  // Fetch student names
  const students = await prisma.user.findMany({
    where: { id: { in: scores.map((s) => s.studentId) } },
    select: { id: true, fullName: true, admissionNumber: true },
  });
  const studentMap = new Map(students.map((s) => [s.id, s]));

  const lines: string[] = [];
  for (const s of scores) {
    const student = studentMap.get(s.studentId);
    const name = student?.fullName ?? 'Unknown';
    const level = s.riskLevel === 'CRITICAL' || s.riskLevel === 'HIGH' ? '🔴' :
                  s.riskLevel === 'MEDIUM' ? '🟡' : '🟢';
    lines.push(`${level} ${s.riskLevel} (${s.score.toFixed(0)}%) — ${name}`);
  }

  const label =
    scope.role === 'TEACHER' ? 'your classes' :
    scope.role === 'HOD' ? 'your department' : 'the school';

  return {
    answer: `📊 **Risk Scores — ${label}** (${scores.length} students)\n\n${lines.join('\n')}`,
    data: { count: scores.length, scores },
  };
};

const viewStudentRiskHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  let studentId: string | undefined;

  if (scope.role === 'GUARDIAN') {
    const childName = (params.childName as string)?.trim();
    const links = await prisma.guardian.findMany({
      where: { guardianId: scope.userId, schoolId: scope.schoolId },
      include: { student: { select: { id: true, fullName: true } } },
    });

    if (links.length === 0) {
      return { answer: 'No linked children found.' };
    }

    if (childName) {
      const link = links.find((l) =>
        l.student.fullName.toLowerCase().includes(childName.toLowerCase()),
      );
      studentId = link?.student.id;
      if (!studentId) return { answer: `Child "${childName}" not found among your linked children.` };
    } else if (links.length === 1) {
      studentId = links[0].student.id;
    } else {
      const names = links.map((l) => l.student.fullName).join(', ');
      return { answer: `Which child's risk score? ${names}` };
    }
  } else if (scope.role === 'TEACHER' || scope.role === 'HOD' || scope.role === 'SCHOOL_ADMIN') {
    const studentName = (params.studentName as string)?.trim();
    if (!studentName) return { answer: 'Which student do you want the risk score for?' };
    const student = await prisma.user.findFirst({
      where: { schoolId: scope.schoolId, role: 'STUDENT', fullName: { contains: studentName, mode: 'insensitive' } },
      select: { id: true, fullName: true },
    });
    if (!student) return { answer: `Student "${studentName}" not found.` };
    studentId = student.id;
  }

  if (!studentId) return { answer: 'Could not identify the student.' };

  const [score, student] = await Promise.all([
    prisma.riskScore.findFirst({
      where: { studentId, schoolId: scope.schoolId },
      orderBy: { computedAt: 'desc' },
    }),
    prisma.user.findUnique({
      where: { id: studentId },
      select: { fullName: true, admissionNumber: true },
    }),
  ]);

  if (!score) {
    return { answer: 'No risk score has been calculated for this student yet.' };
  }

  const levelEmoji = score.riskLevel === 'CRITICAL' || score.riskLevel === 'HIGH' ? '🔴' :
                     score.riskLevel === 'MEDIUM' ? '🟡' : '🟢';

  return {
    answer: `**Risk Score — ${student?.fullName ?? 'Unknown'}**\n\nScore: ${score.score.toFixed(0)}%\nLevel: ${levelEmoji} ${score.riskLevel}\nAttendance Weight: ${score.attendanceWeight.toFixed(1)}%\nGrade Weight: ${score.gradeWeight.toFixed(1)}%\nLast computed: ${score.computedAt.toLocaleDateString()}`,
    data: { studentId, score: score.score, riskLevel: score.riskLevel },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const riskViewActions: ActionDefinition[] = [
  {
    action: 'view_risk_scores',
    description: 'View risk scores for your students',
    destructive: false,
    patterns: [
      /(?:risk|at.?risk)\s+(?:scores?|students?|assessment)/i,
      /who\s+(?:is\s+)?(?:at\s+)?risk/i,
      /show\s+(?:me\s+)?(?:the\s+)?(?:risk|at.?risk)\s+(?:scores?|students?)/i,
      /risk\s+(?:report|list|overview)/i,
      /at.?risk\s+students?/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View risk scores for students in your scope.',
    handler: viewRiskScoresHandler,
  },
  {
    action: 'view_student_risk',
    description: 'View risk score for a specific student',
    destructive: false,
    patterns: [
      /(?:risk|at.?risk)\s+(?:score|level|status)\s+(?:for|of)\s+(.+)/i,
      /(.+?)(?:'s)?\s+(?:risk|at.?risk)\s+(?:score|level|status)/i,
      /how\s+(?:is|about)\s+(.+?)\s+(?:doing\s+)?(?:in\s+)?(?:risk|at.?risk)/i,
      /check\s+(?:the\s+)?(?:risk|at.?risk)\s+(?:of|for)\s+(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      return { studentName: match?.[1]?.trim() || '' };
    },
    descriptionTemplate: (params) =>
      `View risk score for student "${params.studentName}".`,
    handler: viewStudentRiskHandler,
  },
];
