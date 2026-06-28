import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const viewStudentDetailHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const studentName = (params.studentName as string)?.trim() || '';
  if (!studentName) {
    return { answer: 'Which student would you like to look up? Please provide their full name.' };
  }

  // Find student by name in the same school
  const student = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'STUDENT',
      fullName: { contains: studentName, mode: 'insensitive' },
    },
    select: {
      id: true,
      fullName: true,
      admissionNumber: true,
      isClassRep: true,
      class: { select: { id: true, name: true, department: { select: { name: true } } } },
    },
  });

  if (!student) {
    return { answer: `Student "${studentName}" not found in your school.` };
  }

  // Fetch attendance summary
  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: { studentId: student.id, schoolId: scope.schoolId },
    select: { status: true },
  });

  const totalAttendance = attendanceRecords.length;
  const presentCount = attendanceRecords.filter(
    (r) => r.status === 'PRESENT' || r.status === 'LATE',
  ).length;
  const attendancePercent = totalAttendance > 0
    ? ((presentCount / totalAttendance) * 100).toFixed(1)
    : 'N/A';

  // Fetch latest exam results (top 5 subjects)
  const latestResults = await prisma.examResult.findMany({
    where: { studentId: student.id, exam: { schoolId: scope.schoolId } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { exam: { select: { subject: true, examType: true, maxScore: true, date: true } } },
  });

  // Fetch risk score
  const riskScore = await prisma.riskScore.findUnique({
    where: { studentId: student.id },
    select: { score: true, riskLevel: true, computedAt: true },
  });

  // Build response
  const lines: string[] = [
    `🔍 **Student Detail: ${student.fullName}**`,
    '',
    `• **Admission No:** ${student.admissionNumber || 'N/A'}`,
    `• **Class:** ${student.class?.name || 'N/A'}`,
    `• **Department:** ${student.class?.department?.name || 'N/A'}`,
    `• **Class Rep:** ${student.isClassRep ? 'Yes' : 'No'}`,
    '',
    `**Attendance**`,
    `• Overall: ${attendancePercent}% (${presentCount}/${totalAttendance} sessions)`,
    '',
  ];

  if (latestResults.length > 0) {
    lines.push(`**Latest Exam Scores**`);
    latestResults.forEach((r) => {
      const pct = r.exam.maxScore > 0 ? ((r.score / r.exam.maxScore) * 100).toFixed(1) : 'N/A';
      lines.push(`• ${r.exam.subject} (${r.exam.examType}): ${r.score}/${r.exam.maxScore} (${pct}%)`);
    });
    lines.push('');
  } else {
    lines.push('**Latest Exam Scores**\n• No exam scores recorded yet.\n');
  }

  if (riskScore) {
    const emoji = riskScore.riskLevel === 'CRITICAL' || riskScore.riskLevel === 'HIGH' ? '🚨' : '✅';
    lines.push(
      `**Risk Assessment**`,
      `• ${emoji} Score: ${riskScore.score.toFixed(1)} — ${riskScore.riskLevel}`,
      `• Last computed: ${riskScore.computedAt.toLocaleDateString()}`,
    );
  } else {
    lines.push('**Risk Assessment**\n• Not yet computed for this student.');
  }

  return {
    answer: lines.join('\n'),
    data: {
      studentId: student.id,
      fullName: student.fullName,
      admissionNumber: student.admissionNumber,
      className: student.class?.name,
      departmentName: student.class?.department?.name,
      attendancePercent: attendancePercent === 'N/A' ? null : parseFloat(attendancePercent),
      totalAttendance,
      presentCount,
      latestResults: latestResults.map((r) => ({
        subject: r.exam.subject,
        examType: r.exam.examType,
        score: r.score,
        maxScore: r.exam.maxScore,
      })),
      riskScore: riskScore ?? null,
    },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const teacherWorkbenchActions: ActionDefinition[] = [
  {
    action: 'view_student_detail',
    description: 'View detailed information about a specific student (attendance, exam scores, risk)',
    destructive: false,
    patterns: [
      /(?:view|show|get)\s+(?:student|pupil)\s+(.+?)(?:\s+(?:details?|profile|info|data))?/i,
      /(?:view|show|get)\s+(?:details?|profile|info|data)\s+(?:for\s+)?(?:student|pupil)\s+(.+)/i,
      /what\s+(?:is|are)\s+(?:the\s+)?(?:details?|info|data)\s+(?:for|about|on)\s+(?:student|pupil)\s+(.+)/i,
      /look\s+up\s+(?:student|pupil)\s+(.+)/i,
      /(?:student|pupil)\s+(.+?)\s+(?:details?|profile|info|data)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      let studentName = match && match[1] ? match[1].trim() : '';
      if (!studentName) {
        const nameMatch = message.match(/student\s+(.+?)(?:\s+(?:details?|profile|info|data))?$/i);
        if (nameMatch && nameMatch[1]) {
          studentName = nameMatch[1].trim();
        }
      }
      return { studentName };
    },
    descriptionTemplate: (params) =>
      `View detailed information for student "${params.studentName}".`,
    handler: viewStudentDetailHandler,
  },
];
