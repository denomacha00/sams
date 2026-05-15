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

const addKnowledgeHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');

  const title = params.title as string;
  const content = params.content as string;
  const category = (params.category as string) || 'general';

  if (!title || !content) {
    return { answer: 'Please provide both a title and content for the knowledge entry.' };
  }

  const entry = await prisma.aIKnowledge.create({
    data: { title, content, category },
  });

  return {
    answer: `✅ Knowledge entry "${title}" added.`,
    data: { entryId: entry.id },
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
    action: 'add_knowledge',
    description: 'Add a knowledge base entry for the AI assistant',
    destructive: false,
    patterns: [
      /add\s+(?:a\s+)?knowledge\s+(?:entry\s+)?(.+)/i,
      /create\s+(?:a\s+)?knowledge\s+(?:entry\s+)?(.+)/i,
      /new\s+knowledge\s+(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const remainder = match && match[1] ? match[1].trim() : '';
      // Try to split title and content by common separators
      const colonSplit = remainder.split(':');
      if (colonSplit.length >= 2) {
        return { title: colonSplit[0].trim(), content: colonSplit.slice(1).join(':').trim() };
      }
      return { title: remainder, content: '' };
    },
    descriptionTemplate: (params) =>
      `Add knowledge entry "${params.title}".`,
    handler: addKnowledgeHandler,
  },
];
