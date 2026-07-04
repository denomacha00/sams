import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { getParentTeachers, parentSendToTeacher, getParentTeacherThread } from '../../parentChatService';
import { createId } from '@paralleldrive/cuid2';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const listTeachersHandler: ActionHandler = async (_params, scope) => {
  const teachers = await getParentTeachers(scope.userId, scope.schoolId);

  if (teachers.length === 0) {
    return {
      answer: 'No teachers are linked to your children yet. Make sure your children are linked to a class with assigned teachers.',
      data: { teachers: [] },
    };
  }

  const lines = teachers.map((t, i) =>
    `${i + 1}. **${t.fullName}** — ${t.subjects.join(', ') || 'Subject teacher'} (${t.childName}, ${t.className})`
  );

  return {
    answer: `👩‍🏫 **Teachers you can message**\n\n${lines.join('\n')}\n\nSay **"message [teacher name]: [your message]"** to start a chat.`,
    data: { teachers },
  };
};

const sendMessageToTeacherHandler: ActionHandler = async (params, scope) => {
  const teacherName = (params.teacherName as string)?.trim();
  const messageText = (params.message as string)?.trim();

  if (!teacherName) {
    return { answer: 'Which teacher do you want to message? (Use their name from the list.)' };
  }
  if (!messageText) {
    return { answer: 'What message would you like to send to this teacher?' };
  }

  const teachers = await getParentTeachers(scope.userId, scope.schoolId);

  // Find teacher by name
  const teacher = teachers.find((t) =>
    t.fullName.toLowerCase().includes(teacherName.toLowerCase()),
  );

  if (!teacher) {
    const names = teachers.map((t) => t.fullName).join(', ');
    return {
      answer: `Teacher "${teacherName}" not found among your child's teachers. Available: ${names}.`,
    };
  }

  const result = await parentSendToTeacher(
    scope.userId,
    scope.schoolId,
    teacher.id,
    messageText,
    teacher.childId,
  );

  if (!result.success) {
    return { answer: `❌ ${result.error ?? 'Failed to send message.'}` };
  }

  return {
    answer: `✅ Your message has been sent to **${teacher.fullName}** regarding **${teacher.childName}**. They will receive it as a notification.`,
    data: { teacherId: teacher.id, teacherName: teacher.fullName, childName: teacher.childName },
  };
};

const viewChatWithTeacherHandler: ActionHandler = async (params, scope) => {
  const teacherName = (params.teacherName as string)?.trim();

  if (!teacherName) {
    return { answer: "Which teacher's conversation do you want to view?" };
  }

  const teachers = await getParentTeachers(scope.userId, scope.schoolId);
  const teacher = teachers.find((t) =>
    t.fullName.toLowerCase().includes(teacherName.toLowerCase()),
  );

  if (!teacher) {
    return { answer: 'Teacher not found. Say **"list my teachers"** to see who you can message.' };
  }

  const thread = await getParentTeacherThread(scope.schoolId, scope.userId, teacher.id);

  if (thread.length === 0) {
    return {
      answer: `No messages yet with **${teacher.fullName}**. Say **"message ${teacher.fullName}: [your message]"** to start a conversation.`,
      data: { teacherId: teacher.id, messages: [] },
    };
  }

  const lines = thread.map((msg) =>
    `**${msg.isMine ? 'You' : teacher.fullName}** (${new Date(msg.createdAt).toLocaleString()}):\n${msg.message}`
  );

  return {
    answer: `Conversation with ${teacher.fullName} (${thread.length} messages)\n\n${lines.join('\n\n')}`,
    data: { teacherId: teacher.id, messageCount: thread.length },
  };
};

// ─── Teacher-side handlers ────────────────────────────────────────────────────

const listParentConversationsHandler: ActionHandler = async (_params, scope) => {
  const { getTeacherParentConversations } = await import('../../parentChatService');
  const conversations = await getTeacherParentConversations(scope.userId, scope.schoolId);

  if (conversations.length === 0) {
    return { answer: 'No parent conversations yet. When a parent messages you, it will appear here.' };
  }

  const lines = conversations.map((c, i) =>
    `${i + 1}. **${c.parentName}** — ${c.childName} (${c.unreadCount > 0 ? `🔴 ${c.unreadCount} unread` : 'read'})\n   Last: "${c.lastMessage.slice(0, 60)}..."`
  );

  return {
    answer: `💬 **Parent Conversations** (${conversations.length})\n\n${lines.join('\n\n')}\n\nSay **"reply to [parent name]: [your message]"** to respond.`,
    data: { conversations },
  };
};

