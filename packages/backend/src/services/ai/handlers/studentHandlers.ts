import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

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

const viewTimetableHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');

  if (!scope.classId) {
    return { answer: 'Your account is not associated with a class.' };
  }

  const timetable = await prisma.timetableEntry.findMany({
    where: { classId: scope.classId },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });

  if (timetable.length === 0) {
    return { answer: 'No timetable entries found for your class.' };
  }

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const grouped = timetable.reduce(
    (acc, entry) => {
      const day = days[entry.dayOfWeek - 1] || `Day ${entry.dayOfWeek}`;
      if (!acc[day]) acc[day] = [];
      acc[day].push(`${entry.startTime}–${entry.endTime}: ${entry.subject}`);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  const formatted = Object.entries(grouped)
    .map(([day, entries]) => `**${day}**\n${entries.map((e) => `  • ${e}`).join('\n')}`)
    .join('\n\n');

  return {
    answer: `📅 **Your Timetable**\n\n${formatted}`,
    data: { classId: scope.classId, entryCount: timetable.length },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const studentActions: ActionDefinition[] = [
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
    description: 'View your class timetable',
    destructive: false,
    patterns: [
      /my\s+timetable/i,
      /show\s+(?:my\s+)?(?:timetable|schedule)/i,
      /view\s+(?:my\s+)?(?:timetable|schedule)/i,
      /class\s+(?:timetable|schedule)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () =>
      `View your class timetable and schedule.`,
    handler: viewTimetableHandler,
  },
];
