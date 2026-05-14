import { prisma } from '../../index';
import { type AccessTokenPayload, UserRole } from '@sams/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIQueryResult {
  answer: string;
  intent: string;
  data?: unknown;
}

export type DetectedIntent =
  | 'attendance_percentage'
  | 'absent_students'
  | 'risk_scores'
  | 'top_students'
  | 'class_comparison'
  | 'unknown';

// ─── Intent Detection ─────────────────────────────────────────────────────────

const INTENT_PATTERNS: { intent: DetectedIntent; patterns: RegExp[] }[] = [
  {
    intent: 'attendance_percentage',
    patterns: [
      /attendance\s*(rate|percentage|%)/i,
      /what\s*(is|are)\s*(the\s*)?(overall\s*)?attendance/i,
      /how\s*(is|are)\s*(the\s*)?attendance/i,
      /percentage\s*(of\s*)?(attendance|present)/i,
    ],
  },
  {
    intent: 'absent_students',
    patterns: [
      /who\s*(is|are)\s*(absent|missing)/i,
      /absent\s*students/i,
      /students?\s*(who\s*)?(are\s*)?absent/i,
      /missing\s*students/i,
      /not\s*(present|attending|here)/i,
    ],
  },
  {
    intent: 'risk_scores',
    patterns: [
      /risk\s*(score|level|rating)/i,
      /at\s*risk/i,
      /dropout\s*risk/i,
      /high\s*risk/i,
      /critical\s*risk/i,
      /students?\s*(at\s*)?risk/i,
    ],
  },
  {
    intent: 'top_students',
    patterns: [
      /top\s*students/i,
      /best\s*(attendance|performing|students)/i,
      /highest\s*attendance/i,
      /most\s*present/i,
      /perfect\s*attendance/i,
    ],
  },
  {
    intent: 'class_comparison',
    patterns: [
      /compare\s*(class|classes)/i,
      /class\s*comparison/i,
      /which\s*class\s*(has|is)/i,
      /best\s*class/i,
      /worst\s*class/i,
      /class\s*(ranking|performance)/i,
    ],
  },
];

/**
 * Detect the user's intent from a natural language question using regex patterns.
 * Requirements: 14.4
 */
export function detectIntent(question: string): DetectedIntent {
  const q = question.toLowerCase().trim();

  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(q)) {
        return intent;
      }
    }
  }

  return 'unknown';
}

// ─── Scope Builder ────────────────────────────────────────────────────────────

interface QueryScope {
  schoolId: string;
  classId?: string;
  studentId?: string;
  departmentId?: string;
}

/**
 * Build a query scope based on the user's role.
 * - Teacher → scoped to their classId
 * - Student → scoped to their own studentId
 * - HOD → scoped to their departmentId
 * - SCHOOL_ADMIN → school-wide (no additional filter)
 *
 * Requirements: 14.1, 14.2, 14.3
 */
function buildScope(user: AccessTokenPayload): QueryScope {
  const scope: QueryScope = { schoolId: user.schoolId };

  switch (user.role) {
    case UserRole.TEACHER:
      if (user.classId) {
        scope.classId = user.classId;
      }
      break;
    case UserRole.STUDENT:
      scope.studentId = user.sub;
      break;
    case UserRole.HOD:
      if (user.departmentId) {
        scope.departmentId = user.departmentId;
      }
      break;
    // SCHOOL_ADMIN and SUPER_ADMIN get school-wide scope
    default:
      break;
  }

  return scope;
}

// ─── Query Handlers ───────────────────────────────────────────────────────────

async function handleAttendancePercentage(scope: QueryScope): Promise<AIQueryResult> {
  const where: Record<string, unknown> = { schoolId: scope.schoolId };

  if (scope.studentId) {
    where.studentId = scope.studentId;
  } else if (scope.classId) {
    // Get sessions for this class, then filter records by those sessions
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId: scope.schoolId, classId: scope.classId },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    where.sessionId = { in: sessionIds };
  } else if (scope.departmentId) {
    // Get classes in department, then sessions, then records
    const classes = await prisma.class.findMany({
      where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
      select: { id: true },
    });
    const classIds = classes.map((c) => c.id);
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId: scope.schoolId, classId: { in: classIds } },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    where.sessionId = { in: sessionIds };
  }

  const totalRecords = await prisma.attendanceRecord.count({ where });
  const presentRecords = await prisma.attendanceRecord.count({
    where: { ...where, status: { in: ['PRESENT', 'LATE'] } },
  });

  if (totalRecords === 0) {
    return {
      answer: 'No attendance records found for your scope.',
      intent: 'attendance_percentage',
      data: { totalRecords: 0, presentRecords: 0, percentage: 0 },
    };
  }

  const percentage = ((presentRecords / totalRecords) * 100).toFixed(1);

  return {
    answer: `The attendance rate is ${percentage}% (${presentRecords} present/late out of ${totalRecords} total records).`,
    intent: 'attendance_percentage',
    data: { totalRecords, presentRecords, percentage: parseFloat(percentage) },
  };
}

