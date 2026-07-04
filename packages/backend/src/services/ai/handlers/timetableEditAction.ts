import { UserRole } from '@sams/shared';
import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const createTimetableEntryHandler: ActionHandler = async (params, scope) => {
  if (scope.role !== UserRole.HOD) {
    return { answer: 'Only HODs can manage timetable entries via chat.' };
  }
  if (!scope.departmentId) {
    return { answer: 'Your HOD account is not linked to a department.' };
  }

  const { prisma } = await import('../../../lib/prisma');
  const { timetableService } = await import('../../timetableService');

  const className = (params.className as string)?.trim();
  const teacherName = (params.teacherName as string)?.trim();
  const subject = (params.subject as string)?.trim();
  const day = (params.day as string)?.trim();
  const startTime = (params.startTime as string)?.trim();
  const endTime = (params.endTime as string)?.trim();

  if (!className) return { answer: 'Which class should this timetable entry be for?' };
  if (!subject) return { answer: 'What subject is this lesson?' };
  if (!day) return { answer: 'Which day of the week? (Monday=1, Tuesday=2, etc.)' };
  if (!startTime || !endTime) return { answer: 'What time does the lesson start and end? (e.g. 08:00-09:00)' };

  // Resolve class
  const cls = await prisma.class.findFirst({
    where: { schoolId: scope.schoolId, departmentId: scope.departmentId, name: { contains: className, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!cls) return { answer: `Class "${className}" not found in your department.` };

  // Resolve teacher
  let teacherId = params.teacherId as string | undefined;
  if (!teacherId && teacherName) {
    const teacher = await prisma.user.findFirst({
      where: {
        schoolId: scope.schoolId,
        departmentId: scope.departmentId,
        role: { in: ['TEACHER', 'HOD'] },
        fullName: { contains: teacherName, mode: 'insensitive' },
      },
      select: { id: true, fullName: true },
    });
    if (!teacher) return { answer: `Teacher "${teacherName}" not found in your department.` };
    teacherId = teacher.id;
  }
  if (!teacherId) return { answer: 'Which teacher is teaching this lesson?' };

  const dayNames: Record<string, number> = {
    monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3,
    thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0,
  };
  const dayNum = dayNames[day.toLowerCase()] ?? dayNames['monday'];
  const dayOfWeek = typeof params.dayOfWeek === 'number' ? params.dayOfWeek : dayNum;

  const entry = await timetableService.createEntry(scope.schoolId, {
    classId: cls.id,
    teacherId,
    subject,
    dayOfWeek,
    startTime,
    endTime,
  });

  return {
    answer: `✅ Added **${subject}** for **${cls.name}** on day ${dayOfWeek} at ${startTime}-${endTime}.`,
    data: { entryId: entry.id, classId: cls.id, subject, dayOfWeek },
  };
};

const removeTimetableEntryHandler: ActionHandler = async (params, scope) => {
  if (scope.role !== UserRole.HOD) {
    return { answer: 'Only HODs can manage timetable entries via chat.' };
  }
  if (!scope.departmentId) {
    return { answer: 'Your HOD account is not linked to a department.' };
  }

  const { prisma } = await import('../../../lib/prisma');
  const { timetableService } = await import('../../timetableService');

  const className = (params.className as string)?.trim();
  const subject = (params.subject as string)?.trim();
  const day = (params.day as string)?.trim();

  if (!className) return { answer: 'Which class?' };
  if (!subject) return { answer: 'Which subject lesson should I remove?' };

  const cls = await prisma.class.findFirst({
    where: { schoolId: scope.schoolId, departmentId: scope.departmentId, name: { contains: className, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!cls) return { answer: `Class "${className}" not found in your department.` };

  const dayNames: Record<string, number> = {
    monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3,
    thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0,
  };
  const dayOfWeek = day ? (dayNames[day.toLowerCase()] ?? undefined) : undefined;

  const where: Record<string, unknown> = {
    schoolId: scope.schoolId,
    classId: cls.id,
    subject: { contains: subject, mode: 'insensitive' },
  };
  if (dayOfWeek !== undefined) where.dayOfWeek = dayOfWeek;

  const entries = await prisma.timetableEntry.findMany({ where, select: { id: true, subject: true, startTime: true, endTime: true } });

  if (entries.length === 0) {
    return { answer: `No "${subject}" entry found for ${cls.name}.` };
  }

  if (entries.length > 1) {
    const lines = entries.map((e, i) => `${i + 1}. ${e.subject} at ${e.startTime}-${e.endTime}`);
    return {
      answer: `Multiple entries found. Which one?\n${lines.join('\n')}\n\nReply with the entry number or the start time (e.g. "08:00").`,
      data: { entries },
    };
  }

  await timetableService.deleteEntry(scope.schoolId, entries[0].id);
  return {
    answer: `✅ Removed **${entries[0].subject}** (${entries[0].startTime}-${entries[0].endTime}) from **${cls.name}**.`,
    data: { removedEntryId: entries[0].id },
  };
};

const viewTimetableForClassHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const { timetableService } = await import('../../timetableService');

  const className = (params.className as string)?.trim();

  if (!className && scope.role === UserRole.HOD && scope.departmentId) {
    const classes = await prisma.class.findMany({
      where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (classes.length === 0) return { answer: 'No classes in your department.' };
    if (classes.length === 1) {
      const entries = await timetableService.listEntries(scope.schoolId, { classId: classes[0].id });
      return formatTimetableResponse(entries, classes[0].name, scope);
    }
    return {
      answer: `Which class timetable? ${classes.map((c) => `**${c.name}**`).join(', ')}`,
      data: { classes },
    };
  }

  if (!className) return { answer: 'Which class timetable should I show?' };

  const cls = await prisma.class.findFirst({
    where: { schoolId: scope.schoolId, ...(scope.role === UserRole.HOD ? { departmentId: scope.departmentId } : {}), name: { contains: className, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!cls) return { answer: `Class "${className}" not found.` };

  const entries = await timetableService.listEntries(scope.schoolId, { classId: cls.id });
  return formatTimetableResponse(entries, cls.name, scope);
};

async function formatTimetableResponse(
  entries: Array<{ id: string; dayOfWeek: number; startTime: string; endTime: string; subject: string; teacher?: { fullName: string }; room?: string | null }>,
  className: string,
  _scope: { role: string },
) {
  if (entries.length === 0) {
    return { answer: `No timetable entries for **${className}** yet.` };
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const grouped = entries.reduce(
    (acc, entry) => {
      const day = dayNames[entry.dayOfWeek] ?? `Day ${entry.dayOfWeek}`;
      if (!acc[day]) acc[day] = [];
      const teacherName = (entry as any).teacher?.fullName ?? '';
      const room = entry.room ? ` (${entry.room})` : '';
      acc[day].push(`  • ${entry.startTime}-${entry.endTime}: **${entry.subject}**${teacherName ? ` — ${teacherName}` : ''}${room}`);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  const formatted = Object.entries(grouped)
    .map(([day, lines]) => `**${day}**\n${lines.join('\n')}`)
    .join('\n\n');

  return {
    answer: `📅 **Timetable — ${className}**\n\n${formatted}`,
    data: { className, entryCount: entries.length },
  };
}

// ─── Action Definitions ───────────────────────────────────────────────────────

export const timetableEditActions: ActionDefinition[] = [
  {
    action: 'create_timetable_entry',
    description: 'Add a single timetable entry (lesson slot) for a class in your department (HOD only)',
    destructive: true,
    patterns: [
      /add\s+(?:timetable|schedule)\s+(?:entry|slot|lesson)\s+(?:for\s+)?(.+)/i,
      /create\s+(?:a\s+)?(?:timetable|schedule)\s+(?:entry|slot)\s+(?:for\s+)?(.+)/i,
      /schedule\s+(?:a\s+)?(?:lesson|class)\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const remainder = match?.[1]?.trim() || '';
      const classMatch = remainder.match(/(?:class|for)\s+["']?([^"',]+?)["']?(?:\s+|$)/i);
      const subjectMatch = message.match(/subject\s+["']?([^"',]+?)["']?/i) ||
        message.match(/(?:for|of)\s+(?:subject\s+)?["']?([^"',]+?)["']?(?:\s+at|\s+on|$)/i);
      const timeMatch = message.match(/(\d{1,2}:\d{2})\s*(?:-|to)\s*(\d{1,2}:\d{2})/i);
      const dayMatch = message.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i);
      const teacherMatch = message.match(/teacher\s+["']?([^"',]+?)["']?/i) ||
        remainder.match(/with\s+["']?([^"',]+?)["']?(?:\s+|$)/i);
      return {
        className: classMatch?.[1]?.trim(),
        subject: subjectMatch?.[1]?.trim(),
        startTime: timeMatch?.[1],
        endTime: timeMatch?.[2],
        day: dayMatch?.[1],
        teacherName: teacherMatch?.[1]?.trim(),
      };
    },
    descriptionTemplate: (params) =>
      `Add timetable entry${params.subject ? ` for "${params.subject}"` : ''}${params.className ? ` in ${params.className}` : ''}.`,
    handler: createTimetableEntryHandler,
  },
  {
    action: 'remove_timetable_entry',
    description: 'Remove a single timetable entry for a class in your department (HOD only)',
    destructive: true,
    patterns: [
      /remove\s+(?:timetable|schedule)\s+(?:entry|slot|lesson)\s+(.+)/i,
      /delete\s+(?:timetable|schedule)\s+(?:entry|slot|lesson)\s+(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const remainder = match?.[1]?.trim() || '';
      const classMatch = remainder.match(/(?:class|for)\s+["']?([^"',]+?)["']?(?:\s+|$)/i);
      const subjectMatch = message.match(/(?:subject\s+)?["']?([^"',]+?)["']?(?:\s+class|\s+on|\s+at|$)/i);
      const dayMatch = message.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i);
      return {
        className: classMatch?.[1]?.trim() || remainder,
        subject: subjectMatch?.[1]?.trim(),
        day: dayMatch?.[1],
      };
    },
    descriptionTemplate: (params) =>
      `Remove timetable entry${params.subject ? ` for "${params.subject}"` : ''}${params.className ? ` in ${params.className}` : ''}.`,
    handler: removeTimetableEntryHandler,
  },
  {
    action: 'view_timetable_by_class',
    description: 'View the full weekly timetable for a specific class (HOD)',
    destructive: false,
    patterns: [
      /(?:show|view|list)\s+(?:timetable|schedule)\s+(?:for|of)\s+(?:class\s+)?["']?([^"',]+?)["']?/i,
      /what\s+(?:is\s+)?(?:the\s+)?(?:timetable|schedule)\s+(?:for|of)\s+(?:class\s+)?["']?([^"',]+?)["']?/i,
      /class\s+["']?([^"',]+?)["']?\s+(?:timetable|schedule)/i,
    ],
    extractParams: (message: string) => {
      const match = message.match(/(?:for|of|class)\s+["']?([^"',]+?)["']?(?:\s+(?:timetable|schedule)|$)/i) ||
        message.match(/class\s+["']?([^"',]+?)["']?\s+(?:timetable|schedule)/i);
      return { className: match?.[1]?.trim() };
    },
    descriptionTemplate: (params) =>
      `View timetable for class "${params.className}".`,
    handler: viewTimetableForClassHandler,
  },
];
