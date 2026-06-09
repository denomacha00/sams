import { UserRole } from '@sams/shared';
import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { HOD_DEPARTMENT_UNLINKED_MESSAGE } from '../../../lib/hodScope';
import { listSchoolAdminHandler } from '../../../lib/schoolAdminLookup';
import { fetchDepartmentStats, formatDepartmentStatsAnswer } from '../departmentStatsQuery';
import { extractMessageBody, parseNotificationTargetRole } from '../notificationActionParams';
import { SCHOOL_ADMIN_QUERY_PATTERNS } from '../studentContextQuery';
import { createRegistrationLinkActionDef } from './registrationLinkAction';

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

function pickDepartmentClass(
  classes: Array<{ id: string; name: string }>,
  params: Record<string, unknown>,
): { id: string; name: string } | null {
  const classId = typeof params.classId === 'string' ? params.classId : undefined;
  if (classId) {
    const byId = classes.find((cls) => cls.id === classId);
    if (byId) return byId;
  }

  const className = typeof params.className === 'string'
    ? params.className.trim().toLowerCase()
    : '';
  if (className) {
    const byName = classes.find((cls) => cls.name.toLowerCase().includes(className));
    if (byName) return byName;
  }

  return classes.length === 1 ? classes[0] : null;
}

function formatClassChoices(classes: Array<{ name: string }>): string {
  return classes.map((cls) => `**${cls.name}**`).join(', ');
}