async function handleAbsentStudents(scope: QueryScope): Promise<AIQueryResult> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = {
    schoolId: scope.schoolId,
    status: 'ABSENT',
    scannedAt: { gte: today },
  };

  if (scope.studentId) {
    where.studentId = scope.studentId;
  } else if (scope.classId) {
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId: scope.schoolId, classId: scope.classId, startedAt: { gte: today } },
      select: { id: true },
    });
    where.sessionId = { in: sessions.map((s) => s.id) };
  } else if (scope.departmentId) {
    const classes = await prisma.class.findMany({
      where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
      select: { id: true },
    });
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId: scope.schoolId, classId: { in: classes.map((c) => c.id) }, startedAt: { gte: today } },
      select: { id: true },
    });
    where.sessionId = { in: sessions.map((s) => s.id) };
  }

  const absentRecords = await prisma.attendanceRecord.findMany({
    where,
    include: { student: { select: { fullName: true, admissionNumber: true } } },
    take: 20,
  });

  if (absentRecords.length === 0) {
    return {
      answer: 'No absent students recorded today within your scope.',
      intent: 'absent_students',
      data: { count: 0, students: [] },
    };
  }

  const students = absentRecords.map((r) => ({
    name: r.student.fullName,
    admissionNumber: r.student.admissionNumber,
  }));

  const names = students.map((s) => s.name).join(', ');

  return {
    answer: `${absentRecords.length} student(s) marked absent today: ${names}`,
    intent: 'absent_students',
    data: { count: absentRecords.length, students },
  };
}

async function handleRiskScores(scope: QueryScope): Promise<AIQueryResult> {
  const where: Record<string, unknown> = { schoolId: scope.schoolId };

  if (scope.studentId) {
    where.studentId = scope.studentId;
  } else if (scope.departmentId) {
    const students = await prisma.user.findMany({
      where: { schoolId: scope.schoolId, departmentId: scope.departmentId, role: 'STUDENT' },
      select: { id: true },
    });
    where.studentId = { in: students.map((s) => s.id) };
  } else if (scope.classId) {
    const students = await prisma.user.findMany({
      where: { schoolId: scope.schoolId, classId: scope.classId, role: 'STUDENT' },
      select: { id: true },
    });
    where.studentId = { in: students.map((s) => s.id) };
  }

  const riskScores = await prisma.riskScore.findMany({
    where,
    orderBy: { score: 'desc' },
    take: 10,
    include: {
      // RiskScore doesn't have a direct student relation, so we query separately
    },
  });

  if (riskScores.length === 0) {
    return {
      answer: 'No risk scores computed yet for your scope.',
      intent: 'risk_scores',
      data: { count: 0, scores: [] },
    };
  }

  // Get student names for the risk scores
  const studentIds = riskScores.map((r) => r.studentId);
  const students = await prisma.user.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, fullName: true },
  });
  const studentMap = new Map(students.map((s) => [s.id, s.fullName]));

  const highRisk = riskScores.filter((r) => r.riskLevel === 'HIGH' || r.riskLevel === 'CRITICAL');
  const summary = riskScores.map(
    (r) => `${studentMap.get(r.studentId) ?? 'Unknown'}: ${r.score.toFixed(1)} (${r.riskLevel})`,
  );

  return {
    answer: `${highRisk.length} student(s) at high/critical risk. Top risk scores:\n${summary.join('\n')}`,
    intent: 'risk_scores',
    data: { count: riskScores.length, highRiskCount: highRisk.length, scores: riskScores },
  };
}

