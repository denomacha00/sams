import type { ActionDefinition, ActionHandler, ActionScope } from '../roleActionRegistry';
import { listSchoolAdminHandler } from '../../../lib/schoolAdminLookup';
import { SCHOOL_ADMIN_QUERY_PATTERNS } from '../studentContextQuery';
import { createRegistrationLinkActionDef } from './registrationLinkAction';

async function listTeacherClasses(scope: ActionScope): Promise<Array<{ id: string; name: string }>> {
  const { prisma } = await import('../../../lib/prisma');
  const { resolveTeacherTeachingClassIds } = await import('../../../lib/teacherScope');
  const classIds = await resolveTeacherTeachingClassIds(scope.userId, scope.classId);

  if (classIds.length === 0) return [];

  return prisma.class.findMany({
    where: { schoolId: scope.schoolId, id: { in: classIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

function pickTeacherClass(
  classes: Array<{ id: string; name: string }>,
  params: Record<string, unknown>,
): { id: string; name: string } | null {
  const classId = typeof params.classId === 'string' ? params.classId : undefined;
  if (classId) {
    const byId = classes.find((cls) => cls.id === classId);
    if (byId) return byId;
  }

  const className = typeof params.className === 'string' ? params.className.trim().toLowerCase() : '';
  if (className) {
    const byName = classes.find((cls) => cls.name.toLowerCase().includes(className));
    if (byName) return byName;
  }

  return classes.length === 1 ? classes[0] : null;
}

function formatClassChoices(classes: Array<{ name: string }>): string {
  return classes.map((cls) => `**${cls.name}**`).join(', ');
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function schemaDayOfWeek(date: Date): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
}

function isCurrentTimetableSlot(
  entry: { startTime: string; endTime: string },
  currentMinutes: number,
): boolean {
  const toleranceMinutes = 30;
  return (
    currentMinutes >= timeToMinutes(entry.startTime) - toleranceMinutes &&
    currentMinutes <= timeToMinutes(entry.endTime) + toleranceMinutes
  );
}

const startSessionHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const { sessionService } = await import('../../sessionService');

  const subject = params.subject as string | undefined;
  const classes = await listTeacherClasses(scope);
  const selectedClass = pickTeacherClass(classes, params);

  if (classes.length === 0) {
    return { answer: 'No taught classes are linked to your timetable yet.' };
  }
  if (!selectedClass) {
    return {
      answer: `Which class should this attendance session be for? Reply with one of: ${formatClassChoices(classes)}`,
    };
  }

  const now = new Date();
  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  const timetableEntries = await prisma.timetableEntry.findMany({
    where: {
      schoolId: scope.schoolId,
      teacherId: scope.userId,
      classId: selectedClass.id,
      dayOfWeek: schemaDayOfWeek(now),
    },
    select: { id: true, subject: true, startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });

  const currentEntry = timetableEntries.find((entry) =>
    isCurrentTimetableSlot(entry, currentMinutes),
  );

  if (!currentEntry) {
    return {
      answer:
        `I found ${selectedClass.name}, but there is no current timetable slot for this class. Start sessions only during the scheduled period, or ask your HOD to update the timetable.`,
    };
  }

  const session = await sessionService.startSession(
    scope.userId,
    scope.schoolId,
    currentEntry.id,
    undefined,
    { requireGps: false },
  );

  return {
    answer: `✅ Attendance session started for "${subject || currentEntry.subject}".`,
    data: { sessionId: session.id, classId: selectedClass.id },
  };
};

const endSessionHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const { sessionService } = await import('../../sessionService');

  const activeSession = await prisma.attendanceSession.findFirst({
    where: { teacherId: scope.userId, isActive: true },
  });

  if (!activeSession) return { answer: 'No active session found.' };

  await sessionService.endSession(activeSession.id, scope.userId);

  return {
    answer: `✅ Session "${activeSession.subject}" ended.`,
    data: { sessionId: activeSession.id },
  };
};

const markAttendanceHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const studentName = params.studentName as string;
  const status = (params.status as string) || 'PRESENT';

  if (!studentName) return { answer: 'Please provide the student name.' };

  const activeSession = await prisma.attendanceSession.findFirst({
    where: { teacherId: scope.userId, isActive: true },
  });

  if (!activeSession) return { answer: 'No active session. Start a session first.' };

  const student = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'STUDENT',
      classId: activeSession.classId,
      fullName: { contains: studentName, mode: 'insensitive' },
    },
  });

  if (!student) return { answer: `Student "${studentName}" not found.` };

  await prisma.attendanceRecord.upsert({
    where: { sessionId_studentId: { sessionId: activeSession.id, studentId: student.id } },
    create: {
      schoolId: scope.schoolId,
      sessionId: activeSession.id,
      studentId: student.id,
      status: status.toUpperCase() as any,
      method: 'MANUAL',
      scannedAt: new Date(),
    },
    update: { status: status.toUpperCase() as any },
  });

  return {
    answer: `✅ ${student.fullName} marked as ${status.toUpperCase()}.`,
    data: { studentId: student.id, status: status.toUpperCase() },
  };
};

const viewClassRosterHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');
  const { resolveTeacherClassId } = await import('../../../lib/teacherScope');

  const classId = await resolveTeacherClassId(scope.userId, scope.classId);
  if (!classId) {
    return { answer: 'Your account is not associated with a class.' };
  }

  const [classRecord, students] = await Promise.all([
    prisma.class.findUnique({ where: { id: classId }, select: { name: true } }),
    prisma.user.findMany({
      where: { schoolId: scope.schoolId, classId, role: 'STUDENT' },
      select: { fullName: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  if (students.length === 0) {
    return {
      answer: `No students are enrolled in ${classRecord?.name ?? 'your class'} yet.`,
      data: { classId, count: 0 },
    };
  }

  const list = students.map((s, i) => `${i + 1}. ${s.fullName}`).join('\n');
  return {
    answer: `📋 **Class roster — ${classRecord?.name ?? 'Your class'}** (${students.length} students)\n\n${list}`,
    data: { classId, count: students.length },
  };
};

const viewTaughtClassRosterHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');
  const classes = await listTeacherClasses(scope);

  if (classes.length === 0) {
    return { answer: 'No taught classes are linked to your timetable yet.' };
  }

  const classIds = classes.map((cls) => cls.id);
  const students = await prisma.user.findMany({
    where: { schoolId: scope.schoolId, classId: { in: classIds }, role: 'STUDENT' },
    select: { fullName: true, classId: true },
    orderBy: [{ classId: 'asc' }, { fullName: 'asc' }],
  });

  if (students.length === 0) {
    return {
      answer: 'No students are enrolled in your taught classes yet.',
      data: { classIds, count: 0 },
    };
  }

  const sections = classes
    .map((cls) => {
      const rows = students.filter((student) => student.classId === cls.id);
      if (rows.length === 0) return null;
      return `**${cls.name}**\n${rows.map((student, i) => `${i + 1}. ${student.fullName}`).join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return {
    answer: `Class roster (${students.length} students)\n\n${sections}`,
    data: { classIds, count: students.length },
  };
};

const sendClassMessageHandler: ActionHandler = async (params, scope) => {
  const {
    assertAiNotificationChannels,
    ScopedNotificationError,
    sendScopedNotification,
  } = await import('../../scopedNotificationSend');

  const message = (params.message as string)?.trim();
  if (!message) {
    return {
      answer:
        'Please provide the message to send to your class (e.g. "message my class: Homework due Friday").',
    };
  }

  const classes = await listTeacherClasses(scope);
  const selectedClass = pickTeacherClass(classes, params);
  if (classes.length === 0) {
    return { answer: 'No taught classes are linked to your timetable yet.' };
  }
  if (!selectedClass) {
    return {
      answer: `Which class should receive this message? Reply with one of: ${formatClassChoices(classes)}`,
    };
  }

  try {
    assertAiNotificationChannels(['inapp']);
    const result = await sendScopedNotification(
      {
        sub: scope.userId,
        role: scope.role,
        schoolId: scope.schoolId,
        classId: scope.classId,
      },
      {
        scope: 'class',
        targetId: selectedClass.id,
        targetRole: 'STUDENT',
        title: (params.title as string)?.trim() || 'Class message',
        message,
        channels: ['inapp'],
      },
    );

    if (!result.success) {
      return { answer: result.warning ?? 'No students in your class to message.' };
    }

    return {
      answer: `✅ In-app message sent to ${result.recipientCount} student(s) in your class. (SMS is not available via AI — use the Notifications page if your school admin enables SMS.)`,
      data: { batchId: result.batchId, recipientCount: result.recipientCount, classId: selectedClass.id },
    };
  } catch (err) {
    if (err instanceof ScopedNotificationError) {
      return { answer: `❌ ${err.message}` };
    }
    throw err;
  }
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const teacherActions: ActionDefinition[] = [
  createRegistrationLinkActionDef,
  {
    action: 'start_session',
    description: 'Start an attendance session for your class',
    destructive: false,
    patterns: [
      /start\s+(?:a\s+)?(?:session|class|attendance)/i,
      /begin\s+(?:a\s+)?(?:session|class|attendance)/i,
      /open\s+(?:a\s+)?(?:session|attendance)/i,
    ],
    extractParams: (message: string) => {
      // Try to extract subject from "start session for Math" or "start Math session"
      const forMatch = message.match(/(?:session|class|attendance)\s+(?:for\s+)?(.+)/i);
      const subject = forMatch && forMatch[1] ? forMatch[1].trim() : undefined;
      return { subject };
    },
    descriptionTemplate: (params) =>
      `Start an attendance session${params.subject ? ` for "${params.subject}"` : ''}.`,
    handler: startSessionHandler,
  },
  {
    action: 'end_session',
    description: 'End the currently active attendance session',
    destructive: true,
    patterns: [
      /end\s+(?:the\s+)?(?:session|class|attendance)/i,
      /stop\s+(?:the\s+)?(?:session|class|attendance)/i,
      /close\s+(?:the\s+)?(?:session|attendance)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () =>
      `End the active attendance session. This will finalize attendance records.`,
    handler: endSessionHandler,
  },
  {
    action: 'mark_attendance',
    description: 'Mark a student as present, absent, or late',
    destructive: false,
    patterns: [
      /mark\s+(.+?)\s+(?:as\s+)?(?:present|absent|late)/i,
      /record\s+(.+?)\s+(?:as\s+)?(?:present|absent|late)/i,
      /(.+?)\s+is\s+(?:present|absent|late)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const studentName = match && match[1] ? match[1].trim() : '';
      // Extract status
      const statusMatch = message.match(/(?:as\s+)?(present|absent|late)/i);
      const status = statusMatch ? statusMatch[1].toUpperCase() : 'PRESENT';
      return { studentName, status };
    },
    descriptionTemplate: (params) =>
      `Mark "${params.studentName}" as ${params.status}.`,
    handler: markAttendanceHandler,
  },
  {
    action: 'view_class_roster',
    description: 'List students in your assigned class',
    destructive: false,
    patterns: [
      /(?:show|view|list|get)\s+(?:my\s+)?class\s+(?:roster|list|students?)/i,
      /(?:who\s+are|list)\s+(?:the\s+)?students?\s+in\s+(?:my\s+)?class/i,
      /class\s+roster/i,
      /my\s+students?\s*$/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List students in your assigned class.',
    handler: viewTaughtClassRosterHandler,
  },
  {
    action: 'send_class_message',
    description: 'Send an in-app message to all students in your class (not SMS)',
    destructive: true,
    patterns: [
      /^notify\s+(?:my\s+)?class\s*$/i,
      /^(?:post|send)\s+(?:a\s+)?(?:notification|message)\s*$/i,
      /^notify\s+(?:my\s+)?students?\s*$/i,
      /(?:send|message)\s+(?:to\s+)?(?:my\s+)?class\s*[:,-]?\s*(.+)/i,
      /notify\s+(?:my\s+)?class\s*[:,-]?\s*(.+)/i,
      /notify\s+(?:the\s+)?students?\s+in\s+(?:my\s+)?class\s*[:,-]?\s*(.+)/i,
      /tell\s+(?:my\s+)?class\s*[:,-]?\s*(.+)/i,
      /message\s+(?:all\s+)?(?:my\s+)?students?\s*[:,-]?\s*(.+)/i,
      /send\s+(?:a\s+)?message\s+to\s+(?:my\s+)?class\s*[:,-]?\s*(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const message = match && match[1] ? match[1].trim() : '';
      return { message };
    },
    descriptionTemplate: (params) =>
      `Send in-app message to your class: "${String(params.message).slice(0, 80)}${String(params.message).length > 80 ? '…' : ''}"`,
    handler: sendClassMessageHandler,
  },
  {
    action: 'list_school_admin',
    description: 'Name the school administrator(s) for your school',
    destructive: false,
    patterns: SCHOOL_ADMIN_QUERY_PATTERNS,
    extractParams: () => ({}),
    descriptionTemplate: () => 'Tell the user who the school administrator is for their school.',
    handler: listSchoolAdminHandler,
  },
];
