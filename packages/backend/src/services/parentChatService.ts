import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../lib/prisma';
import { getSocketIO } from '../lib/socket';

/**
 * Parent-teacher chat service.
 *
 * Parents can message teachers of their linked children.
 * Teachers who teach those children can reply.
 * Messages are stored as Notification rows with type='PARENT_CHAT'.
 *
 * No modifications to scopedNotificationSend — this uses dedicated routes + direct DB/socket ops.
 */

export const PARENT_CHAT_NOTIFICATION_TYPE = 'PARENT_CHAT';

/** Teacher info returned to parent when listing available teachers. */
export interface TeacherInfo {
  id: string;
  fullName: string;
  subjects: string[];
  childName: string;
  childId: string;
  className: string;
}

/** Conversation thread summary for teacher inbox. */
export interface ParentConversationSummary {
  parentId: string;
  parentName: string;
  childName: string;
  childId: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
}

/**
 * Get all teachers for a parent's linked children.
 * Returns deduplicated teacher list with child context.
 */
export async function getParentTeachers(
  parentId: string,
  schoolId: string,
): Promise<TeacherInfo[]> {
  const links = await prisma.guardian.findMany({
    where: { guardianId: parentId, schoolId },
    include: {
      student: {
        select: {
          id: true,
          fullName: true,
          classId: true,
          class: { select: { id: true, name: true } },
        },
      },
    },
  });

  const teacherMap = new Map<string, TeacherInfo>();

  for (const link of links) {
    const student = link.student;
    if (!student.classId) continue;

    const teacherIds = new Set<string>();

    // Class teacher
    const cls = await prisma.class.findUnique({
      where: { id: student.classId },
      select: { classTeacherId: true },
    });
    if (cls?.classTeacherId) teacherIds.add(cls.classTeacherId);

    // Timetable teachers
    const entries = await prisma.timetableEntry.findMany({
      where: { classId: student.classId },
      select: { teacherId: true, subject: true },
      distinct: ['teacherId'],
    });
    for (const e of entries) teacherIds.add(e.teacherId);

    if (teacherIds.size === 0) continue;

    const teachers = await prisma.user.findMany({
      where: { id: { in: [...teacherIds] }, schoolId },
      select: { id: true, fullName: true },
    });

    for (const t of teachers) {
      const subjects = entries
        .filter((e) => e.teacherId === t.id)
        .map((e) => e.subject)
        .filter(Boolean);
      const key = t.id;
      if (teacherMap.has(key)) {
        const existing = teacherMap.get(key)!;
        if (!existing.subjects.some((s) => subjects.includes(s))) {
          existing.subjects.push(...subjects);
        }
      } else {
        teacherMap.set(key, {
          id: t.id,
          fullName: t.fullName,
          subjects: [...new Set(subjects)],
          childName: student.fullName,
          childId: student.id,
          className: student.class?.name ?? '',
        });
      }
    }
  }

  return [...teacherMap.values()];
}

/**
 * Send a message from parent to a specific teacher.
 * Creates a Notification for the teacher with type='PARENT_CHAT'.
 */
export async function parentSendToTeacher(
  parentId: string,
  schoolId: string,
  teacherId: string,
  message: string,
  childId?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!message?.trim()) {
    return { success: false, error: 'Message is required' };
  }

  // Verify this parent is linked to a child that the teacher teaches
  const teachers = await getParentTeachers(parentId, schoolId);
  const teachesChild = teachers.some((t) => t.id === teacherId);
  if (!teachesChild) {
    return { success: false, error: 'This teacher does not teach any of your linked children' };
  }

  const teacher = await prisma.user.findUnique({
    where: { id: teacherId, schoolId },
    select: { id: true },
  });
  if (!teacher) {
    return { success: false, error: 'Teacher not found' };
  }

  const parent = await prisma.user.findUnique({
    where: { id: parentId },
    select: { fullName: true },
  });

  const batchId = createId();
  const child = childId
    ? teachers.find((t) => t.childId === childId)
    : teachers.find((t) => t.id === teacherId);
  const childName = child?.childName ?? 'a student';

  const title = `Message from ${parent?.fullName ?? 'Parent'} (${childName})`;

  await prisma.notification.create({
    data: {
      schoolId,
      userId: teacherId,
      senderId: parentId,
      batchId,
      title,
      message: message.trim(),
      type: PARENT_CHAT_NOTIFICATION_TYPE,
      scope: 'parent_teacher',
      targetId: childId ?? null,
      targetRole: 'TEACHER',
    },
  });

  // Real-time emit
  setImmediate(() => {
    try {
      getSocketIO().to(`user:${teacherId}`).emit('notification:new', {
        title,
        message: message.trim(),
        type: PARENT_CHAT_NOTIFICATION_TYPE,
        senderId: parentId,
        batchId,
        timestamp: new Date().toISOString(),
        teacherInfo: { childName },
      });
    } catch { /* socket may not be ready */ }
  });

  return { success: true };
}