async function handleTopStudents(scope: QueryScope): Promise<AIQueryResult> {
  // Find students with highest attendance in scope
  const where: Record<string, unknown> = { schoolId: scope.schoolId, role: 'STUDENT' };

  if (scope.studentId) {
    where.id = scope.studentId;
  } else if (scope.classId) {
    where.classId = scope.classId;
  } else if (scope.departmentId) {
    where.departmentId = scope.departmentId;
  }

  const students = await prisma.user.findMany({
    where,
    select: { id: true, fullName: true },
    take: 50,
  });

  if (students.length === 0) {
    return {
      answer: 'No students found in your scope.',
      intent: 'top_students',
      data: { students: [] },
    };
  }

  // Count present records per student
  const studentAttendance = await Promise.all(
    students.map(async (student) => {
      const total = await prisma.attendanceRecord.count({
        where: { studentId: student.id, schoolId: scope.schoolId },
      });
      const present = await prisma.attendanceRecord.count({
        where: { studentId: student.id, schoolId: scope.schoolId, status: { in: ['PRESENT', 'LATE'] } },
      });
      const percentage = total > 0 ? (present / total) * 100 : 0;
      return { name: student.fullName, percentage, total, present };
    }),
  );

  // Sort by percentage descending and take top 5
  const topStudents = studentAttendance
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 5);

  const summary = topStudents
    .map((s, i) => `${i + 1}. ${s.name}: ${s.percentage.toFixed(1)}%`)
    .join('\n');

  return {
    answer: `Top students by attendance:\n${summary}`,
    intent: 'top_students',
    data: { students: topStudents },
  };
}

async function handleClassComparison(scope: QueryScope): Promise<AIQueryResult> {
  // Get classes within scope
  const classWhere: Record<string, unknown> = { schoolId: scope.schoolId };

  if (scope.departmentId) {
    classWhere.departmentId = scope.departmentId;
  }

  const classes = await prisma.class.findMany({
    where: classWhere,
    select: { id: true, name: true },
  });

  if (classes.length === 0) {
    return {
      answer: 'No classes found in your scope for comparison.',
      intent: 'class_comparison',
      data: { classes: [] },
    };
  }

  // Compute attendance rate per class
  const classStats = await Promise.all(
    classes.map(async (cls) => {
      const sessions = await prisma.attendanceSession.findMany({
        where: { schoolId: scope.schoolId, classId: cls.id },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);

      if (sessionIds.length === 0) {
        return { name: cls.name, percentage: 0, totalRecords: 0 };
      }

      const total = await prisma.attendanceRecord.count({
        where: { sessionId: { in: sessionIds }, schoolId: scope.schoolId },
      });
      const present = await prisma.attendanceRecord.count({
        where: { sessionId: { in: sessionIds }, schoolId: scope.schoolId, status: { in: ['PRESENT', 'LATE'] } },
      });

      const percentage = total > 0 ? (present / total) * 100 : 0;
      return { name: cls.name, percentage, totalRecords: total };
    }),
  );

  // Sort by percentage descending
  const sorted = classStats.sort((a, b) => b.percentage - a.percentage);
  const summary = sorted
    .map((c, i) => `${i + 1}. ${c.name}: ${c.percentage.toFixed(1)}%`)
    .join('\n');

  return {
    answer: `Class attendance comparison:\n${summary}`,
    intent: 'class_comparison',
    data: { classes: sorted },
  };
}

// ─── Local Engine ─────────────────────────────────────────────────────────────

/**
 * Local query engine that uses regex-based intent detection and scoped DB queries.
 * Does not require any external AI provider.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */
export async function localQuery(
  user: AccessTokenPayload,
  question: string,
): Promise<AIQueryResult> {
  const intent = detectIntent(question);
  const scope = buildScope(user);

  switch (intent) {
    case 'attendance_percentage':
      return handleAttendancePercentage(scope);
    case 'absent_students':
      return handleAbsentStudents(scope);
    case 'risk_scores':
      return handleRiskScores(scope);
    case 'top_students':
      return handleTopStudents(scope);
    case 'class_comparison':
      return handleClassComparison(scope);
    case 'unknown':
    default:
      return {
        answer: `I can help you with:\n• Attendance rates and percentages\n• Absent students today\n• Risk scores and at-risk students\n• Top students by attendance\n• Class attendance comparison\n\nTry asking: "What is the attendance rate?" or "Who is absent today?" or "Show risk scores"`,
        intent: 'unknown',
      };
  }
}
