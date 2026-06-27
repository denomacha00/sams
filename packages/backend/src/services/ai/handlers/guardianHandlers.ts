import { UserRole } from '@sams/shared';
import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { buildExportReportActionDefForRole } from './reportExportAction';
import { notificationInboxActions } from './notificationInboxActions';

interface LinkedChild {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  class: { id: string; name: string } | null;
}

async function getLinkedChildren(guardianId: string, schoolId: string): Promise<LinkedChild[]> {
  const { prisma } = await import('../../../lib/prisma');
  const links = await prisma.guardian.findMany({
    where: { guardianId, schoolId },
    include: {
      student: {
        select: {
          id: true,
          fullName: true,
          admissionNumber: true,
          class: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return links.map((link) => link.student);
}

function findChild(children: LinkedChild[], name?: unknown): LinkedChild | null {
  if (children.length === 0) return null;
  const raw = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (!raw) return children.length === 1 ? children[0] : null;

  return children.find((child) =>
    child.fullName.toLowerCase().includes(raw) ||
    (child.admissionNumber?.toLowerCase().includes(raw) ?? false),
  ) ?? null;
}

function extractChildName(message: string): string | undefined {
  const match = message.match(/\b(?:for|of|about)\s+(.+?)(?:\s+(?:attendance|report|timetable|schedule)|$)/i);
  return match?.[1]?.trim();
}

const listChildrenHandler: ActionHandler = async (_params, scope) => {
  const children = await getLinkedChildren(scope.userId, scope.schoolId);
  if (children.length === 0) {
    return {
      answer:
        'No linked students were found for your parent account. Ask the school admin to link you to your child.',
      data: { children: [] },
    };
  }

  const lines = children.map((child) =>
    `- ${child.fullName}${child.admissionNumber ? ` (${child.admissionNumber})` : ''}${child.class?.name ? ` - ${child.class.name}` : ''}`,
  );

  return {
    answer: `Linked student${children.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
    data: { children },
  };
};

const childAttendanceHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const children = await getLinkedChildren(scope.userId, scope.schoolId);
  const child = findChild(children, params.childName);

  if (!child) {
    if (children.length > 1) {
      return {
        answer:
          `Which child should I check? Reply with one of: ${children.map((item) => item.fullName).join(', ')}.`,
      };
    }
    return { answer: 'No linked student was found for your parent account.' };
  }

  const records = await prisma.attendanceRecord.findMany({
    where: { schoolId: scope.schoolId, studentId: child.id },
    orderBy: { scannedAt: 'desc' },
    take: 20,
    include: { session: { select: { subject: true, startedAt: true } } },
  });

  if (records.length === 0) {
    return { answer: `No attendance records found for ${child.fullName}.` };
  }

  const present = records.filter((record) => record.status === 'PRESENT' || record.status === 'LATE').length;
  const percentage = ((present / records.length) * 100).toFixed(1);
  const recent = records.slice(0, 5).map((record) =>
    `- ${record.scannedAt.toLocaleDateString()}: ${record.session?.subject ?? 'Lesson'} - ${record.status}`,
  );

  return {
    answer:
      `Attendance for ${child.fullName}: ${percentage}% (${present}/${records.length} recent records counted).\n\nRecent records:\n${recent.join('\n')}`,
    data: { childId: child.id, percentage: Number(percentage), total: records.length, present },
  };
};

const childTimetableHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');
  const children = await getLinkedChildren(scope.userId, scope.schoolId);
  const child = findChild(children, params.childName);

  if (!child) {
    if (children.length > 1) {
      return {
        answer:
          `Which child timetable should I show? Reply with one of: ${children.map((item) => item.fullName).join(', ')}.`,
      };
    }
    return { answer: 'No linked student was found for your parent account.' };
  }

  if (!child.class?.id) {
    return { answer: `${child.fullName} is not linked to a class yet.` };
  }

  const timetable = await prisma.timetableEntry.findMany({
    where: { schoolId: scope.schoolId, classId: child.class.id },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    include: { teacher: { select: { fullName: true } } },
  });

  if (timetable.length === 0) {
    return { answer: `No timetable entries found for ${child.fullName}'s class (${child.class.name}).` };
  }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const lines = timetable.slice(0, 30).map((entry) =>
    `- ${dayNames[entry.dayOfWeek] ?? `Day ${entry.dayOfWeek}`} ${entry.startTime}-${entry.endTime}: ${entry.subject} (${entry.teacher.fullName})`,
  );

  return {
    answer: `Timetable for ${child.fullName} (${child.class.name}):\n${lines.join('\n')}`,
    data: { childId: child.id, classId: child.class.id, entryCount: timetable.length },
  };
};

const exportChildReportHandler: ActionHandler = async (params, scope) => {
  const children = await getLinkedChildren(scope.userId, scope.schoolId);
  const child = findChild(children, params.childName);
  const format = String(params.format || 'pdf').toLowerCase();
  const safeFormat = format === 'excel' || format === 'csv' ? format : 'pdf';

  if (!child) {
    if (children.length > 1) {
      return {
        answer:
          `Which child report should I export? Reply with one of: ${children.map((item) => item.fullName).join(', ')}.`,
      };
    }
    return { answer: 'No linked student was found for your parent account.' };
  }

  const extension = safeFormat === 'excel' ? 'xlsx' : safeFormat;
  const filename = `${child.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-attendance.${extension}`;

  return {
    answer:
      `I prepared the real ${safeFormat.toUpperCase()} attendance report for ${child.fullName}. Use the download button below.`,
    data: {
      download: {
        kind: 'report',
        endpoint: `/reports/student:${encodeURIComponent(child.id)}/export?format=${safeFormat}`,
        filename,
        label: `Download ${safeFormat.toUpperCase()}`,
      },
    },
  };
};

export const guardianActions: ActionDefinition[] = [
  ...notificationInboxActions,
  buildExportReportActionDefForRole(UserRole.GUARDIAN),
  {
    action: 'list_linked_children',
    description: 'List linked children for a parent or guardian',
    destructive: false,
    patterns: [/linked\s+(?:children|students)/i, /my\s+(?:children|students|wards)/i, /show\s+(?:children|wards)/i],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List linked students for this parent account.',
    handler: listChildrenHandler,
  },
  {
    action: 'view_child_attendance',
    description: 'View attendance summary for a linked child',
    destructive: false,
    patterns: [/child.*attendance/i, /attendance.*child/i, /attendance\s+(?:for|of)\s+(.+)/i],
    extractParams: (message) => ({ childName: extractChildName(message) }),
    descriptionTemplate: () => 'View attendance for a linked child.',
    handler: childAttendanceHandler,
  },
  {
    action: 'view_child_timetable',
    description: 'View timetable for a linked child',
    destructive: false,
    patterns: [/child.*(?:timetable|schedule)/i, /(?:timetable|schedule).*(?:child|for|of)/i],
    extractParams: (message) => ({ childName: extractChildName(message) }),
    descriptionTemplate: () => 'View timetable for a linked child.',
    handler: childTimetableHandler,
  },
  {
    action: 'export_child_attendance_report',
    description: 'Export attendance report for a linked child',
    destructive: false,
    patterns: [
      /(?:export|download|generate|prepare).*(?:child|children|student).*(?:report|attendance)/i,
      /(?:export|download|generate|prepare).*(?:report|attendance).*(?:for|of)\s+(.+)/i,
    ],
    extractParams: (message) => ({
      childName: extractChildName(message),
      format: message.match(/\b(pdf|excel|csv|xlsx)\b/i)?.[1]?.toLowerCase().replace('xlsx', 'excel') ?? 'pdf',
    }),
    descriptionTemplate: () => 'Export attendance report for a linked child.',
    handler: exportChildReportHandler,
  },
];
