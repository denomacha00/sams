import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import {
  formatStudentTeachersAnswer,
  getStudentClassContext,
} from '../../../lib/studentClassTeachers';
import {
  fetchTodayTimetableForClass,
  formatTimetableSlotLines,
  jsDateToSchemaDayOfWeek,
  schemaDayName,
} from '../../../lib/studentScheduleHelpers';

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

const viewTodayScheduleHandler: ActionHandler = async (_params, scope) => {
  if (!scope.classId) {
    return { answer: 'Your account is not associated with a class, so I cannot show today\'s schedule.' };
  }

  const classCtx = await getStudentClassContext(scope.classId);
  const { dayName, entries } = await fetchTodayTimetableForClass(scope.classId);
  const classLabel = classCtx?.className ? ` (${classCtx.className})` : '';

  if (entries.length === 0) {
    return {
      answer:
        `📅 **Today (${dayName})**${classLabel}\n\nNo classes are scheduled for your class today. Say **"show my timetable"** to see the full week.`,
      data: { dayOfWeek: jsDateToSchemaDayOfWeek(), entryCount: 0 },
    };
  }

  return {
    answer:
      `📅 **Today (${dayName})**${classLabel}\n\n${formatTimetableSlotLines(entries)}`,
    data: { dayOfWeek: jsDateToSchemaDayOfWeek(), entryCount: entries.length, entries },
  };
};

const REMINDERS_EXPLANATION = `I can't set a phone-style alarm for a specific class time — **SAMS doesn't send timed personal reminders yet**.

**What SAMS does offer:**
• **In-app messages** — When your teacher, HOD, or school admin sends an announcement, it appears on your **Notifications** page (and live in the app when you're online).
• **Class rep** — If you're a class rep, you can **reply** to messages from your teacher (not send new class-wide announcements yourself).

**For a reminder at class time:**
• Add the lesson to your **phone calendar** using the times from your timetable.
• Ask your **teacher or class rep** to send a class announcement if everyone needs the same reminder.

Say **"show my timetable"** or **"classes today"** anytime for your schedule.`;

const explainRemindersHandler: ActionHandler = async (_params, scope) => {
  let answer = REMINDERS_EXPLANATION;

  if (scope.classId) {
    const { dayName, entries } = await fetchTodayTimetableForClass(scope.classId);
    if (entries.length > 0) {
      answer += `\n\n**Quick look — ${dayName}:**\n${formatTimetableSlotLines(entries)}`;
    }
  }

  return { answer, data: { remindersSupported: false } };
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

const REMINDER_REQUEST_PATTERNS: RegExp[] = [
  /remind\s+me/i,
  /will\s+you\s+remind/i,
  /can\s+you\s+remind/i,
  /could\s+you\s+remind/i,
  /please\s+remind/i,
  /set\s+(?:a\s+)?reminder/i,
  /(?:give|send)\s+me\s+(?:a\s+)?reminder/i,
  /alert\s+me\s+(?:at|when|before)/i,
  /notify\s+me\s+(?:at|when|before)/i,
  /push\s+notification\s+(?:at|when)/i,
];

const TODAY_SCHEDULE_PATTERNS: RegExp[] = [
  /classes?\s+today/i,
  /today(?:'s)?\s+(?:classes|schedule|timetable|lessons)/i,
  /what\s+(?:classes?|lessons?)\s+(?:do\s+)?(?:i|we)\s+have\s+today/i,
  /what\s+(?:do\s+)?(?:i|we)\s+have\s+today/i,
  /my\s+schedule\s+today/i,
  /schedule\s+for\s+today/i,
];

// ─── Action Definitions ───────────────────────────────────────────────────────

export const studentActions: ActionDefinition[] = [
  {
    action: 'explain_reminders',
    description:
      'Explain SAMS notification options when the student asks for timed reminders or alarms',
    destructive: false,
    patterns: REMINDER_REQUEST_PATTERNS,
    extractParams: () => ({}),
    descriptionTemplate: () =>
      'Explain what SAMS can and cannot do for class-time reminders, with practical alternatives.',
    handler: explainRemindersHandler,
  },
  {
    action: 'view_today_schedule',
    description: "View today's class schedule from the timetable",
    destructive: false,
    patterns: TODAY_SCHEDULE_PATTERNS,
    extractParams: () => ({}),
    descriptionTemplate: () => `View your class schedule for ${schemaDayName(jsDateToSchemaDayOfWeek())}.`,
    handler: viewTodayScheduleHandler,
  },
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
