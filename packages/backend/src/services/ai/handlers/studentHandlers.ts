import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import {
  formatStudentTeachersAnswer,
  getStudentClassContext,
} from '../../../lib/studentClassTeachers';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const viewAttendanceHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');

  const records = await prisma.attendanceRecord.findMany({
    where: { studentId: scope.userId, schoolId: scope.schoolId },
    orderBy: { scannedAt: 'desc' },
    take: 20,
    include: { session: { select: { subject: true } } },
  });

  if (records.length === 0) {
    return { answer: 'No attendance records found.' };
  }

  const total = records.length;
  const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const percentage = ((present / total) * 100).toFixed(1);

  const recent = records.slice(0, 5).map((r) => {
    const date = r.scannedAt.toLocaleDateString();
    return `• ${date} — ${r.session?.subject || 'General'}: ${r.status}`;
  });

  return {
    answer: `📊 **Your Attendance**\n\nOverall: ${percentage}% (${present}/${total} sessions)\n\n**Recent:**\n${recent.join('\n')}`,
    data: { percentage: parseFloat(percentage), total, present, records: records.length },
  };
};

const listMyTeachersHandler: ActionHandler = async (_params, scope) => {
  if (!scope.classId) {
    return { answer: 'Your account is not linked to a class yet, so I cannot list your teachers. Contact your school admin.' };
  }

  const ctx = await getStudentClassContext(scope.classId);
  if (!ctx) {
    return { answer: 'I could not find your class. Contact your school admin.' };
  }

  return {
    answer: formatStudentTeachersAnswer(ctx),
    data: { classId: ctx.classId, className: ctx.className, teachers: ctx.teachers },
  };
};

const viewTimetableHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');

  if (!scope.classId) {
    return { answer: 'Your account is not associated with a class.' };
  }

  const classCtx = await getStudentClassContext(scope.classId);

  const timetable = await prisma.timetableEntry.findMany({
    where: { classId: scope.classId },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    include: { teacher: { select: { fullName: true } } },
  });

  if (timetable.length === 0) {
    const teachersHint =
      classCtx && classCtx.teachers.length > 0
        ? `\n\nYour teachers: ${classCtx.teachers.map((t) => t.fullName).join(', ')}.`
        : '';
    return { answer: `No timetable entries found for your class yet.${teachersHint}` };
  }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const grouped = timetable.reduce(
    (acc, entry) => {
      const day = dayNames[entry.dayOfWeek] ?? `Day ${entry.dayOfWeek}`;
      if (!acc[day]) acc[day] = [];
      acc[day].push(
        `${entry.startTime}–${entry.endTime}: ${entry.subject} (${entry.teacher.fullName})`,
      );
      return acc;
    },
    {} as Record<string, string[]>,
  );

  const formatted = Object.entries(grouped)
    .map(([day, entries]) => `**${day}**\n${entries.map((e) => `  • ${e}`).join('\n')}`)
    .join('\n\n');

  const classLabel = classCtx?.className ? ` (${classCtx.className})` : '';

  return {
    answer: `📅 **Your Timetable**${classLabel}\n\n${formatted}`,
    data: { classId: scope.classId, entryCount: timetable.length },
  };
};

const TEACHER_QUESTION_PATTERNS: RegExp[] = [
  /(?:who|which)\s+(?:are\s+)?(?:my|our)\s+teachers?/i,
  /(?:name|names)\s+of\s+(?:my|our)\s+teachers?/i,
  /(?:my|our)\s+teachers?/i,
  /who\s+teaches?\s+(?:me|us)/i,
  /who\s+is\s+(?:my|our)\s+(?:class\s+)?teacher/i,
  /teachers?\s+for\s+(?:my|our)\s+class/i,
  /list\s+(?:my|our)\s+teachers?/i,
];

// ─── Action Definitions ───────────────────────────────────────────────────────

export const studentActions: ActionDefinition[] = [
  {
    action: 'list_my_teachers',
    description: 'List your class teachers (class teacher + timetable teachers)',
    destructive: false,
    patterns: TEACHER_QUESTION_PATTERNS,
    extractParams: () => ({}),
    descriptionTemplate: () => 'List the teachers for your class (from your timetable and class teacher).',
    handler: listMyTeachersHandler,
  },
  {
    action: 'view_attendance',
    description: 'View your own attendance records and percentage',
    destructive: false,
    patterns: [
      /my\s+attendance/i,
      /show\s+(?:my\s+)?attendance/i,
      /view\s+(?:my\s+)?attendance/i,
      /attendance\s+(?:record|history|report)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () =>
      `View your attendance records and overall percentage.`,
    handler: viewAttendanceHandler,
  },
  {
    action: 'view_timetable',
    description: 'View your class timetable with subjects and teacher names',
    destructive: false,
    patterns: [
      /my\s+timetable/i,
      /show\s+(?:my\s+)?(?:timetable|schedule)/i,
      /view\s+(?:my\s+)?(?:timetable|schedule)/i,
      /class\s+(?:timetable|schedule)/i,
      /what(?:'s| is)\s+(?:my\s+)?(?:class\s+)?schedule/i,
      /when\s+do\s+(?:i|we)\s+have\s+class/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () =>
      `View your class timetable and schedule.`,
    handler: viewTimetableHandler,
  },
];
