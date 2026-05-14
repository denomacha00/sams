import { prisma } from '../../index';
import { type AccessTokenPayload, UserRole } from '@sams/shared';
import { timetableService } from '../timetableService';

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
  | 'generate_timetable'
  | 'view_timetable'
  | 'student_count'
  | 'session_status'
  | 'about_sams'
  | 'unknown';

// ─── Intent Detection ─────────────────────────────────────────────────────────

const INTENT_PATTERNS: { intent: DetectedIntent; patterns: RegExp[] }[] = [
  {
    intent: 'about_sams',
    patterns: [
      /what\s*is\s*sams/i,
      /how\s*does\s*sams\s*work/i,
      /tell\s*me\s*about\s*sams/i,
      /what\s*can\s*you\s*do/i,
      /^help$/i,
      /what\s*are\s*(your|sams('s)?)\s*features/i,
      /about\s*sams/i,
      /explain\s*sams/i,
      /what\s*does\s*sams\s*do/i,
      /sams\s*features/i,
      /describe\s*sams/i,
    ],
  },
  {
    intent: 'generate_timetable',
    patterns: [
      /generate\s*(a\s*)?timetable/i,
      /create\s*(a\s*)?timetable/i,
      /make\s*(a\s*)?timetable/i,
      /auto[\s-]*generate\s*(a\s*)?timetable/i,
      /build\s*(a\s*)?timetable/i,
      /new\s*timetable/i,
      /set\s*up\s*(a\s*)?timetable/i,
    ],
  },
  {
    intent: 'view_timetable',
    patterns: [
      /show\s*(me\s*)?(the\s*)?timetable/i,
      /view\s*(the\s*)?timetable/i,
      /my\s*timetable/i,
      /what('s| is)\s*(the\s*)?(class\s*)?schedule/i,
      /today('s)?\s*(schedule|timetable|classes)/i,
      /what\s*(classes|lessons)\s*(do\s*(i|we)\s*have|are\s*there)/i,
      /timetable\s*(for|of)/i,
      /display\s*(the\s*)?timetable/i,
    ],
  },
  {
    intent: 'student_count',
    patterns: [
      /how\s*many\s*students/i,
      /total\s*(number\s*(of\s*)?)?students/i,
      /student\s*count/i,
      /number\s*of\s*students/i,
      /count\s*(of\s*)?students/i,
    ],
  },
  {
    intent: 'session_status',
    patterns: [
      /active\s*sessions?/i,
      /ongoing\s*(classes|sessions|lessons)/i,
      /who\s*is\s*teaching\s*(now|right\s*now|currently)/i,
      /current\s*(sessions?|classes|lessons)/i,
      /what('s| is)\s*(happening|going\s*on)\s*(now|right\s*now|currently)/i,
      /live\s*sessions?/i,
      /classes?\s*(in\s*progress|happening\s*now|right\s*now)/i,
    ],
  },
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


// ─── Class Name Extraction ────────────────────────────────────────────────────

/**
 * Extract a class name from the user's question for timetable generation.
 * Matches patterns like "Form 1A", "Class 2B", "Grade 3", etc.
 */
function extractClassName(question: string): string | null {
  const patterns = [
    /(?:for|of)\s+(?:class\s+)?([A-Za-z]+\s*\d+\s*[A-Za-z]*)/i,
    /(?:form|class|grade)\s+(\d+\s*[A-Za-z]*)/i,
    /(?:for|of)\s+(form|class|grade)\s+(\d+\s*[A-Za-z]*)/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match) {
      // Return the last captured group that has content
      const result = match[match.length - 1] ?? match[1];
      if (result) return result.trim();
    }
  }

  return null;
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
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId: scope.schoolId, classId: scope.classId },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    where.sessionId = { in: sessionIds };
  } else if (scope.departmentId) {
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

  const students = absentRecords.map((r: any) => ({
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


// ─── New Intent Handlers ──────────────────────────────────────────────────────

/**
 * Default Kenyan secondary school subjects used when class subjects are not configured.
 */
const DEFAULT_SUBJECTS = [
  'Mathematics',
  'English',
  'Kiswahili',
  'Biology',
  'Chemistry',
  'Physics',
  'History',
  'Geography',
  'CRE',
  'Business Studies',
];

/**
 * Generate a timetable for a class.
 * Creates entries for Monday-Friday, 8:00-16:00 with 40-min periods and breaks.
 * Assigns teachers round-robin if not enough teachers for all subjects.
 */
async function handleGenerateTimetable(
  scope: QueryScope,
  question: string,
): Promise<AIQueryResult> {
  const schoolId = scope.schoolId;

  // Extract class name from the question
  const requestedClassName = extractClassName(question);

  // Find the target class
  let targetClass: { id: string; name: string } | null = null;

  if (requestedClassName) {
    targetClass = await prisma.class.findFirst({
      where: {
        schoolId,
        name: { contains: requestedClassName, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
  } else if (scope.classId) {
    // Use the user's own class if no class specified
    targetClass = await prisma.class.findFirst({
      where: { id: scope.classId, schoolId },
      select: { id: true, name: true },
    });
  }

  if (!targetClass) {
    // If no class found, list available classes
    const availableClasses = await prisma.class.findMany({
      where: { schoolId },
      select: { name: true },
      take: 10,
    });

    const classList = availableClasses.map((c) => c.name).join(', ');
    return {
      answer: requestedClassName
        ? `I couldn't find a class matching "${requestedClassName}". Available classes: ${classList || 'none found'}. Try: "Generate timetable for Form 1A"`
        : `Please specify which class to generate a timetable for. Available classes: ${classList || 'none found'}. Try: "Generate timetable for Form 1A"`,
      intent: 'generate_timetable',
    };
  }

  // Check if timetable already exists for this class
  const existingEntries = await prisma.timetableEntry.count({
    where: { schoolId, classId: targetClass.id },
  });

  if (existingEntries > 0) {
    return {
      answer: `Class "${targetClass.name}" already has ${existingEntries} timetable entries. Please delete the existing timetable first if you want to regenerate it.`,
      intent: 'generate_timetable',
      data: { classId: targetClass.id, existingEntries },
    };
  }

  // Get all teachers in the school
  const teachers = await prisma.user.findMany({
    where: { schoolId, role: 'TEACHER' },
    select: { id: true, fullName: true },
  });

  if (teachers.length === 0) {
    return {
      answer: 'Cannot generate a timetable: no teachers found in the school. Please add teachers first.',
      intent: 'generate_timetable',
    };
  }

  // Use default subjects
  const subjects = DEFAULT_SUBJECTS;

  // Define the daily schedule: 8 periods of 40 min with breaks
  // 08:00-08:40, 08:40-09:20, 09:20-10:00, BREAK 10:00-10:20,
  // 10:20-11:00, 11:00-11:40, 11:40-12:20, LUNCH 12:20-13:00,
  // 13:00-13:40, 13:40-14:20, 14:20-15:00, 15:00-15:40
  const periods = [
    { startTime: '08:00', endTime: '08:40' },
    { startTime: '08:40', endTime: '09:20' },
    { startTime: '09:20', endTime: '10:00' },
    // Break: 10:00-10:20
    { startTime: '10:20', endTime: '11:00' },
    { startTime: '11:00', endTime: '11:40' },
    { startTime: '11:40', endTime: '12:20' },
    // Lunch: 12:20-13:00
    { startTime: '13:00', endTime: '13:40' },
    { startTime: '13:40', endTime: '14:20' },
    { startTime: '14:20', endTime: '15:00' },
    { startTime: '15:00', endTime: '15:40' },
  ];

  const days = [0, 1, 2, 3, 4]; // Monday to Friday
  const createdEntries: unknown[] = [];
  let teacherIndex = 0;
  let subjectIndex = 0;

  for (const day of days) {
    for (const period of periods) {
      const subject = subjects[subjectIndex % subjects.length];
      const teacher = teachers[teacherIndex % teachers.length];

      try {
        const entry = await timetableService.createEntry(schoolId, {
          classId: targetClass.id,
          teacherId: teacher.id,
          subject,
          dayOfWeek: day,
          startTime: period.startTime,
          endTime: period.endTime,
        });
        createdEntries.push(entry);
      } catch {
        // Skip conflicts silently — teacher may already be booked
      }

      teacherIndex++;
      subjectIndex++;
    }
  }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const summary = `✅ Timetable generated for ${targetClass.name}!\n\n` +
    `• ${createdEntries.length} lessons created across ${dayNames.join(', ')}\n` +
    `• Schedule: 08:00–15:40 (40-min periods)\n` +
    `• Breaks: 10:00–10:20 (tea), 12:20–13:00 (lunch)\n` +
    `• ${teachers.length} teacher(s) assigned round-robin\n` +
    `• Subjects: ${subjects.join(', ')}`;

  return {
    answer: summary,
    intent: 'generate_timetable',
    data: { classId: targetClass.id, className: targetClass.name, entriesCreated: createdEntries.length },
  };
}


/**
 * View the timetable for the user's class or school.
 */
async function handleViewTimetable(scope: QueryScope): Promise<AIQueryResult> {
  const schoolId = scope.schoolId;
  const filters: Record<string, unknown> = { schoolId };

  if (scope.classId) {
    filters.classId = scope.classId;
  }

  // For students, find their class timetable
  if (scope.studentId) {
    const student = await prisma.user.findUnique({
      where: { id: scope.studentId },
      select: { classId: true },
    });
    if (student?.classId) {
      filters.classId = student.classId;
    }
  }

  const entries = await prisma.timetableEntry.findMany({
    where: filters,
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    include: {
      teacher: { select: { fullName: true } },
      class: { select: { name: true } },
    },
    take: 60,
  });

  if (entries.length === 0) {
    return {
      answer: 'No timetable entries found for your scope. Ask an admin to generate or create a timetable.',
      intent: 'view_timetable',
      data: { entries: [] },
    };
  }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Group by day
  const byDay = new Map<number, typeof entries>();
  for (const entry of entries) {
    const dayEntries = byDay.get(entry.dayOfWeek) ?? [];
    dayEntries.push(entry);
    byDay.set(entry.dayOfWeek, dayEntries);
  }

  let summary = '📅 Timetable:\n';
  for (const [day, dayEntries] of byDay) {
    summary += `\n${dayNames[day] ?? `Day ${day}`}:\n`;
    for (const e of dayEntries) {
      summary += `  ${e.startTime}–${e.endTime}: ${e.subject} (${e.teacher.fullName})\n`;
    }
  }

  return {
    answer: summary,
    intent: 'view_timetable',
    data: { entries: entries.map((e) => ({ ...e, teacher: e.teacher.fullName, class: e.class.name })) },
  };
}

/**
 * Count students in the user's scope.
 */
async function handleStudentCount(scope: QueryScope): Promise<AIQueryResult> {
  const where: Record<string, unknown> = { schoolId: scope.schoolId, role: 'STUDENT' };

  if (scope.classId) {
    where.classId = scope.classId;
  } else if (scope.departmentId) {
    where.departmentId = scope.departmentId;
  }

  const count = await prisma.user.count({ where });

  let scopeLabel = 'in the school';
  if (scope.classId) {
    const cls = await prisma.class.findUnique({ where: { id: scope.classId }, select: { name: true } });
    scopeLabel = cls ? `in ${cls.name}` : 'in your class';
  } else if (scope.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: scope.departmentId }, select: { name: true } });
    scopeLabel = dept ? `in ${dept.name} department` : 'in your department';
  }

  return {
    answer: `There are ${count} student(s) ${scopeLabel}.`,
    intent: 'student_count',
    data: { count, scope: scopeLabel },
  };
}

/**
 * Show active/ongoing attendance sessions.
 */
async function handleSessionStatus(scope: QueryScope): Promise<AIQueryResult> {
  const where: Record<string, unknown> = { schoolId: scope.schoolId, isActive: true };

  if (scope.classId) {
    where.classId = scope.classId;
  }

  const activeSessions = await prisma.attendanceSession.findMany({
    where,
    include: {
      teacher: { select: { fullName: true } },
      class: { select: { name: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });

  if (activeSessions.length === 0) {
    return {
      answer: 'No active sessions right now.',
      intent: 'session_status',
      data: { count: 0, sessions: [] },
    };
  }

  const sessionList = activeSessions.map(
    (s) => `• ${s.subject} — ${s.class.name} (${s.teacher.fullName}, started ${s.startedAt.toLocaleTimeString()})`,
  );

  return {
    answer: `${activeSessions.length} active session(s):\n${sessionList.join('\n')}`,
    intent: 'session_status',
    data: {
      count: activeSessions.length,
      sessions: activeSessions.map((s) => ({
        subject: s.subject,
        className: s.class.name,
        teacher: s.teacher.fullName,
        startedAt: s.startedAt,
      })),
    },
  };
}


// ─── About SAMS Handler ───────────────────────────────────────────────────────

function handleAboutSams(): AIQueryResult {
  const answer = `🎓 **SAMS — Smart Attendance Management System**

SAMS is a multi-school platform designed for Kenyan educational institutions to streamline attendance tracking and school management.

**Core Features:**
• **QR Code Attendance** — Teachers generate session QR codes; students scan to mark attendance instantly
• **GPS Verification** — Validates student location during attendance marking to prevent proxy attendance
• **Biometric (Face Recognition)** — Optional face-based attendance for enhanced security
• **Manual Marking** — Teachers can manually mark attendance when needed
• **Offline-First** — Works without internet; auto-syncs when connectivity is restored

**Smart Features:**
• **Real-Time WebSocket Updates** — Live attendance status across all connected devices
• **AI Assistant** — Ask questions about attendance data, trends, and insights (that's me!)
• **Risk Scoring** — Identifies students at risk of dropping out based on attendance patterns
• **Timetable Management** — Auto-generate and manage class timetables

**Reports & Integration:**
• **Reports** — Generate PDF and Excel reports for attendance, performance, and analytics
• **M-Pesa Payment Integration** — School license payments via M-Pesa
• **Notifications** — SMS and push notifications for parents and staff

**Role-Based Access:**
• Super Admin — Platform-wide management
• School Admin — Full school management
• HOD (Head of Department) — Department oversight
• Teacher — Session and attendance management
• Student — View own attendance and timetable

Developed by Denis Macharia for Kenyan schools. Ask me anything specific!`;

  return {
    answer,
    intent: 'about_sams',
  };
}

// ─── Local Engine ─────────────────────────────────────────────────────────────

/**
 * Local query engine that uses regex-based intent detection and scoped DB queries.
 * Does not require any external AI provider.
 * NEVER throws — always returns a result.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */
export async function localQuery(
  user: AccessTokenPayload,
  question: string,
): Promise<AIQueryResult> {
  const intent = detectIntent(question);
  const scope = buildScope(user);

  try {
    switch (intent) {
      case 'about_sams':
        return handleAboutSams();
      case 'attendance_percentage':
        return await handleAttendancePercentage(scope);
      case 'absent_students':
        return await handleAbsentStudents(scope);
      case 'risk_scores':
        return await handleRiskScores(scope);
      case 'top_students':
        return await handleTopStudents(scope);
      case 'class_comparison':
        return await handleClassComparison(scope);
      case 'generate_timetable':
        return await handleGenerateTimetable(scope, question);
      case 'view_timetable':
        return await handleViewTimetable(scope);
      case 'student_count':
        return await handleStudentCount(scope);
      case 'session_status':
        return await handleSessionStatus(scope);
      case 'unknown':
      default:
        return {
          answer: `I can help you with:\n• About SAMS ("what is SAMS", "what can you do")\n• Attendance rates and percentages\n• Absent students today\n• Risk scores and at-risk students\n• Top students by attendance\n• Class attendance comparison\n• Generate a timetable ("generate timetable for Form 1A")\n• View timetable ("show my timetable")\n• Student count ("how many students")\n• Active sessions ("who is teaching now")\n\nTry asking: "What is SAMS?" or "What is the attendance rate?"`,
          intent: 'unknown',
        };
    }
  } catch (err) {
    console.error('[AI/LocalEngine] Handler error:', err);
    // Never throw — return a graceful fallback
    return {
      answer: 'I had trouble retrieving that information. Please try again or rephrase your question.',
      intent: intent !== 'unknown' ? intent : 'error_fallback',
    };
  }
}
