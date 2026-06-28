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

const viewClassAttendanceHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const classId = params.classId as string | undefined;
  let resolvedClassId = classId;

  if (!resolvedClassId && scope.role === UserRole.TEACHER) {
    const { resolveTeacherTeachingClassIds } = await import('../../../lib/teacherScope');
    const ids = await resolveTeacherTeachingClassIds(scope.userId, scope.classId);
    if (ids.length === 0) return { answer: 'No linked classes found.' };
    if (ids.length === 1) {
      resolvedClassId = ids[0];
    } else {
      return { answer: 'Which class attendance should I show? Reply with the class name.', data: { classIds: ids } };
    }
  }

  if (!resolvedClassId) return { answer: 'Which class? Provide the class name.' };

  const cls = await prisma.class.findFirst({
    where: { schoolId: scope.schoolId, ...(resolvedClassId.length > 10 ? { id: resolvedClassId } : { name: { contains: resolvedClassId, mode: 'insensitive' } }) },
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

function extractScoreResultParams(message: string, _match: RegExpMatchArray | null): Record<string, unknown> {
  const scoreMatch = message.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  const subjectMatch = message.match(/(?:for|subject|exam|test|assessment)\s+["']?([^"',.]+?)["']?\s*(?:score|result|marks?|grade)?/i) ||
    message.match(/(?:score|result|marks?|grade)\s+(?:for|of|in)\s+["']?([^"',.]+?)["']?/i);
  const studentMatch = message.match(/(?:student|for)\s+["']?([^"',.]+?)["']?\s*(?:scored|got|received)?/i);

  let examType = 'Exam';
  if (/\bcats?\b|continuous|assessment/i.test(message)) examType = 'CAT';
  else if (/mid\s*(?:term|semester)/i.test(message)) examType = 'MID_TERM';
  else if (/end\s*(?:term|semester)|final/i.test(message)) examType = 'END_TERM';
  else if (/quiz/i.test(message)) examType = 'QUIZ';
  else if (/practical/i.test(message)) examType = 'PRACTICAL';
  else if (/project/i.test(message)) examType = 'PROJECT';

  return {
    studentName: studentMatch?.[1]?.trim() || '',
    subject: subjectMatch?.[1]?.trim() || '',
    score: scoreMatch ? parseFloat(scoreMatch[1]) : undefined,
    maxScore: scoreMatch ? parseFloat(scoreMatch[2]) : undefined,
    examType,
  };
}

const enterExamResultHandler: ActionHandler = async (params, scope) => {
  const studentName = String(params.studentName || '').trim();
  const subject = String(params.subject || '').trim();
  const score = typeof params.score === 'number' ? params.score : undefined;
  const maxScore = typeof params.maxScore === 'number' ? params.maxScore : undefined;
  const examType = String(params.examType || 'Exam').toUpperCase();

  if (!studentName) return { answer: 'Which student scored this mark? Provide their name.' };
  if (!subject) return { answer: 'Which subject? Provide the subject name.' };
  if (score === undefined || maxScore === undefined || maxScore <= 0) {
    return { answer: 'Provide the score like eg. **"John scored 30/50 in Math CAT"**.' };
  }

  const { prisma } = await import('../../../lib/prisma');

  const student = await prisma.user.findFirst({
    where: { schoolId: scope.schoolId, role: 'STUDENT', fullName: { contains: studentName, mode: 'insensitive' } },
    select: { id: true, fullName: true },
  });
  if (!student) return { answer: `Student "${studentName}" not found.` };

  // Find the active term
  const term = await prisma.academicTerm.findFirst({
    where: { schoolId: scope.schoolId, isActive: true },
    select: { id: true, name: true },
  });
  if (!term) return { answer: 'No active academic term. Set one up in Exams & Grades first.' };

  // Find or create the exam
  let exam = await prisma.exam.findFirst({
    where: { schoolId: scope.schoolId, termId: term.id, subject, examType },
    select: { id: true, maxScore: true },
  });
  if (!exam) {
    const studentClass = await prisma.user.findUnique({
      where: { id: student.id },
      select: { classId: true },
    });
    if (!studentClass?.classId) return { answer: `${student.fullName} is not assigned to a class.` };
    exam = await prisma.exam.create({
      data: {
        schoolId: scope.schoolId,
        termId: term.id,
        classId: studentClass.classId,
        subject,
        examType,
        maxScore,
        weight: 1.0,
        date: new Date(),
        createdById: scope.userId,
      },
      select: { id: true, maxScore: true },
    });
  }

  const existingMaxScore = exam.maxScore;
  const finalMaxScore = maxScore || existingMaxScore;
  if (finalMaxScore <= 0) return { answer: 'Max score must be greater than 0.' };

  const result = await prisma.examResult.upsert({
    where: { examId_studentId: { examId: exam.id, studentId: student.id } },
    create: { examId: exam.id, studentId: student.id, score: score! },
    update: { score: score! },
  });

  const pct = finalMaxScore > 0 ? ((score! / finalMaxScore) * 100).toFixed(1) : 'N/A';

  return {
    answer: `✅ **${student.fullName}** scored **${score}/${finalMaxScore}** (${pct}%) in **${subject}** (${examType}) — ${term.name}.`,
    data: {
      studentId: student.id,
      examId: exam.id,
      resultId: result.id,
      subject,
      score,
      maxScore: finalMaxScore,
      examType,
      termId: term.id,
    },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────
// NOTE: Risk score actions are in riskViewHandlers.ts — only exam-related actions here

export const examActions: ActionDefinition[] = [
  {
    action: 'enter_exam_result',
    description: 'Enter or update a student\'s exam score for a subject. Use "John scored 30/50 in Math" format.',
    destructive: false,
    patterns: [
      /(?:scored|got|received|marks?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+(?:in|for|on)\s+(.+)/i,
      /(?:enter|record|add|save|submit)\s+(?:marks?|results?|scores?|grade)\s+(?:for|of)\s+(.+?)(?:\s+(?:in|for|on)\s+(.+))?/i,
      /(?:student|pupil)\s+(.+?)\s+(?:scored|got|received)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i,
    ],
    extractParams: extractScoreResultParams,
    descriptionTemplate: (params) =>
      `Enter exam result: ${params.studentName || 'student'} scored ${params.score ?? '?'}/${params.maxScore ?? '?'} in ${params.subject || 'subject'}.`,
    handler: enterExamResultHandler,
  },
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
];

// Class attendance action — for TEACHER and HOD
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
  handler: viewClassAttendanceHandler,
};
