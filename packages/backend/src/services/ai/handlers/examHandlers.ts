import { UserRole } from '@sams/shared';
import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const listTermsHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const terms = await prisma.academicTerm.findMany({
    where: { schoolId: scope.schoolId },
    orderBy: { startDate: 'desc' },
    select: { id: true, name: true, startDate: true, endDate: true, isActive: true },
  });
  if (terms.length === 0) {
    return { answer: 'No academic terms found for your school.', data: { terms: [] } };
  }
  const lines = terms.map((t) =>
    `• **${t.name}**${t.isActive ? ' (active)' : ''} — ${t.startDate.toLocaleDateString()} to ${t.endDate.toLocaleDateString()}`
  );
  return {
    answer: `📚 **Academic Terms**\n\n${lines.join('\n')}`,
    data: { terms },
  };
};

const listExamsHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const termId = params.termId as string | undefined;
  const classId = params.classId as string | undefined;
  const subject = params.subject as string | undefined;

  const where: Record<string, unknown> = { schoolId: scope.schoolId };
  if (termId) where.termId = termId;
  if (classId) where.classId = classId;
  if (subject) where.subject = { contains: subject, mode: 'insensitive' };

  if (scope.role === UserRole.STUDENT && scope.classId) {
    where.classId = scope.classId;
  }

  const exams = await prisma.exam.findMany({
    where,
    include: {
      term: { select: { name: true, isActive: true } },
      class: { select: { name: true } },
      _count: { select: { results: true } },
    },
    orderBy: { date: 'desc' },
    take: 50,
  });

  if (exams.length === 0) {
    return { answer: 'No exams found matching your criteria.', data: { count: 0 } };
  }

  const lines = exams.map((e) =>
    `• **${e.subject}** (${e.examType}) — ${e.class.name}, ${e.term.name}, ${e.date.toLocaleDateString()}, ${e._count.results} result(s)`
  );

  return {
    answer: `📝 **Exams (${exams.length})**\n\n${lines.join('\n')}`,
    data: { count: exams.length, exams },
  };
};

const viewReportCardHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  let studentId = params.studentId as string | undefined;

  // Student viewing their own
  if (scope.role === UserRole.STUDENT && !studentId) {
    studentId = scope.userId;
  }

  // Guardian viewing linked child — need childName or studentId
  if (scope.role === UserRole.GUARDIAN && !studentId) {
    const childName = (params.childName as string)?.trim();
    if (!childName) {
      return { answer: 'Which child report card should I show? Reply with their name.' };
    }
    const links = await prisma.guardian.findMany({
      where: { guardianId: scope.userId, schoolId: scope.schoolId },
      include: { student: { select: { id: true, fullName: true } } },
    });
    const child = links.find((l) => l.student.fullName.toLowerCase().includes(childName.toLowerCase()));
    if (!child) return { answer: `No linked child matching "${childName}".` };
    studentId = child.student.id;
  }

  if (!studentId) return { answer: 'Which student? Provide their name or ID.' };

  const termId = (params.termId as string) ||
    (await prisma.academicTerm.findFirst({
      where: { schoolId: scope.schoolId, isActive: true },
      select: { id: true },
    }))?.id;

  if (!termId) return { answer: 'No active term found.' };

  // Fetch report card from route logic via exam service
  const exams = await prisma.exam.findMany({
    where: { schoolId: scope.schoolId, termId, results: { some: { studentId } } },
    include: { results: { where: { studentId } } },
  });

  if (exams.length === 0) {
    return { answer: 'No exam results found for this student in the current term.' };
  }

  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { fullName: true, admissionNumber: true, class: { select: { name: true } } },
  });

  const totalPoints = exams.reduce((sum, exam) => {
    const score = exam.results[0]?.score ?? 0;
    const percentage = exam.maxScore > 0 ? (score / exam.maxScore) * 100 : 0;
    return sum + Math.round(percentage);
  }, 0);

  const avgScore = Math.round(totalPoints / exams.length);
  const gradeBoundaries = await prisma.gradeBoundary.findMany({
    where: { schoolId: scope.schoolId },
    orderBy: { minScore: 'asc' },
  });
  const grade = gradeBoundaries.find((gb) => avgScore >= gb.minScore && avgScore <= gb.maxScore);

  const lines = exams.map((e) => {
    const score = e.results[0]?.score ?? 0;
    const pct = e.maxScore > 0 ? ((score / e.maxScore) * 100).toFixed(1) : '0';
    return `• **${e.subject}** (${e.examType}): ${score}/${e.maxScore} = ${pct}%`;
  });

  const name = student ? student.fullName : 'Student';
  const className = student?.class?.name ?? '';

  return {
    answer: `📋 **Report Card — ${name}**${className ? ` (${className})` : ''}\n\n${lines.join('\n')}\n\n**Average:** ${avgScore}%${grade ? ` — Grade ${grade.grade} (${grade.points}pts)` : ''}`,
    data: { studentId, termId, exams, avgScore, grade: grade ?? null },
  };
};

const examResultsHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const examId = params.examId as string | undefined;
  const studentId = params.studentId as string | undefined;

  if (!examId) return { answer: 'Which exam ID should I look up results for?' };

  const exam = await prisma.exam.findFirst({
    where: { id: examId, schoolId: scope.schoolId },
    include: { class: { select: { name: true } }, term: { select: { name: true } } },
  });
  if (!exam) return { answer: 'Exam not found.' };

  const results = await prisma.examResult.findMany({
    where: { examId, ...(studentId ? { studentId } : {}) },
    include: { student: { select: { fullName: true, admissionNumber: true } } },
    orderBy: [{ score: 'desc' }],
    take: 50,
  });

  if (results.length === 0) return { answer: `No results for "${exam.subject}" (${exam.examType}) yet.` };

  const lines = results.map((r) => {
    const pct = exam.maxScore > 0 ? ((r.score / exam.maxScore) * 100).toFixed(1) : '0';
    return `• ${r.student.fullName}: ${r.score}/${exam.maxScore} (${pct}%)`;
  });

  return {
    answer: `📊 **${exam.subject} (${exam.examType}) — ${exam.class.name}**\n\n${lines.join('\n')}`,
    data: { examId, count: results.length, results },
  };
};

const listGradeBoundariesHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const boundaries = await prisma.gradeBoundary.findMany({
    where: { schoolId: scope.schoolId },
    orderBy: { minScore: 'asc' },
  });
  if (boundaries.length === 0) {
    return { answer: 'No grade boundaries configured yet.', data: [] };
  }
  const lines = boundaries.map((b) => `• **${b.grade}**: ${b.minScore}-${b.maxScore}% — ${b.points} point(s)`);
  return {
    answer: `📊 **Grade Boundaries**\n\n${lines.join('\n')}`,
    data: { boundaries },
  };
};

const viewRiskScoresHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const { riskService } = await import('../../riskService');

  let departmentId = scope.role === UserRole.HOD ? scope.departmentId : params.departmentId as string | undefined;
  const classId = params.classId as string | undefined;

  let classIds: string[] | undefined;
  let deptId: string | undefined;

  if (classId) {
    classIds = [classId];
  } else if (scope.role === UserRole.TEACHER) {
    const { resolveTeacherTeachingClassIds } = await import('../../../lib/teacherScope');
    classIds = await resolveTeacherTeachingClassIds(scope.userId, scope.classId);
    if (classIds.length === 0) return { answer: 'Your account is not linked to any classes.' };
  } else if (departmentId) {
    deptId = departmentId;
  }

  const scores = await riskService.getRiskScores(scope.schoolId, deptId, classIds);

  if (scores.length === 0) {
    return { answer: 'No risk scores computed yet.', data: [] };
  }

  const highRisk = scores.filter((s) => s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL');
  const lines = scores.slice(0, 20).map((s) =>
    `• **${s.studentName || s.studentId}**: ${s.score.toFixed(1)} — ${s.riskLevel}${s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL' ? ' 🚨' : ''}`
  );

  let answer = `📊 **Risk Scores (${scores.length} students)**\n\n${lines.join('\n')}`;
  if (highRisk.length > 0) {
    answer += `\n\n🚨 **${highRisk.length} student(s) at HIGH/CRITICAL risk** — intervention recommended.`;
  }

  return { answer, data: { count: scores.length, highRiskCount: highRisk.length, scores } };
};

const viewChildRiskScoresHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const { riskService } = await import('../../riskService');

  const childName = (params.childName as string)?.trim();
  if (!childName) {
    const links = await prisma.guardian.findMany({
      where: { guardianId: scope.userId },
      include: { student: { select: { id: true, fullName: true } } },
    });
    if (links.length === 0) return { answer: 'No linked children found.' };
    if (links.length === 1) {
      const score = await riskService.computeRiskScore(scope.schoolId, links[0].student.id);
      return {
        answer: `📊 **Risk Score — ${links[0].student.fullName}**: ${score.score.toFixed(1)} — ${score.riskLevel}`,
        data: score,
      };
    }
    return {
      answer: `Which child? ${links.map((l) => l.student.fullName).join(', ')}`,
    };
  }

  const links = await prisma.guardian.findMany({
    where: { guardianId: scope.userId },
    include: { student: { select: { id: true, fullName: true } } },
  });
  const child = links.find((l) => l.student.fullName.toLowerCase().includes(childName.toLowerCase()));
  if (!child) return { answer: `No linked child matching "${childName}".` };

  const score = await riskService.computeRiskScore(scope.schoolId, child.student.id);
  return {
    answer: `📊 **Risk Score — ${child.student.fullName}**: ${score.score.toFixed(1)} — ${score.riskLevel}`,
    data: score,
  };
};

const viewAttendanceHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  // Student viewing their own
  if (scope.role === UserRole.STUDENT) {
    const records = await prisma.attendanceRecord.findMany({
      where: { studentId: scope.userId, schoolId: scope.schoolId },
      orderBy: { scannedAt: 'desc' },
      take: 20,
    });
    if (records.length === 0) return { answer: 'No attendance records found.' };
    const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    const pct = ((present / records.length) * 100).toFixed(1);
    return {
      answer: `📊 **Your Attendance**: ${pct}% (${present}/${records.length} sessions)`,
      data: { percentage: parseFloat(pct), total: records.length, present },
    };
  }

  // Teacher/HOD viewing class attendance
  const classId = params.classId as string | undefined;
  if (!classId && scope.role === UserRole.TEACHER) {
    const { resolveTeacherTeachingClassIds } = await import('../../../lib/teacherScope');
    const ids = await resolveTeacherTeachingClassIds(scope.userId, scope.classId);
    if (ids.length === 0) return { answer: 'No linked classes found.' };
    // Use first class
    return {
      answer: 'Which class attendance should I show? Reply with the class name.',
      data: { classIds: ids },
    };
  }

  if (!classId) return { answer: 'Which class? Provide the class ID or name.' };

  const cls = await prisma.class.findFirst({
    where: { schoolId: scope.schoolId, ...(classId.length > 10 ? { id: classId } : { name: { contains: classId, mode: 'insensitive' } }) },
  });
  if (!cls) return { answer: 'Class not found.' };

  const records = await prisma.attendanceRecord.findMany({
    where: { schoolId: scope.schoolId, session: { classId: cls.id } },
    include: { student: { select: { fullName: true } } },
    orderBy: { scannedAt: 'desc' },
    take: 50,
  });

  const total = records.length;
  if (total === 0) return { answer: `No attendance records for ${cls.name}.` };

  const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const pct = ((present / total) * 100).toFixed(1);

  return {
    answer: `📊 **${cls.name} Attendance**: ${pct}% overall (${present}/${total} present/late)`,
    data: { classId: cls.id, className: cls.name, percentage: parseFloat(pct), total, present },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const examActions: ActionDefinition[] = [
  {
    action: 'list_terms',
    description: 'List all academic terms for your school',
    destructive: false,
    patterns: [
      /(?:list|show|view)\s+(?:academic\s+)?terms?/i,
      /what\s+terms?\s+(?:are\s+)?(?:there|available|active)/i,
      /(?:current|active)\s+terms?/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List academic terms for your school.',
    handler: listTermsHandler,
  },
  {
    action: 'list_exams',
    description: 'List exams filtered by term, class, or subject',
    destructive: false,
    patterns: [
      /(?:list|show|view)\s+(?:exams?|tests?|assessments?)/i,
      /what\s+exams?\s+(?:are\s+)?(?:there|coming|scheduled)/i,
      /exams?\s+(?:in|for|during)\s+(.+)/i,
    ],
    extractParams: (message: string) => {
      const classMatch = message.match(/(?:class|for)\s+["']?([^"',.]+?)["']?/i);
      const subjectMatch = message.match(/subject\s+(.+)/i);
      return {
        className: classMatch?.[1]?.trim(),
        subject: subjectMatch?.[1]?.trim(),
      };
    },
    descriptionTemplate: (params) => `List exams${params.subject ? ` for ${params.subject}` : ''}${params.className ? ` in ${params.className}` : ''}.`,
    handler: listExamsHandler,
  },
  {
    action: 'view_report_card',
    description: 'View report card / exam results summary for a student in the active term',
    destructive: false,
    patterns: [
      /(?:report\s*card|results?|grades?|marks?|performance)\s*(?:for\s+)?(.+)?/i,
      /(?:show|view|get)\s+(?:my\s+)?(?:report|results|grades|marks)/i,
      /how\s+(?:did|am)\s+(?:i|.+?)\s+(?:do|perform)/i,
      /(?:student|child)\s+(?:report|results?|grades?)/i,
    ],
    extractParams: (message: string) => {
      const childMatch = message.match(/(?:for|of|about)\s+(.+?)(?:\s+(?:report|results|grades|marks)|$)/i);
      return {
        childName: childMatch?.[1]?.trim(),
        studentId: undefined,
      };
    },
    descriptionTemplate: () => 'View report card / exam results summary.',
    handler: viewReportCardHandler,
  },
  {
    action: 'view_exam_results',
    description: 'View results for a specific exam',
    destructive: false,
    patterns: [
      /(?:results?|marks?|scores?)\s+(?:for|of|in)\s+(?:exam|test|assessment)\s+(.+)/i,
      /exam\s+(.+?)\s+(?:results?|marks?|scores?)/i,
    ],
    extractParams: (message: string) => {
      const match = message.match(/(?:exam|test|assessment)\s+(.+?)(?:\s+(?:results|marks|scores)|$)/i);
      return { subject: match?.[1]?.trim() };
    },
    descriptionTemplate: (params) => `View results for ${params.subject || 'exam'}.`,
    handler: examResultsHandler,
  },
  {
    action: 'list_grade_boundaries',
    description: 'List grade boundaries and point system',
    destructive: false,
    patterns: [
      /(?:grade\s+)?boundar(?:y|ies)/i,
      /grading\s+(?:system|scale)/i,
      /how\s+(?:are\s+)?grades?\s+(?:calculated|determined)/i,
      /what\s+grades?\s+exist/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List grade boundaries and point system.',
    handler: listGradeBoundariesHandler,
  },
  {
    action: 'view_risk_scores',
    description: 'View dropout risk scores for students in your scope',
    destructive: false,
    patterns: [
      /(?:risk|at[\s-]risk)\s+(?:scores?|students?|assessments?)/i,
      /who\s+(?:is|are)\s+(?:at\s+)?risk/i,
      /dropout\s+risk/i,
      /student\s+risk/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View dropout risk scores for students.',
    handler: viewRiskScoresHandler,
  },
  {
    action: 'view_child_risk_score',
    description: 'View risk score for a linked child (guardian only)',
    destructive: false,
    patterns: [
      /(?:child|ward|student)(?:'s)?\s+(?:risk|at[\s-]risk)/i,
      /risk\s+(?:score|level)\s+(?:for|of)\s+(.+)/i,
    ],
    extractParams: (message: string) => {
      const match = message.match(/(?:for|of|about)\s+(.+?)(?:\s+(?:risk|at[\s-]risk)|$)/i);
      return { childName: match?.[1]?.trim() };
    },
    descriptionTemplate: () => 'View risk score for linked child.',
    handler: viewChildRiskScoresHandler,
  },
];

// Attendance handler for teacher/HOD to view class attendance stats
export const classAttendanceAction: ActionDefinition = {
  action: 'view_class_attendance',
  description: 'View attendance statistics for a class',
  destructive: false,
  patterns: [
    /(?:class\s+)?attendance\s+(?:stats|statistics|rate|percentage|overview)/i,
    /how\s+(?:is|are)\s+(?:the\s+)?(?:class|students?)\s+(?:doing|performing)\s+(?:in\s+)?attendance/i,
  ],
  extractParams: (message: string) => {
    const classMatch = message.match(/(?:for|of|class)\s+["']?([^"',.]+?)["']?/i);
    return { className: classMatch?.[1]?.trim() };
  },
  descriptionTemplate: (params) => `View attendance for${params.className ? ` ${params.className}` : ' class'}.`,
  handler: viewAttendanceHandler,
};
