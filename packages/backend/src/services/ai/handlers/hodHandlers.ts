import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { HOD_DEPARTMENT_UNLINKED_MESSAGE } from '../../../lib/hodScope';
import { listSchoolAdminHandler } from '../../../lib/schoolAdminLookup';
import { fetchDepartmentStats, formatDepartmentStatsAnswer } from '../departmentStatsQuery';
import { extractMessageBody, parseNotificationTargetRole } from '../notificationActionParams';
import { SCHOOL_ADMIN_QUERY_PATTERNS } from '../studentContextQuery';
import { createRegistrationLinkActionDef } from './registrationLinkAction';

// ─── Handlers ─────────────────────────────────────────────────────────────────

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
