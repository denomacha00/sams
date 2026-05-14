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
  | 'generate_timetable'
  | 'remake_timetable'
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
    // "remake" must come BEFORE "generate" so it matches first
    intent: 'remake_timetable',
    patterns: [
      /remake\s*(a\s*)?timetable/i,
      /regenerate\s*(a\s*)?timetable/i,
      /redo\s*(a\s*)?timetable/i,
      /re[\s-]*generate\s*(a\s*)?timetable/i,
      /re[\s-]*create\s*(a\s*)?timetable/i,
      /delete\s*and\s*(re)?create\s*(a\s*)?timetable/i,
      /reset\s*(a\s*)?timetable/i,
      /rebuild\s*(a\s*)?timetable/i,
      /fresh\s*timetable/i,
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
      const result = match[match.length - 1] ?? match[1];
      if (result) return result.trim();
    }
  }

  return null;
}

/**
 * Detect if the user wants to generate for the whole school (no specific class mentioned).
 */
function isWholeSchoolRequest(question: string): boolean {
  const q = question.toLowerCase();
  // If they mention "whole school", "all classes", "entire school", or just "generate timetable" with no class
  if (/whole\s*school|all\s*classes|entire\s*school|every\s*class/i.test(q)) return true;
  // If no specific class is mentioned, default to whole school
  const className = extractClassName(question);
  return className === null;
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
    default:
      break;
  }

  return scope;
}


// ─── School-Wide Timetable Generator ──────────────────────────────────────────

/**
 * Default Kenyan secondary school subjects.
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
 * Professional school schedule: 8 periods per day, 40 minutes each.
 * Includes morning break and lunch break.
 */
const PERIODS = [
  { startTime: '08:00', endTime: '08:40' },
  { startTime: '08:40', endTime: '09:20' },
  { startTime: '09:20', endTime: '10:00' },
  // BREAK: 10:00–10:20
  { startTime: '10:20', endTime: '11:00' },
  { startTime: '11:00', endTime: '11:40' },
  { startTime: '11:40', endTime: '12:20' },
  // LUNCH: 12:20–13:00
  { startTime: '13:00', endTime: '13:40' },
  { startTime: '13:40', endTime: '14:20' },
] as const;

const DAYS = [0, 1, 2, 3, 4] as const; // Monday to Friday
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const MAX_LESSONS_PER_TEACHER_PER_DAY = 6;

interface TeacherInfo {
  id: string;
  fullName: string;
  departmentId: string | null;
}

interface ClassInfo {
  id: string;
  name: string;
  departmentId: string;
}

interface TimetableSlot {
  schoolId: string;
  classId: string;
  teacherId: string;
  subject: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * Tracks teacher bookings to prevent conflicts.
 * Key format: `${teacherId}:${dayOfWeek}:${startTime}`
 */
class ScheduleTracker {
  // teacher -> day -> set of startTimes booked
  private teacherBookings = new Map<string, Map<number, Set<string>>>();
  // teacher -> day -> count of lessons
  private teacherDailyLoad = new Map<string, Map<number, number>>();
  // class -> day -> set of subjects already assigned
  private classSubjectsPerDay = new Map<string, Map<number, Set<string>>>();
  // class -> day -> set of startTimes booked
  private classBookings = new Map<string, Map<number, Set<string>>>();

  isTeacherAvailable(teacherId: string, day: number, startTime: string): boolean {
    const dayMap = this.teacherBookings.get(teacherId);
    if (!dayMap) return true;
    const times = dayMap.get(day);
    if (!times) return true;
    return !times.has(startTime);
  }

  isTeacherUnderDailyLimit(teacherId: string, day: number): boolean {
    const dayMap = this.teacherDailyLoad.get(teacherId);
    if (!dayMap) return true;
    const count = dayMap.get(day) ?? 0;
    return count < MAX_LESSONS_PER_TEACHER_PER_DAY;
  }

  isClassAvailable(classId: string, day: number, startTime: string): boolean {
    const dayMap = this.classBookings.get(classId);
    if (!dayMap) return true;
    const times = dayMap.get(day);
    if (!times) return true;
    return !times.has(startTime);
  }

  hasSubjectToday(classId: string, day: number, subject: string): boolean {
    const dayMap = this.classSubjectsPerDay.get(classId);
    if (!dayMap) return false;
    const subjects = dayMap.get(day);
    if (!subjects) return false;
    return subjects.has(subject);
  }