const replyToParentHandler: ActionHandler = async (params, scope) => {
  const parentName = (params.parentName as string)?.trim();
  const replyText = (params.message as string)?.trim();

  if (!parentName) return { answer: 'Which parent do you want to reply to?' };
  if (!replyText) return { answer: 'What would you like to say?' };

  const { getTeacherParentConversations, teacherReplyToParent } = await import('../../parentChatService');
  const conversations = await getTeacherParentConversations(scope.userId, scope.schoolId);

  const conv = conversations.find((c) =>
    c.parentName.toLowerCase().includes(parentName.toLowerCase()),
  );

  if (!conv) {
    const names = conversations.map((c) => c.parentName).join(', ');
    return { answer: `Parent "${parentName}" not found. Conversations with: ${names}.` };
  }

  const result = await teacherReplyToParent(scope.userId, scope.schoolId, conv.parentId, replyText);

  if (!result.success) {
    return { answer: `❌ ${result.error ?? 'Failed to send reply.'}` };
  }

  return {
    answer: `✅ Your reply has been sent to **${conv.parentName}** regarding **${conv.childName}**.`,
    data: { parentId: conv.parentId, parentName: conv.parentName, childName: conv.childName },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const parentChatTeacherActions: ActionDefinition[] = [
  {
    action: 'list_parent_conversations',
    description: 'View all parent conversations (teacher inbox)',
    destructive: false,
    patterns: [
      /parent\s+(?:messages|chats?|conversations)/i,
      /messages?\s+from\s+parents/i,
      /^parents?\s*$/i,
      /parent\s+inbox/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View all parent conversations in your inbox.',
    handler: listParentConversationsHandler,
  },
  {
    action: 'reply_to_parent',
    description: 'Reply to a parent who messaged you',
    destructive: true,
    patterns: [
      /reply\s+(?:to\s+)?(?:parent\s+)?(.+?)\s*[:,-]\s*(.+)/i,
      /respond\s+(?:to\s+)?(?:parent\s+)?(.+?)\s*[:,-]\s*(.+)/i,
      /message\s+(?:parent\s+)?(.+?)\s*(?:back)?\s*[:,-]\s*(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      if (match && match[2]) {
        return { parentName: match[1]?.trim(), message: match[2].trim() };
      }
      return { parentName: '', message: '' };
    },
    descriptionTemplate: (params) =>
      `Reply to parent "${params.parentName}".`,
    handler: replyToParentHandler,
  },
];

export const parentChatGuardianActions: ActionDefinition[] = [
  {
    action: 'list_my_teachers',
    description: 'List all teachers of your linked children',
    destructive: false,
    patterns: [
      /my\s+(children|kids|wards|students?)[\s']*\s*teachers?/i,
      /(?:list|show|view)\s+(?:my\s+)?children[\s']*\s*teachers?/i,
      /who\s+(?:teaches?|is\s+teaching)\s+(?:my\s+)?(?:children|kids|wards)/i,
      /teachers?\s+(?:of|for)\s+(?:my\s+)?(?:children|kids|wards|students?)/i,
      /^teachers?\s*$/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List teachers who teach your linked children.',
    handler: listTeachersHandler,
  },
  {
    action: 'send_message_to_teacher',
    description: 'Send a message to your child\'s teacher',
    destructive: true,
    patterns: [
      /(?:send|message)\s+(?:a\s+)?message\s+to\s+(?:teacher\s+)?(.+?)\s*[:,-]\s*(.+)/i,
      /message\s+(?:teacher\s+)?(.+?)\s*[:,-]\s*(.+)/i,
      /contact\s+(?:teacher\s+)?(.+?)\s*(?:about|regarding|saying)?\s*(.+)/i,
      /tell\s+(?:teacher\s+)?(.+?)\s*(?:that|about)?\s*(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      if (match && match[2]) {
        return { teacherName: match[1]?.trim(), message: match[2].trim() };
      }
      return { teacherName: '', message: '' };
    },
    descriptionTemplate: (params) =>
      `Send message to teacher "${params.teacherName}".`,
    handler: sendMessageToTeacherHandler,
  },
  {
    action: 'view_chat_with_teacher',
    description: 'View your conversation history with a teacher',
    destructive: false,
    patterns: [
      /(?:view|show|see)\s+(?:my\s+)?(?:chat|conversation|messages)\s+with\s+(.+)/i,
      /(?:chat|conversation)\s+(?:with|history\s+with)\s+(.+)/i,
      /messages?\s+(?:with|between)\s+(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      return { teacherName: match?.[1]?.trim() || '' };
    },
    descriptionTemplate: (params) =>
      `View your chat with teacher "${params.teacherName}".`,
    handler: viewChatWithTeacherHandler,
  },
];