async function listDepartmentClasses(scope: { schoolId: string; departmentId?: string }) {
  if (!scope.departmentId) return [];
  const { prisma } = await import('../../../lib/prisma');
  return prisma.class.findMany({
    where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

const startHodSessionHandler: ActionHandler = async (params, scope) => {
  if (!scope.departmentId) {
    return { answer: HOD_DEPARTMENT_UNLINKED_MESSAGE };
  }

  const { prisma } = await import('../../../lib/prisma');
  const { sessionService } = await import('../../sessionService');

  const classes = await listDepartmentClasses(scope);
  const selectedClass = pickDepartmentClass(classes, params);
  if (classes.length === 0) {
    return { answer: 'No classes are linked to your department yet.' };
  }
  if (!selectedClass) {
    return {
      answer: `Which department class should this attendance session be for? Reply with one of: ${formatClassChoices(classes)}`,
    };
  }

  const now = new Date();
  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  const timetableEntries = await prisma.timetableEntry.findMany({
    where: {
      schoolId: scope.schoolId,
      classId: selectedClass.id,
      dayOfWeek: schemaDayOfWeek(now),
      class: { departmentId: scope.departmentId },
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
        `I found ${selectedClass.name}, but there is no current timetable slot for this class. Attendance sessions can only open during the scheduled period.`,
    };
  }

  const session = await sessionService.startSession(
    scope.userId,
    scope.schoolId,
    currentEntry.id,
    undefined,
    {
      actorRole: UserRole.HOD,
      actorDepartmentId: scope.departmentId,
      requireGps: false,
    },
  );

  return {
    answer: `Attendance session started for ${selectedClass.name} - ${currentEntry.subject}.`,
    data: { sessionId: session.id, classId: selectedClass.id },
  };
};

async function findHodActiveSessions(
  scope: { schoolId: string; departmentId?: string },
  params: Record<string, unknown>,
) {
  if (!scope.departmentId) return [];
  const { prisma } = await import('../../../lib/prisma');
  const classes = await listDepartmentClasses(scope);
  const selectedClass = pickDepartmentClass(classes, params);

  return prisma.attendanceSession.findMany({
    where: {
      schoolId: scope.schoolId,
      isActive: true,
      ...(selectedClass ? { classId: selectedClass.id } : {}),
      class: { departmentId: scope.departmentId },
    },
    include: { class: { select: { name: true, departmentId: true } } },
    orderBy: { startedAt: 'desc' },
    take: 5,
  });
}

const endHodSessionHandler: ActionHandler = async (params, scope) => {
  if (!scope.departmentId) {
    return { answer: HOD_DEPARTMENT_UNLINKED_MESSAGE };
  }

  const { sessionService } = await import('../../sessionService');
  const activeSessions = await findHodActiveSessions(scope, params);

  if (activeSessions.length === 0) {
    return { answer: 'No active attendance session found in your department.' };
  }

  if (activeSessions.length > 1 && !params.classId && !params.className) {
    const choices = activeSessions
      .map((session) => `**${session.class?.name ?? session.subject}**`)
      .join(', ');
    return { answer: `Which active department session should I end? Reply with one of: ${choices}` };
  }

  const session = activeSessions[0];
  await sessionService.endSession(session.id, scope.userId, {
    actorRole: UserRole.HOD,
    actorDepartmentId: scope.departmentId,
  });

  return {
    answer: `Session "${session.subject}" ended.`,
    data: { sessionId: session.id },
  };
};

const markHodAttendanceHandler: ActionHandler = async (params, scope) => {
  if (!scope.departmentId) {
    return { answer: HOD_DEPARTMENT_UNLINKED_MESSAGE };
  }

  const studentName = (params.studentName as string)?.trim();
  const status = ((params.status as string) || 'PRESENT').toUpperCase();
  if (!studentName) {
    return { answer: 'Please provide the student name to mark.' };
  }

  const { prisma } = await import('../../../lib/prisma');
  const activeSessions = await findHodActiveSessions(scope, params);

  if (activeSessions.length === 0) {
    return { answer: 'No active attendance session found in your department. Start a session first.' };
  }

  if (activeSessions.length > 1 && !params.classId && !params.className) {
    const choices = activeSessions
      .map((session) => `**${session.class?.name ?? session.subject}**`)
      .join(', ');
    return { answer: `Which active class session should I use? Reply with one of: ${choices}` };
  }

  const activeSession = activeSessions[0];
  const student = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'STUDENT',
      departmentId: scope.departmentId,
      classId: activeSession.classId,
      fullName: { contains: studentName, mode: 'insensitive' },
    },
  });

  if (!student) {
    return { answer: `Student "${studentName}" was not found in that department class.` };
  }

  await prisma.attendanceRecord.upsert({
    where: { sessionId_studentId: { sessionId: activeSession.id, studentId: student.id } },
    create: {
      schoolId: scope.schoolId,
      sessionId: activeSession.id,
      studentId: student.id,
      status: status as any,
      method: 'MANUAL',
      scannedAt: new Date(),
    },
    update: { status: status as any },
  });

  return {
    answer: `${student.fullName} marked as ${status}.`,
    data: { sessionId: activeSession.id, studentId: student.id, status },
  };
};

const addTeacherHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const teacherName = params.teacherName as string;
  if (!teacherName) return { answer: 'Please provide the teacher name.' };

  if (!scope.departmentId) {
    return { answer: HOD_DEPARTMENT_UNLINKED_MESSAGE };
  }

  const teacher = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'TEACHER',
      fullName: { contains: teacherName, mode: 'insensitive' },
    },
  });

  if (!teacher) return { answer: `Teacher "${teacherName}" not found in your school.` };

  await prisma.user.update({
    where: { id: teacher.id },
    data: { departmentId: scope.departmentId },
  });

  return {
    answer: `✅ Teacher "${teacher.fullName}" assigned to your department.`,
    data: { teacherId: teacher.id, departmentId: scope.departmentId },
  };
};

const createDepartmentClassHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const className = (params.className as string | undefined)?.trim();
  const capacityParam = Number(params.capacity);
  const capacity = Number.isFinite(capacityParam) && capacityParam > 0
    ? Math.floor(capacityParam)
    : 50;

  if (!scope.departmentId) {
    return { answer: HOD_DEPARTMENT_UNLINKED_MESSAGE };
  }

  if (!className) {
    return { answer: 'What class name should I create in your department?' };
  }

  try {
    const cls = await prisma.class.create({
      data: {
        schoolId: scope.schoolId,
        departmentId: scope.departmentId,
        name: className,
        capacity,
      },
    });

    return {
      answer: `Class "${cls.name}" created in your department.`,
      data: { classId: cls.id, departmentId: scope.departmentId, capacity: cls.capacity },
    };
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      return { answer: `Class "${className}" already exists in this school.` };
    }
    throw err;
  }
};

const sendClassNotificationHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const {
    assertAiNotificationChannels,
    ScopedNotificationError,
    sendScopedNotification,
  } = await import('../../scopedNotificationSend');

  const message = (params.message as string)?.trim();
  if (!message) {
    return { answer: 'What is the message text for this class notification?' };
  }

  if (!scope.departmentId) {
    return { answer: HOD_DEPARTMENT_UNLINKED_MESSAGE };
  }

  let classId = params.classId as string | undefined;
  const className = (params.className as string)?.trim();
  if (!classId && className) {
    const cls = await prisma.class.findFirst({
      where: {
        schoolId: scope.schoolId,
        departmentId: scope.departmentId,
        name: { contains: className, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
    if (!cls) return { answer: `Class "${className}" not found in your department.` };
    classId = cls.id;
  }

  if (!classId) {
    return { answer: 'Which class should receive this? (Name one of your department classes.)' };
  }

  const targetRole = (params.targetRole as 'TEACHER' | 'STUDENT' | undefined) ?? 'STUDENT';

  try {
    assertAiNotificationChannels(['inapp']);
    const result = await sendScopedNotification(
      {
        sub: scope.userId,
        role: scope.role,
        schoolId: scope.schoolId,
        departmentId: scope.departmentId,
      },
      {
        scope: 'class',
        targetId: classId,
        targetRole,
        title: (params.title as string)?.trim() || 'Class message',
        message,
        channels: ['inapp'],
      },
    );

    if (!result.success) {
      return { answer: result.warning ?? 'No users matched in that class.' };
    }

    return {
      answer: `✅ In-app message sent to ${result.recipientCount} user(s) in the class.`,
      data: { batchId: result.batchId, recipientCount: result.recipientCount, classId },
    };
  } catch (err) {
    if (err instanceof ScopedNotificationError) {
      return { answer: `❌ ${err.message}` };
    }
    throw err;
  }
};

const sendDepartmentNotificationHandler: ActionHandler = async (params, scope) => {
  const {
    assertAiNotificationChannels,
    ScopedNotificationError,
    sendScopedNotification,
  } = await import('../../scopedNotificationSend');

  const message = (params.message as string)?.trim();
  if (!message) {
    return {
      answer:
        'Please include the message (e.g. "notify department students: Staff meeting at 3pm").',
    };
  }

  if (!scope.departmentId) {
    return { answer: HOD_DEPARTMENT_UNLINKED_MESSAGE };
  }

  const targetRole = (params.targetRole as 'TEACHER' | 'STUDENT' | undefined) ?? undefined;

  try {
    assertAiNotificationChannels(['inapp']);
    const result = await sendScopedNotification(
      {
        sub: scope.userId,
        role: scope.role,
        schoolId: scope.schoolId,
        departmentId: scope.departmentId,
      },
      {
        scope: 'department',
        targetId: scope.departmentId,
        targetRole,
        title: (params.title as string)?.trim() || 'Department message',
        message,
        channels: ['inapp'],
      },
    );

    if (!result.success) {
      return { answer: result.warning ?? 'No users matched in your department.' };
    }

    const audience = targetRole ? ` (${targetRole.toLowerCase()}s)` : '';
    return {
      answer: `✅ In-app message sent to ${result.recipientCount} user(s) in your department${audience}.`,
      data: { batchId: result.batchId, recipientCount: result.recipientCount },
    };
  } catch (err) {
    if (err instanceof ScopedNotificationError) {
      return { answer: `❌ ${err.message}` };
    }
    throw err;
  }
};

const viewDepartmentStatsHandler: ActionHandler = async (_params, scope) => {
  if (!scope.departmentId) {
    return { answer: HOD_DEPARTMENT_UNLINKED_MESSAGE };
  }

  const stats = await fetchDepartmentStats(scope.schoolId, scope.departmentId);

  return {
    answer: formatDepartmentStatsAnswer(stats),
    data: stats,
  };
};

/** Regex patterns for HOD department statistics (natural language). */
export const DEPARTMENT_STATS_PATTERNS: RegExp[] = [
  /department\s+stats/i,
  /my\s+department/i,
  /show\s+department\s+(?:stats|statistics|info)/i,
  /view\s+department/i,
  /how\s+many\s+(?:teachers?\s*(?:and|&|,)\s*students?|students?\s*(?:and|&|,)\s*teachers?)/i,
  /how\s+many\s+(?:teachers?|students?|classes?).*(?:\bdep(?:t)?\b|\bdepartment\b)/i,
  /(?:teachers?|students?|classes?).*(?:in|for)\s+(?:my\s+)?(?:dep(?:artment)?|dept)\b/i,
  /(?:my\s+)?(?:dep(?:artment)?|dept)\s+(?:stats|statistics|size|headcount|overview|numbers)/i,
  /(?:count|number\s+of)\s+(?:teachers?|students?).*(?:dep|department)/i,
  /how\s+many.*(?:\bdep(?:t)?\b|\bdepartment\b)/i,
];

// ─── Action Definitions ───────────────────────────────────────────────────────

export const hodActions: ActionDefinition[] = [
  createRegistrationLinkActionDef,
  {
    action: 'start_session',
    description: 'Start an attendance session for a class in your department',
    destructive: false,
    patterns: [
      /start\s+(?:a\s+)?(?:session|class|attendance)/i,
      /begin\s+(?:a\s+)?(?:session|class|attendance)/i,
      /open\s+(?:a\s+)?(?:session|attendance)/i,
    ],
    extractParams: (message: string) => {
      const classMatch = message.match(/(?:for|class)\s+([a-z0-9\s-]+?)(?:\s+now|\s+please|$)/i);
      return { className: classMatch?.[1]?.trim() };
    },
    descriptionTemplate: (params) =>
      `Start an attendance session${params.className ? ` for "${params.className}"` : ''}.`,
    handler: startHodSessionHandler,
  },
  {
    action: 'end_session',
    description: 'End an active attendance session in your department',
    destructive: true,
    patterns: [
      /end\s+(?:the\s+)?(?:session|class|attendance)/i,
      /stop\s+(?:the\s+)?(?:session|class|attendance)/i,
      /close\s+(?:the\s+)?(?:session|attendance)/i,
    ],
    extractParams: (message: string) => {
      const classMatch = message.match(/(?:for|class)\s+([a-z0-9\s-]+?)(?:\s+now|\s+please|$)/i);
      return { className: classMatch?.[1]?.trim() };
    },
    descriptionTemplate: (params) =>
      `End active attendance session${params.className ? ` for "${params.className}"` : ''}.`,
    handler: endHodSessionHandler,
  },
  {
    action: 'mark_attendance',
    description: 'Mark a student as present, absent, or late in an active department session',
    destructive: false,
    patterns: [
      /mark\s+(.+?)\s+(?:as\s+)?(?:present|absent|late)/i,
      /record\s+(.+?)\s+(?:as\s+)?(?:present|absent|late)/i,
      /(.+?)\s+is\s+(?:present|absent|late)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const studentName = match && match[1] ? match[1].trim() : '';
      const statusMatch = message.match(/(?:as\s+)?(present|absent|late)/i);
      const classMatch = message.match(/(?:for|class)\s+([a-z0-9\s-]+?)(?:\s+now|\s+please|$)/i);
      return {
        studentName,
        status: statusMatch ? statusMatch[1].toUpperCase() : 'PRESENT',
        className: classMatch?.[1]?.trim(),
      };
    },
    descriptionTemplate: (params) =>
      `Mark "${params.studentName}" as ${params.status}.`,
    handler: markHodAttendanceHandler,
  },
  {
    action: 'add_teacher',
    description: 'Assign a teacher to your department',
    destructive: false,
    patterns: [
      /add\s+teacher\s+(.+)/i,
      /assign\s+(.+)\s+to\s+(?:my\s+)?department/i,
      /add\s+(.+)\s+to\s+(?:my\s+)?department/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const teacherName = match && match[1] ? match[1].trim() : '';
      return { teacherName };
    },
    descriptionTemplate: (params) =>
      `Assign teacher "${params.teacherName}" to your department.`,
    handler: addTeacherHandler,
  },
  {
    action: 'create_class',
    description: 'Create a class in your department',
    destructive: false,
    patterns: [
      /create\s+(?:a\s+)?class\s+(.+)/i,
      /add\s+(?:a\s+)?(?:new\s+)?class\s+(.+)/i,
      /new\s+class\s+(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const raw = match && match[1] ? match[1].trim() : '';
      const capacityMatch = raw.match(/\b(?:capacity|cap)\s*(?:of\s*)?(\d+)\b/i);
      const className = raw
        .replace(/\b(?:with\s+)?(?:capacity|cap)\s*(?:of\s*)?\d+\b/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        className,
        ...(capacityMatch ? { capacity: Number(capacityMatch[1]) } : {}),
      };
    },
    descriptionTemplate: (params) =>
      `Create class "${params.className}" in your department.`,
    handler: createDepartmentClassHandler,
  },
  {
    action: 'view_department_stats',
    description:
      'View statistics for your department (teacher count, student count, class count)',
    destructive: false,
    patterns: DEPARTMENT_STATS_PATTERNS,
    extractParams: () => ({}),
    descriptionTemplate: () =>
      'View department statistics (teachers, students, classes).',
    handler: viewDepartmentStatsHandler,
  },
  {
    action: 'send_class_notification',
    description: 'Send an in-app notification to a class in your department',
    destructive: true,
    patterns: [
      /(?:notify|message|send)\s+(?:to\s+)?class\s+(.+?)\s*[:,-]?\s*(.+)/i,
      /notify\s+(?:the\s+)?class\s+(.+?)\s*[:,-]?\s*(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      if (match && match[2]) {
        return {
          className: match[1]?.trim(),
          message: match[2].trim(),
          targetRole: parseNotificationTargetRole(message),
        };
      }
      return { message: extractMessageBody(match), targetRole: parseNotificationTargetRole(message) };
    },
    descriptionTemplate: (params) =>
      `Send in-app notification to class${params.className ? ` "${params.className}"` : ''}: "${String(params.message).slice(0, 80)}${String(params.message).length > 80 ? '…' : ''}"`,
    handler: sendClassNotificationHandler,
  },
  {
    action: 'send_department_notification',
    description:
      'Send an in-app notification to your department (all users, or students/teachers only)',
    destructive: true,
    patterns: [
      /^(?:post|send)\s+(?:a\s+)?(?:notification|message|announcement)\s*$/i,
      /^(?:notify|message)\s+(?:my\s+)?(?:department|dept)\s*$/i,
      /(?:notify|message|send)\s+(?:to\s+)?(?:my\s+)?department\s*[:,-]?\s*(.+)/i,
      /notify\s+(?:the\s+)?(?:department\s+)?students?\s*[:,-]?\s*(.+)/i,
      /notify\s+(?:the\s+)?(?:department\s+)?teachers?\s*[:,-]?\s*(.+)/i,
      /send\s+(?:a\s+)?message\s+to\s+(?:my\s+)?(?:dep(?:artment)?|dept)\s*[:,-]?\s*(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => ({
      message: extractMessageBody(match),
      targetRole: parseNotificationTargetRole(message),
    }),
    descriptionTemplate: (params) =>
      `Send in-app notification to your department${params.targetRole ? ` (${params.targetRole}s only)` : ''}: "${String(params.message).slice(0, 80)}${String(params.message).length > 80 ? '…' : ''}"`,
    handler: sendDepartmentNotificationHandler,
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