  book(teacherId: string, classId: string, day: number, startTime: string, subject: string): void {
    // Teacher booking
    if (!this.teacherBookings.has(teacherId)) {
      this.teacherBookings.set(teacherId, new Map());
    }
    const teacherDayMap = this.teacherBookings.get(teacherId)!;
    if (!teacherDayMap.has(day)) {
      teacherDayMap.set(day, new Set());
    }
    teacherDayMap.get(day)!.add(startTime);

    // Teacher daily load
    if (!this.teacherDailyLoad.has(teacherId)) {
      this.teacherDailyLoad.set(teacherId, new Map());
    }
    const loadMap = this.teacherDailyLoad.get(teacherId)!;
    loadMap.set(day, (loadMap.get(day) ?? 0) + 1);

    // Class booking
    if (!this.classBookings.has(classId)) {
      this.classBookings.set(classId, new Map());
    }
    const classDayMap = this.classBookings.get(classId)!;
    if (!classDayMap.has(day)) {
      classDayMap.set(day, new Set());
    }
    classDayMap.get(day)!.add(startTime);

    // Class subject per day
    if (!this.classSubjectsPerDay.has(classId)) {
      this.classSubjectsPerDay.set(classId, new Map());
    }
    const subjectDayMap = this.classSubjectsPerDay.get(classId)!;
    if (!subjectDayMap.has(day)) {
      subjectDayMap.set(day, new Set());
    }
    subjectDayMap.get(day)!.add(subject);
  }
}


/**
 * Core timetable generation algorithm.
 * Generates a conflict-free timetable for the given classes using available teachers.
 *
 * Algorithm:
 * 1. For each class, determine subjects (round-robin from DEFAULT_SUBJECTS)
 * 2. For each day and period, pick the next subject (avoid repeats same day)
 * 3. Find an available teacher for that subject (same department preferred)
 * 4. If no teacher available, skip the slot
 * 5. Track all bookings to prevent conflicts
 */
function generateTimetableSlots(
  schoolId: string,
  classes: ClassInfo[],
  teachers: TeacherInfo[],
): { slots: TimetableSlot[]; skipped: number; stats: Record<string, number> } {
  const tracker = new ScheduleTracker();
  const slots: TimetableSlot[] = [];
  let skipped = 0;
  const stats: Record<string, number> = {};

  // Group teachers by department for efficient lookup
  const teachersByDept = new Map<string, TeacherInfo[]>();
  const teachersNoDept: TeacherInfo[] = [];

  for (const teacher of teachers) {
    if (teacher.departmentId) {
      const list = teachersByDept.get(teacher.departmentId) ?? [];
      list.push(teacher);
      teachersByDept.set(teacher.departmentId, list);
    } else {
      teachersNoDept.push(teacher);
    }
  }

  // Process each class
  for (const cls of classes) {
    // Get teachers for this class's department, fallback to all teachers
    const deptTeachers = teachersByDept.get(cls.departmentId) ?? [];
    const availableTeachers = deptTeachers.length > 0
      ? [...deptTeachers, ...teachersNoDept]
      : teachers; // If no dept teachers, use all

    if (availableTeachers.length === 0) {
      skipped += DAYS.length * PERIODS.length;
      continue;
    }

    // Create a subject rotation for this class
    const subjects = [...DEFAULT_SUBJECTS];
    let subjectPointer = 0;

    for (const day of DAYS) {
      let periodsFilledToday = 0;

      for (const period of PERIODS) {
        // Check class availability (should always be true for fresh generation)
        if (!tracker.isClassAvailable(cls.id, day, period.startTime)) {
          skipped++;
          continue;
        }

        // Pick next subject, trying to avoid repeats on the same day
        let subject: string | null = null;
        let attempts = 0;
        while (attempts < subjects.length) {
          const candidate = subjects[subjectPointer % subjects.length];
          subjectPointer++;
          attempts++;

          // Prefer subjects not yet used today for this class
          if (!tracker.hasSubjectToday(cls.id, day, candidate)) {
            subject = candidate;
            break;
          }

          // If all subjects used today, allow repeats
          if (attempts === subjects.length) {
            subject = candidate;
          }
        }

        if (!subject) {
          subject = subjects[subjectPointer % subjects.length];
          subjectPointer++;
        }

        // Find an available teacher (round-robin through available teachers)
        let assignedTeacher: TeacherInfo | null = null;
        for (let i = 0; i < availableTeachers.length; i++) {
          const teacher = availableTeachers[i];
          if (
            tracker.isTeacherAvailable(teacher.id, day, period.startTime) &&
            tracker.isTeacherUnderDailyLimit(teacher.id, day)
          ) {
            assignedTeacher = teacher;
            // Rotate the array so next time we start from a different teacher
            availableTeachers.push(availableTeachers.splice(i, 1)[0]);
            break;
          }
        }

        if (!assignedTeacher) {
          // No teacher available for this slot
          skipped++;
          continue;
        }

        // Book the slot
        tracker.book(assignedTeacher.id, cls.id, day, period.startTime, subject);

        slots.push({
          schoolId,
          classId: cls.id,
          teacherId: assignedTeacher.id,
          subject,
          dayOfWeek: day,
          startTime: period.startTime,
          endTime: period.endTime,
        });

        periodsFilledToday++;
      }

      stats[cls.name] = (stats[cls.name] ?? 0) + periodsFilledToday;
    }
  }

  return { slots, skipped, stats };
}


/**
 * Professional school-wide timetable generator.
 * Handles:
 * - "generate timetable" → whole school
 * - "generate timetable for Form 1A" → single class
 * - remake=true → delete existing entries first, then regenerate
 *
 * Conflict-free guarantees:
 * - A teacher cannot be in two classes at the same time
 * - A class cannot have two lessons at the same time
 * - Teachers are assigned within their department when possible
 * - Max 6 lessons per teacher per day
 * - Subjects distributed evenly (no repeats same day if possible)
 */
async function handleGenerateTimetable(
  scope: QueryScope,
  question: string,
  remake: boolean = false,
): Promise<AIQueryResult> {
  const schoolId = scope.schoolId;
  const startTime = Date.now();

  console.log(`[Timetable] Starting ${remake ? 'REMAKE' : 'generation'} for school ${schoolId}`);

  // Determine target: whole school or specific class
  const requestedClassName = extractClassName(question);
  const wholeSchool = isWholeSchoolRequest(question);

  // Get target classes
  let targetClasses: ClassInfo[] = [];

  if (requestedClassName) {
    // Single class requested
    const found = await prisma.class.findFirst({
      where: {
        schoolId,
        name: { contains: requestedClassName, mode: 'insensitive' },
      },
      select: { id: true, name: true, departmentId: true },
    });

    if (!found) {
      const availableClasses = await prisma.class.findMany({
        where: { schoolId },
        select: { name: true },
        take: 15,
      });
      const classList = availableClasses.map((c) => c.name).join(', ');
      return {
        answer: `I couldn't find a class matching "${requestedClassName}". Available classes: ${classList || 'none found'}. Try: "Generate timetable for Form 1A"`,
        intent: 'generate_timetable',
      };
    }

    targetClasses = [found];
  } else if (wholeSchool) {
    // Whole school
    targetClasses = await prisma.class.findMany({
      where: { schoolId },
      select: { id: true, name: true, departmentId: true },
      orderBy: { name: 'asc' },
    });
  } else if (scope.classId) {
    // User's own class
    const found = await prisma.class.findFirst({
      where: { id: scope.classId, schoolId },
      select: { id: true, name: true, departmentId: true },
    });
    if (found) targetClasses = [found];
  }

  if (targetClasses.length === 0) {
    return {
      answer: 'No classes found in the school. Please create classes first before generating a timetable.',
      intent: 'generate_timetable',
    };
  }

  // Get all teachers in the school
  const teachers: TeacherInfo[] = await prisma.user.findMany({
    where: { schoolId, role: 'TEACHER' },
    select: { id: true, fullName: true, departmentId: true },
  });

  if (teachers.length === 0) {
    return {
      answer: 'Cannot generate a timetable: no teachers found in the school. Please add teachers first.',
      intent: 'generate_timetable',
    };
  }

  // If remake, delete existing entries first
  if (remake) {
    const deleteWhere: { schoolId: string; classId?: { in: string[] } } = { schoolId };
    if (!wholeSchool) {
      deleteWhere.classId = { in: targetClasses.map((c) => c.id) };
    }
    const deleted = await prisma.timetableEntry.deleteMany({ where: deleteWhere });
    console.log(`[Timetable] Deleted ${deleted.count} existing entries (remake mode)`);
  } else {
    // Check if timetable already exists
    const existingCount = await prisma.timetableEntry.count({
      where: {
        schoolId,
        classId: { in: targetClasses.map((c) => c.id) },
      },
    });

    if (existingCount > 0) {
      const classNames = targetClasses.map((c) => c.name).join(', ');
      return {
        answer: `Timetable already exists with ${existingCount} entries for: ${classNames}.\n\nTo regenerate, say: "remake timetable" or "regenerate timetable"`,
        intent: 'generate_timetable',
        data: { existingEntries: existingCount },
      };
    }
  }

  // Generate the timetable
  console.log(`[Timetable] Generating for ${targetClasses.length} class(es) with ${teachers.length} teacher(s)`);
  const { slots, skipped, stats } = generateTimetableSlots(schoolId, targetClasses, teachers);

  if (slots.length === 0) {
    return {
      answer: 'Could not generate any timetable entries. This usually means there are not enough teachers available. Please add more teachers and try again.',
      intent: 'generate_timetable',
      data: { skipped },
    };
  }

  // Bulk insert all entries
  const result = await prisma.timetableEntry.createMany({ data: slots });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Timetable] Created ${result.count} entries in ${elapsed}s (${skipped} slots skipped)`);

  // Build summary
  const scope_label = wholeSchool
    ? 'the whole school'
    : targetClasses.length === 1
      ? targetClasses[0].name
      : `${targetClasses.length} classes`;

  const classBreakdown = Object.entries(stats)
    .map(([name, count]) => `  • ${name}: ${count} lessons`)
    .join('\n');

  const summary = `✅ Timetable ${remake ? 'regenerated' : 'generated'} for ${scope_label}!\n\n` +
    `📊 Summary:\n` +
    `• ${result.count} lessons created across ${DAY_NAMES.join(', ')}\n` +
    `• ${targetClasses.length} class(es) scheduled\n` +
    `• ${teachers.length} teacher(s) assigned\n` +
    `• ${skipped} slot(s) skipped (teacher unavailable)\n` +
    `• Schedule: 08:00–14:20 (8 periods × 40 min)\n` +
    `• Breaks: 10:00–10:20 (tea), 12:20–13:00 (lunch)\n` +
    `• Generated in ${elapsed}s\n\n` +
    `📋 Per-class breakdown:\n${classBreakdown}`;

  return {
    answer: summary,
    intent: 'generate_timetable',
    data: {
      entriesCreated: result.count,
      classesProcessed: targetClasses.length,
      teachersUsed: teachers.length,
      skippedSlots: skipped,
      remake,
      elapsed: parseFloat(elapsed),
      stats,
    },
  };
}


// ─── Other Query Handlers ─────────────────────────────────────────────────────

async function handleAttendancePercentage(scope: QueryScope): Promise<AIQueryResult> {
  const where: Record<string, unknown> = { schoolId: scope.schoolId };

  if (scope.studentId) {
    where.studentId = scope.studentId;
  } else if (scope.classId) {
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId: scope.schoolId, classId: scope.classId },
      select: { id: true },
    });
    where.sessionId = { in: sessions.map((s) => s.id) };
  } else if (scope.departmentId) {
    const classes = await prisma.class.findMany({
      where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
      select: { id: true },
    });
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId: scope.schoolId, classId: { in: classes.map((c) => c.id) } },
      select: { id: true },
    });
    where.sessionId = { in: sessions.map((s) => s.id) };
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

async function handleViewTimetable(scope: QueryScope): Promise<AIQueryResult> {
  const schoolId = scope.schoolId;
  const filters: Record<string, unknown> = { schoolId };

  if (scope.classId) {
    filters.classId = scope.classId;
  }

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
        return await handleGenerateTimetable(scope, question, false);
      case 'remake_timetable':
        return await handleGenerateTimetable(scope, question, true);
      case 'view_timetable':
        return await handleViewTimetable(scope);
      case 'student_count':
        return await handleStudentCount(scope);
      case 'session_status':
        return await handleSessionStatus(scope);
      case 'unknown':
      default:
        return {
          answer: `I can help you with:\n• About SAMS ("what is SAMS", "what can you do")\n• Attendance rates and percentages\n• Absent students today\n• Risk scores and at-risk students\n• Top students by attendance\n• Class attendance comparison\n• Generate timetable ("generate timetable" for whole school, or "generate timetable for Form 1A")\n• Remake timetable ("remake timetable", "regenerate timetable")\n• View timetable ("show my timetable")\n• Student count ("how many students")\n• Active sessions ("who is teaching now")\n\nTry asking: "What is SAMS?" or "Generate timetable for the whole school"`,
          intent: 'unknown',
        };
    }
  } catch (err) {
    console.error('[AI/LocalEngine] Handler error:', err);
    return {
      answer: 'I had trouble retrieving that information. Please try again or rephrase your question.',
      intent: intent !== 'unknown' ? intent : 'error_fallback',
    };
  }
}