/**
 * Teacher replies to a parent.
 * The parent's ID is extracted from the original chat notification.
 */
export async function teacherReplyToParent(
  teacherId: string,
  schoolId: string,
  parentId: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  if (!message?.trim()) {
    return { success: false, error: 'Message is required' };
  }

  const teacher = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { fullName: true },
  });

  const batchId = createId();
  const title = `Reply from ${teacher?.fullName ?? 'Teacher'}`;

  await prisma.notification.create({
    data: {
      schoolId,
      userId: parentId,
      senderId: teacherId,
      batchId,
      title,
      message: message.trim(),
      type: PARENT_CHAT_NOTIFICATION_TYPE,
      scope: 'parent_teacher',
      targetRole: 'GUARDIAN',
    },
  });

  setImmediate(() => {
    try {
      getSocketIO().to(`user:${parentId}`).emit('notification:new', {
        title,
        message: message.trim(),
        type: PARENT_CHAT_NOTIFICATION_TYPE,
        senderId: teacherId,
        batchId,
        timestamp: new Date().toISOString(),
      });
    } catch { /* socket may not be ready */ }
  });

  return { success: true };
}

/**
 * Get parent conversations for a teacher.
 * Groups PARENT_CHAT notifications by sender (parent).
 */
export async function getTeacherParentConversations(
  teacherId: string,
  schoolId: string,
): Promise<ParentConversationSummary[]> {
  const notifications = await prisma.notification.findMany({
    where: {
      schoolId,
      userId: teacherId,
      type: PARENT_CHAT_NOTIFICATION_TYPE,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Group by senderId
  const grouped = new Map<string, typeof notifications>();
  for (const n of notifications) {
    if (!n.senderId) continue;
    const existing = grouped.get(n.senderId) ?? [];
    existing.push(n);
    grouped.set(n.senderId, existing);
  }

  const summaries: ParentConversationSummary[] = [];

  for (const [parentId, msgs] of grouped) {
    const parent = await prisma.user.findUnique({
      where: { id: parentId },
      select: { fullName: true },
    });

    // Extract child name from the most recent title
    const lastMsg = msgs[0];
    const childNameMatch = lastMsg.title.match(/\(([^)]+)\)$/);
    const childName = childNameMatch?.[1] ?? 'Unknown';

    summaries.push({
      parentId,
      parentName: parent?.fullName ?? 'Unknown Parent',
      childName,
      childId: lastMsg.targetId ?? '',
      lastMessage: lastMsg.message,
      lastMessageAt: lastMsg.createdAt,
      unreadCount: msgs.filter((m) => !m.read).length,
    });
  }

  return summaries.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
}

/**
 * Get the full conversation thread between a parent and teacher.
 */
export async function getParentTeacherThread(
  schoolId: string,
  userId: string,
  otherUserId: string,
): Promise<Array<{
  id: string;
  senderId: string | null;
  message: string;
  title: string;
  createdAt: Date;
  isMine: boolean;
}>> {
  const notifications = await prisma.notification.findMany({
    where: {
      schoolId,
      type: PARENT_CHAT_NOTIFICATION_TYPE,
      OR: [
        { userId, senderId: otherUserId },
        { userId: otherUserId, senderId: userId },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  return notifications.map((n) => ({
    id: n.id,
    senderId: n.senderId,
    message: n.message,
    title: n.title,
    createdAt: n.createdAt,
    isMine: n.senderId === userId,
  }));
}
