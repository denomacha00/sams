import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { UserRole } from '@sams/shared';
import { extractMessageBody, parseNotificationTargetRole } from '../notificationActionParams';
import { fetchDepartmentStudents, fetchDepartmentTeachers } from '../departmentStatsQuery';
import { buildExportReportActionDefForRole } from './reportExportAction';
import { notificationInboxActions } from './notificationInboxActions';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const addUserHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const fullName = params.fullName as string;
  const role = (params.role as string) || 'STUDENT';
  const email = params.email as string | undefined;

  if (!fullName) return { answer: 'Please provide the full name of the user to add.' };

  const user = await prisma.user.create({
    data: {
      schoolId: scope.schoolId,
      fullName,
      role: role.toUpperCase() as any,
      email,
      passwordHash: '', // Requires activation flow
    },
  });

  return {
    answer: `✅ User "${fullName}" created with role ${role.toUpperCase()}.`,
    data: { userId: user.id, fullName, role: role.toUpperCase() },
  };
};

const removeUserHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const userId = params.userId as string | undefined;
  const fullName = params.fullName as string | undefined;

  if (!userId && !fullName) return { answer: 'Please provide the name or ID of the user to remove.' };

  const user = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      ...(userId ? { id: userId } : { fullName: { contains: fullName, mode: 'insensitive' } }),
    },
  });

  if (!user) return { answer: `User "${fullName || userId}" not found in your school.` };

  await prisma.user.delete({ where: { id: user.id } });
  return {
    answer: `✅ User "${user.fullName}" has been removed from the system.`,
    data: { userId: user.id, fullName: user.fullName },
  };
};

const createClassHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const className = params.className as string;
  const departmentId = params.departmentId as string | undefined;

  if (!className) return { answer: 'Please provide the class name.' };

  const dept = departmentId
    ? await prisma.department.findFirst({ where: { id: departmentId, schoolId: scope.schoolId } })
    : await prisma.department.findFirst({ where: { schoolId: scope.schoolId } });

  if (!dept) return { answer: 'No department found. Please create a department first.' };

  const cls = await prisma.class.create({
    data: { schoolId: scope.schoolId, departmentId: dept.id, name: className },
  });

  return {
    answer: `✅ Class "${className}" created in department "${dept.name}".`,
    data: { classId: cls.id, className, departmentName: dept.name },
  };
};

const createDepartmentHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const departmentName = params.departmentName as string;
  if (!departmentName) return { answer: 'Please provide the department name.' };

  const dept = await prisma.department.create({
    data: { schoolId: scope.schoolId, name: departmentName },
  });

  return {
    answer: `✅ Department "${departmentName}" created.`,
    data: { departmentId: dept.id, departmentName },
  };
};

const sendSchoolNotificationHandler: ActionHandler = async (params, scope) => {
  const {
    assertAiNotificationChannels,
    ScopedNotificationError,
    sendScopedNotification,
  } = await import('../../scopedNotificationSend');

  const message = (params.message as string)?.trim();
  if (!message) {
    return { answer: 'Please include the message (e.g. "notify school: Holiday on Friday").' };
  }

  const targetRole = (params.targetRole as 'TEACHER' | 'STUDENT' | 'HOD' | undefined) ?? undefined;

  try {
    assertAiNotificationChannels(['inapp']);
    const result = await sendScopedNotification(
      { sub: scope.userId, role: scope.role, schoolId: scope.schoolId },
      {
        scope: 'school',
        targetRole,
        title: (params.title as string)?.trim() || 'School announcement',
        message,
        channels: ['inapp'],
      },
    );

    if (!result.success) {
      return { answer: result.warning ?? 'No users matched for this school-wide message.' };
    }

    return {
      answer: `✅ Sent to ${result.recipientCount} user(s) school-wide.`,
      data: { batchId: result.batchId, recipientCount: result.recipientCount },
    };
  } catch (err) {
    if (err instanceof ScopedNotificationError) {
      return { answer: `❌ ${err.message}` };
    }
    throw err;
  }
};

const sendClassNotificationHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');
  const {
    assertAiNotificationChannels,
    ScopedNotificationError,
    sendScopedNotification,
  } = await import('../../scopedNotificationSend');

  const message = (params.message as string)?.trim();
  if (!message) {
    return { answer: 'What is the message text for this class notification?' };
  }

  let classId = params.classId as string | undefined;
  const className = (params.className as string)?.trim();
  if (!classId && className) {
    const cls = await prisma.class.findFirst({
      where: {
        schoolId: scope.schoolId,
        name: { contains: className, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
    if (!cls) return { answer: `Class "${className}" not found.` };
    classId = cls.id;
  }

  if (!classId) {
    return { answer: 'Which class should receive this? (Reply with the class name.)' };
  }

  const targetRole = (params.targetRole as 'TEACHER' | 'STUDENT' | undefined) ?? undefined;

  try {
    assertAiNotificationChannels(['inapp']);
    const result = await sendScopedNotification(
      { sub: scope.userId, role: scope.role, schoolId: scope.schoolId },
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
      answer: `✅ Sent to ${result.recipientCount} user(s) in the class.`,
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
  const { prisma } = await import('../../../index');
  const {
    assertAiNotificationChannels,
    ScopedNotificationError,
    sendScopedNotification,
  } = await import('../../scopedNotificationSend');

  const message = (params.message as string)?.trim();
  if (!message) {
    return {
      answer:
        'Please include the message (e.g. "notify Science department students: Exam Monday").',
    };
  }

  const departmentName = (params.departmentName as string)?.trim();
  const dept = departmentName
    ? await prisma.department.findFirst({
        where: {
          schoolId: scope.schoolId,
          name: { contains: departmentName, mode: 'insensitive' },
        },
      })
    : await prisma.department.findFirst({ where: { schoolId: scope.schoolId } });

  if (!dept) {
    return {
      answer: departmentName
        ? `Department "${departmentName}" not found.`
        : 'No departments found in your school.',
    };
  }

  const targetRole = (params.targetRole as 'TEACHER' | 'STUDENT' | undefined) ?? undefined;

  try {
    assertAiNotificationChannels(['inapp']);
    const result = await sendScopedNotification(
      { sub: scope.userId, role: scope.role, schoolId: scope.schoolId },
      {
        scope: 'department',
        targetId: dept.id,
        targetRole,
        title: (params.title as string)?.trim() || 'Department message',
        message,
        channels: ['inapp'],
      },
    );

    if (!result.success) {
      return { answer: result.warning ?? `No users matched in department "${dept.name}".` };
    }

    return {
      answer: `✅ Sent to ${result.recipientCount} user(s) in "${dept.name}".`,
      data: { batchId: result.batchId, recipientCount: result.recipientCount, departmentId: dept.id },
    };
  } catch (err) {
    if (err instanceof ScopedNotificationError) {
      return { answer: `❌ ${err.message}` };
    }
    throw err;
  }
};

const resetUserPasswordHandler: ActionHandler = async (params, scope) => {
  const { resetUserPasswordByAdmin } = await import('../../passwordResetService');

  const identifier = (params.identifier as string) || (params.username as string) || '';
  const modeRaw = (params.mode as string) || 'temp_password';
  const mode = modeRaw === 'trigger_reset' ? 'trigger_reset' : 'temp_password';

  if (!identifier.trim()) {
    return {
      answer:
        'Who needs a password reset? Say: "reset password for [username or email]" — users must be in your school.',
    };
  }

  const result = await resetUserPasswordByAdmin({
    identifier,
    mode,
    actorId: scope.userId,
    actorRole: scope.role,
    actorScope: { kind: 'school', schoolId: scope.schoolId },
  });

  return { answer: result.answer, data: result.data };
};

const getSchoolStatsHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');

  const [totalStudents, totalTeachers, totalHODs, totalDepartments, totalClasses, totalSessions, students, teachers] = await Promise.all([
    prisma.user.count({ where: { schoolId: scope.schoolId, role: 'STUDENT' } }),
    prisma.user.count({ where: { schoolId: scope.schoolId, role: 'TEACHER' } }),
    prisma.user.count({ where: { schoolId: scope.schoolId, role: 'HOD' } }),
    prisma.department.count({ where: { schoolId: scope.schoolId } }),
    prisma.class.count({ where: { schoolId: scope.schoolId } }),
    prisma.attendanceSession.count({ where: { schoolId: scope.schoolId } }),
    prisma.user.findMany({
      where: { schoolId: scope.schoolId, role: 'STUDENT' },
      select: { fullName: true, admissionNumber: true },
      orderBy: { fullName: 'asc' },
    }),
    prisma.user.findMany({
      where: { schoolId: scope.schoolId, role: 'TEACHER' },
      select: { fullName: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  const totalUsers = totalStudents + totalTeachers + totalHODs + 1; // +1 for admin

  const lines: string[] = [
    `📊 **School Statistics**`,
    '',
    `• **Total Users:** ${totalUsers}`,
    `• **Students:** ${totalStudents}`,
    `• **Teachers:** ${totalTeachers}`,
    `• **HODs:** ${totalHODs}`,
    `• **Departments:** ${totalDepartments}`,
    `• **Classes:** ${totalClasses}`,
    `• **Attendance Sessions:** ${totalSessions}`,
  ];

  if (teachers.length > 0) {
    lines.push('');
    lines.push(`**Teachers:**`);
    teachers.forEach((t) => lines.push(`  👤 ${t.fullName}`));
  }

  if (students.length > 0) {
    lines.push('');
    lines.push(`**Students:**`);
    students.forEach((s) => {
      const label = s.admissionNumber ? `${s.fullName} (${s.admissionNumber})` : s.fullName;
      lines.push(`  🧑‍🎓 ${label}`);
    });
  }

  return {
    answer: lines.join('\n'),
    data: { totalStudents, totalTeachers, totalHODs, totalDepartments, totalClasses, totalSessions, totalUsers },
  };
};

const viewSchoolStudentsHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');

  const students = await prisma.user.findMany({
    where: { schoolId: scope.schoolId, role: 'STUDENT' },
    select: { fullName: true, admissionNumber: true, class: { select: { name: true } } },
    orderBy: { fullName: 'asc' },
    take: 100,
  });

  if (students.length === 0) {
    return { answer: 'No students registered in your school yet.', data: { count: 0 } };
  }

  const lines = students.map((s, i) => {
    const label = s.admissionNumber ? `${s.fullName} (${s.admissionNumber})` : s.fullName;
    const classInfo = s.class?.name ? ` — ${s.class.name}` : '';
    return `${i + 1}. ${label}${classInfo}`;
  });

  return {
    answer: `🧑‍🎓 **Students in your school (${students.length})**\n\n${lines.join('\n')}`,
    data: { count: students.length, students },
  };
};

const viewSchoolTeachersHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');

  const teachers = await prisma.user.findMany({
    where: { schoolId: scope.schoolId, role: 'TEACHER' },
    select: { fullName: true },
    orderBy: { fullName: 'asc' },
    take: 100,
  });

  if (teachers.length === 0) {
    return { answer: 'No teachers registered in your school yet.', data: { count: 0 } };
  }

  const lines = teachers.map((t, i) => `${i + 1}. 👤 ${t.fullName}`);

  return {
    answer: `👤 **Teachers in your school (${teachers.length})**\n\n${lines.join('\n')}`,
    data: { count: teachers.length, teachers },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const schoolAdminActions: ActionDefinition[] = [
  ...notificationInboxActions,
  buildExportReportActionDefForRole(UserRole.SCHOOL_ADMIN),
  {
    action: 'add_user',
    description: 'Add a new user (student, teacher, or staff) to the school',
    destructive: false,
    patterns: [
      /^(?:add|create|register)\s+(?:a\s+)?user\s*$/i,
      /add\s+(?:a\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
      /create\s+(?:a\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
      /register\s+(?:a\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const remainder = match && match[1] ? match[1].trim() : '';
      let role = 'STUDENT';
      if (/teacher/i.test(message)) role = 'TEACHER';
      else if (/staff/i.test(message)) role = 'SCHOOL_ADMIN';
      const fullName = remainder
        .replace(/\s*(?:as|with role)\s+\w+$/i, '')
        .replace(/^named?\s+/i, '')
        .trim();
      return { fullName, role };
    },
    descriptionTemplate: (params) =>
      `Add user "${params.fullName}" with role ${params.role}.`,
    handler: addUserHandler,
  },
  {
    action: 'remove_user',
    description: 'Remove a user from the school',
    destructive: true,
    patterns: [
      /^(?:remove|delete)\s+(?:a\s+)?user\s*$/i,
      /remove\s+(?:the\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
      /delete\s+(?:the\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
      /remove\s+(.+)\s+from\s+(?:the\s+)?school/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const fullName = match && match[1] ? match[1].trim() : '';
      return { fullName };
    },
    descriptionTemplate: (params) =>
      `Remove user "${params.fullName}" from the school. This action cannot be undone.`,
    handler: removeUserHandler,
  },
  {
    action: 'create_class',
    description: 'Create a new class in the school',
    destructive: false,
    patterns: [
      /create\s+(?:a\s+)?class\s+(.+)/i,
      /add\s+(?:a\s+)?(?:new\s+)?class\s+(.+)/i,
      /new\s+class\s+(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const className = match && match[1] ? match[1].trim() : '';
      return { className };
    },
    descriptionTemplate: (params) =>
      `Create class "${params.className}".`,
    handler: createClassHandler,
  },
  {
    action: 'create_department',
    description: 'Create a new department in the school',
    destructive: false,
    patterns: [
      /create\s+(?:a\s+)?department\s+(.+)/i,
      /add\s+(?:a\s+)?(?:new\s+)?department\s+(.+)/i,
      /new\s+department\s+(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const departmentName = match && match[1] ? match[1].trim() : '';
      return { departmentName };
    },
    descriptionTemplate: (params) =>
      `Create department "${params.departmentName}".`,
    handler: createDepartmentHandler,
  },
  {
    action: 'get_school_stats',
    description: 'Get school statistics (students, teachers, departments, classes)',
    destructive: false,
    patterns: [
      /how\s+many\s+(students?|teachers?|users?|departments?|classes?|hods?)/i,
      /(?:show|get|what(?:'s| is| are)?)\s+(?:my\s+)?(?:school\s+)?(?:stats|statistics|numbers|data|overview)/i,
      /(?:total|count)\s+(?:of\s+)?(students?|teachers?|users?|departments?|classes?)/i,
      /(?:how many|number of)\s+(?:people|users|members)/i,
      /(?:school|my)\s+(?:info|information|details|summary)/i,
    ],
    extractParams: (message: string) => {
      const match = message.match(/(students?|teachers?|users?|departments?|classes?|hods?)/i);
      return { entity: match?.[1]?.toLowerCase() || 'all' };
    },
    descriptionTemplate: (params) =>
      `Get school statistics for ${params.entity || 'all'}.`,
    handler: getSchoolStatsHandler,
  },
  {
    action: 'reset_user_password',
    description: 'Reset a user password at your school (temporary password shown once, or send OTP reset). Cannot read existing passwords.',
    destructive: true,
    patterns: [
      /reset\s+(?:user\s+)?pass\s*word\s+(?:for\s+)?(.+)/i,
      /rest\s+(?:user\s+)?pass\s*word\s+(?:for\s+)?(.+)/i,
      /pass\s*word\s+reset\s+(?:for\s+)?(.+)/i,
      /otp\s+(?:pass\s*word\s+)?reset\s+(?:for\s+)?(.+)/i,
      /help\s+(?:user\s+)?(.+?)\s+(?:with\s+)?(?:login|password)/i,
      /help\s+(?:user\s+)?(.+?)\s+(?:with\s+)?(?:login|pass\s*word)/i,
      /forgot\s+pass\s*word\s+(?:for\s+)?(.+)/i,
      /new\s+(?:temp(?:orary)?\s+)?pass\s*word\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      let identifier = match && match[1] ? match[1].trim() : '';
      identifier = identifier.replace(/\s+(?:at|in)\s+school\s+\S+$/i, '').trim();
      const mode = /send\s+(?:otp|code|reset\s+link)|trigger\s+reset/i.test(message)
        ? 'trigger_reset'
        : 'temp_password';
      return { identifier, mode };
    },
    descriptionTemplate: (params) => {
      const who = params.identifier || 'user';
      const mode = params.mode === 'trigger_reset' ? 'send reset code to' : 'set temporary password for';
      return `${mode} "${who}" at your school. Existing passwords cannot be read.`;
    },
    handler: resetUserPasswordHandler,
  },
  {
    action: 'send_school_notification',
    description: 'Send an in-app notification school-wide (optional role filter)',
    destructive: true,
    patterns: [
      // Message-capturing patterns FIRST
      /(?:notify|message|send|write)\s+(?:to\s+)?(?:the\s+)?(?:whole\s+)?school\s*[:,-]\s*(.+)/i,
      /(?:notify|message|send)\s+(?:all\s+)?school\s+(?:students?|teachers?|staff)\s*[:,-]\s*(.+)/i,
      /school[\s-]wide\s+(?:message|notification)\s*[:,-]\s*(.+)/i,
      /write\s+(?:a\s+)?message\s+(?:to\s+)?(?:the\s+)?(?:whole\s+)?school\s*[:,-]\s*(.+)/i,
      /(?:need|want)\s+to\s+write\s+(?:a\s+)?(?:message|notification|announcement)/i,
      // Fallback patterns (no message — handler will ask)
      /^(?:post|send|write)\s+(?:a\s+)?(?:notification|message|announcement)\s+to\s+(?:the\s+)?(?:whole\s+)?school\s*$/i,
      /^(?:notify|message)\s+(?:the\s+)?school\s*$/i,
      /^(?:post|send|write)\s+(?:a\s+)?(?:notification|message|announcement)\s*$/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      if (match && match[1] && match[1].trim()) {
        return { message: match[1].trim(), targetRole: parseNotificationTargetRole(message) };
      }
      const colonMatch = message.match(/[:,]\s*(.+)$/);
      if (colonMatch) {
        return { message: colonMatch[1].trim(), targetRole: parseNotificationTargetRole(message) };
      }
      return { message: extractMessageBody(match), targetRole: parseNotificationTargetRole(message) };
    },
    descriptionTemplate: (params) =>
      `Send in-app notification school-wide: "${String(params.message).slice(0, 80)}${String(params.message).length > 80 ? '…' : ''}"`,
    handler: sendSchoolNotificationHandler,
  },
  {
    action: 'send_class_notification',
    description: 'Send an in-app notification to a class (by name)',
    destructive: true,
    patterns: [
      // Message-capturing patterns FIRST
      /(?:notify|message|send)\s+(?:to\s+)?class\s+(.+?)\s*[:,-]\s*(.+)/i,
      /notify\s+(?:the\s+)?class\s+(.+?)\s*[:,-]\s*(.+)/i,
      /(?:notify|message|send)\s+(?:to\s+)?class\s+(.+?)\s*(?:that|saying|about)\s*(.+)/i,
      // Fallback — no message text, handler will ask
      /^(?:post|send)\s+(?:a\s+)?(?:notification|message|announcement)\s+to\s+(?:the\s+)?class\s+(.+)\s*$/i,
      /^(?:notify|message)\s+(?:the\s+)?class\s+(.+)\s*$/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      if (match && match[2]) {
        return {
          className: match[1]?.trim(),
          message: match[2].trim(),
          targetRole: parseNotificationTargetRole(message),
        };
      }
      const colonMatch = message.match(/[:,]\s*(.+)$/);
      if (colonMatch) {
        return { message: colonMatch[1].trim(), targetRole: parseNotificationTargetRole(message) };
      }
      return { message: extractMessageBody(match), targetRole: parseNotificationTargetRole(message) };
    },
    descriptionTemplate: (params) =>
      `Send in-app notification to class${params.className ? ` "${params.className}"` : ''}: "${String(params.message).slice(0, 80)}${String(params.message).length > 80 ? '…' : ''}"`,
    handler: sendClassNotificationHandler,
  },
  {
    action: 'send_department_notification',
    description: 'Send an in-app notification to a department (by name if given)',
    destructive: true,
    patterns: [
      // Message-capturing patterns FIRST
      /(?:notify|message|send)\s+(?:to\s+)?(?:the\s+)?(.+?)\s+department\s*[:,-]\s*(.+)/i,
      /(?:notify|message)\s+department\s+(.+?)\s*[:,-]\s*(.+)/i,
      /(?:notify|message|send)\s+(?:to\s+)?(?:the\s+)?(.+?)\s+department\s*(?:that|saying|about)\s*(.+)/i,
      // Fallback — no message text, handler will ask
      /^(?:post|send)\s+(?:a\s+)?(?:notification|message|announcement)\s+to\s+(?:the\s+)?department\s+(.+)\s*$/i,
      /^(?:notify|message)\s+(?:the\s+)?department\s+(.+)\s*$/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      if (match && match[2]) {
        return {
          departmentName: match[1]?.trim(),
          message: match[2].trim(),
          targetRole: parseNotificationTargetRole(message),
        };
      }
      const colonMatch = message.match(/[:,]\s*(.+)$/);
      if (colonMatch) {
        return { message: colonMatch[1].trim(), targetRole: parseNotificationTargetRole(message) };
      }
      return {
        message: extractMessageBody(match),
        targetRole: parseNotificationTargetRole(message),
      };
    },
    descriptionTemplate: (params) =>
      `Send in-app notification to department${params.departmentName ? ` "${params.departmentName}"` : ''}: "${String(params.message).slice(0, 80)}${String(params.message).length > 80 ? '…' : ''}"`,
    handler: sendDepartmentNotificationHandler,
  },
  {
    action: 'view_school_students',
    description: 'List all students in your school with names, admission numbers, and class',
    destructive: false,
    patterns: [
      /(?:list|show|view)\s+(?:all\s+)?(?:school\s+)?(?:students?|student\s+names?|student\s+list|roster)/i,
      /(?:who\s+are|name)\s+(?:the\s+)?(?:students?)\s+(?:in|of)\s+(?:the\s+)?(?:school|my\s+school)\b/i,
      /names?\s+of\s+(?:the\s+)?students?\s+(?:in|of)\s+(?:the\s+)?(?:school|my\s+school)\b/i,
      /names?\s*$/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List all students in your school with admission numbers and class.',
    handler: viewSchoolStudentsHandler,
  },
  {
    action: 'view_school_teachers',
    description: 'List all teachers in your school',
    destructive: false,
    patterns: [
      /(?:list|show|view)\s+(?:all\s+)?(?:school\s+)?(?:teachers?|teacher\s+names?|staff)/i,
      /(?:who\s+are|name)\s+(?:the\s+)?(?:teachers?|staff)\s+(?:in|of)\s+(?:the\s+)?(?:school|my\s+school)\b/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List all teachers in your school.',
    handler: viewSchoolTeachersHandler,
  },
];
