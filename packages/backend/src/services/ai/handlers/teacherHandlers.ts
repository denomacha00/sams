import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const startSessionHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const subject = params.subject as string | undefined;

  if (!scope.classId) {
    return { answer: 'Your account is not associated with a class.' };
  }

  const session = await prisma.attendanceSession.create({
    data: {
      schoolId: scope.schoolId,
      classId: scope.classId,
      teacherId: scope.userId,
      subject: subject || 'General',
      isActive: true,
    },
  });

  return {
    answer: `✅ Attendance session started for "${subject || 'General'}".`,
    data: { sessionId: session.id },
  };
};

const endSessionHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');

  const activeSession = await prisma.attendanceSession.findFirst({
    where: { teacherId: scope.userId, isActive: true },
  });

  if (!activeSession) return { answer: 'No active session found.' };

  await prisma.attendanceSession.update({
    where: { id: activeSession.id },
    data: { isActive: false, endedAt: new Date() },
  });

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

const sendClassMessageHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');
  const { resolveTeacherClassId } = await import('../../../lib/teacherScope');
  const { createId } = await import('@paralleldrive/cuid2');

  const message = (params.message as string)?.trim();
  if (!message) {
    return { answer: 'Please provide the message to send to your class (e.g. "message my class: Homework due Friday").' };
  }

  const classId = await resolveTeacherClassId(scope.userId, scope.classId);
  if (!classId) {
    return { answer: 'Your account is not associated with a class.' };
  }

  const students = await prisma.user.findMany({
    where: { schoolId: scope.schoolId, classId, role: 'STUDENT' },
    select: { id: true },
  });

  if (students.length === 0) {
    return { answer: 'No students in your class to message.' };
  }

  const batchId = createId();
  const title = (params.title as string)?.trim() || 'Class message';

  await prisma.notification.createMany({
    data: students.map((s) => ({
      schoolId: scope.schoolId,
      userId: s.id,
      senderId: scope.userId,
      batchId,
      title,
      message,
      type: 'MESSAGE',
      scope: 'class',
      targetId: classId,
      targetRole: 'STUDENT',
    })),
  });

  return {
    answer: `✅ In-app message sent to ${students.length} student(s) in your class. (SMS is not available via AI — use the Notifications page if your school admin enables SMS.)`,
    data: { batchId, recipientCount: students.length, classId },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const teacherActions: ActionDefinition[] = [
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
    handler: viewClassRosterHandler,
  },
  {
    action: 'send_class_message',
    description: 'Send an in-app message to all students in your class (not SMS)',
    destructive: true,
    patterns: [
      /(?:send|message)\s+(?:to\s+)?(?:my\s+)?class\s*[:,-]?\s*(.+)/i,
      /notify\s+(?:my\s+)?class\s*[:,-]?\s*(.+)/i,
      /tell\s+(?:my\s+)?class\s*[:,-]?\s*(.+)/i,
      /message\s+(?:all\s+)?(?:my\s+)?students?\s*[:,-]?\s*(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const message = match && match[1] ? match[1].trim() : '';
      return { message };
    },
    descriptionTemplate: (params) =>
      `Send in-app message to your class: "${String(params.message).slice(0, 80)}${String(params.message).length > 80 ? '…' : ''}"`,
    handler: sendClassMessageHandler,
  },
];
