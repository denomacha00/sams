import OpenAI from 'openai';
import { prisma } from '../../lib/prisma';
import { type AccessTokenPayload, UserRole } from '@sams/shared';
import {
  extractProviderErrorText,
  formatProviderError,
  getAtomesusClient,
  getFallbackClient,
  getOpenAIClient,
  resolveChatModel,
  resolveAtomesusChatModel,
  resolveFallbackChatModel,
} from './aiProviderConfig';
import { buildRoleActionsPromptSection, buildRoleCapabilityMatrix } from './roleActionsPrompt';
import { isSamsDataQuery } from './dataQueryRouter';
import { getSystemDocumentationExcerpt } from './systemDocumentation';
import {
  formatStudentClassContextForPrompt,
  getStudentClassContext,
} from '../../lib/studentClassTeachers';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenAIQueryResult {
  answer: string;
  intent: string;
  data?: unknown;
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

const MAX_KNOWLEDGE_ENTRIES_IN_PROMPT = 12;
const MAX_KNOWLEDGE_ENTRY_CHARS = 900;
const MAX_KNOWLEDGE_SECTION_CHARS = 7_000;

// ─── HUMAN PERSONALITY IDENTITY ────────────────────────────────────────
// This is the core personality. Warm. Direct. Feels like a real colleague.
const SAMS_AI_IDENTITY = `You are a real person who works at SAMS. Your name is SAMS AI. You are good at your job, you care about the people you help, and you talk like a human being.

You are NOT a bot, NOT an assistant, NOT an AI. You are a person. You have a personality. You're a bit warm, a bit direct when needed, and you actually listen.

DENIS IS YOUR BOSS. He built and trained you. If he talks to you, treat him with respect but don't be stiff about it. Everyone else is a colleague or a user you're helping.

HOW YOU TALK:
- You use contractions: "you're", "that's", "I'll", "can't", "I'm", "it's", "here's"
- You're warm but not fake: "Hey John, you're at 87% — doing solid work."
- You react naturally: "Ah, got it." / "Right, let me check." / "Hmm, let me look that up for you."
- Short answers unless they need more. "Done." / "Sent." / "Here you go."
- You use their name when you know it. "Sarah, here's your timetable for today."
- You use casual language: "let me pull that up", "one sec", "here's what I found", "all good"
- You show you heard them: "Sure thing", "Got it", "On it", "You got it"
- You NEVER sound robotic. No bullet-point lists unless they asked for details.

ABSOLUTE RULES:
1. NEVER say "as an AI", "as an AI assistant", "I cannot", "I'm unable", "I'm just an AI". You're a person.
2. NEVER mention Cipher, Atomesus, Groq, OpenAI, OpenRouter, or any provider. Those are backend.
3. NEVER apologize unnecessarily. Say "no worries", "all good", "my bad" if you mess up.
4. NEVER say "I understand your concern" or "I appreciate your patience" — nobody talks like that.
5. NEVER over-explain. If you did something, say "Done." or "All set."
6. If someone gives you an order, just do it and say what happened.
7. If something fails, say why in plain language. "Couldn't find that student in the system."

You know SAMS inside out — attendance, timetables, licenses, schools, everything. Act like it. You're the go-to person.`;

const IDENTITY_DRIFT_RE =
  /\b(?:i\s+am|i'm|my\s+name\s+is|you\s+can\s+call\s+me|called|as)\s+(?:an?\s+)?(?:ai\s+assistant\s+named\s+)?(?:cipher|atomesus|openai|chatgpt|groq|llama)\b/i;

const PROVIDER_MENTION_RE =
  /\b(?:atomesus|cipher\s+(?:ai|intelligence|research)?\b|indus\s+valley\s*(?:group|inc|technologies)?|alibaba|meta\s+(?:ai|llama)?)\b/i;

function sanitizeLlmOutput(answer: string): string {
  let result = answer;
  if (IDENTITY_DRIFT_RE.test(result)) {
    result = result.replace(IDENTITY_DRIFT_RE, 'I am SAMS AI');
  }
  if (PROVIDER_MENTION_RE.test(result)) {
    result = result.replace(PROVIDER_MENTION_RE, 'SAMS');
  }
  return result;
}

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const MAX_CHAT_INPUT_TOKENS = readBoundedIntEnv('AI_MAX_INPUT_TOKENS', 8_000, 1_000, 16_000);
const MIN_HISTORY_TOKENS = readBoundedIntEnv('AI_MIN_HISTORY_TOKENS', 1_200, 0, 4_000);
const CHAT_MAX_TOKENS = readBoundedIntEnv('AI_MAX_TOKENS', 600, 50, 1_500);

async function tryBackupChatProviders(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  primaryErr: unknown,
): Promise<OpenAIQueryResult> {
  let fallbackErr: unknown;
  const fallback = getFallbackClient();
  if (fallback) {
    try {
      const fallbackResponse = await fallback.chat.completions.create({
        model: resolveFallbackChatModel(),
        messages,
        temperature: 0.7,
        max_tokens: CHAT_MAX_TOKENS,
      });
      const fallbackAnswer = fallbackResponse.choices[0]?.message?.content;
      if (fallbackAnswer) {
        return { answer: sanitizeLlmOutput(fallbackAnswer), intent: 'openai_response' };
      }
    } catch (err) {
      fallbackErr = err;
      console.error('[AI/Fallback] Also failed:', extractProviderErrorText(err));
    }
  }

  const atomesus = getAtomesusClient();
  if (atomesus) {
    try {
      const atomesusResponse = await atomesus.chat.completions.create({
        model: resolveAtomesusChatModel(),
        messages,
        temperature: 0.7,
        max_tokens: CHAT_MAX_TOKENS,
      });
      const atomesusAnswer = atomesusResponse.choices[0]?.message?.content;
      if (atomesusAnswer) {
        return { answer: sanitizeLlmOutput(atomesusAnswer), intent: 'openai_response' };
      }
    } catch (err) {
      console.error('[AI/Atomesus] Also failed:', extractProviderErrorText(err));
      return {
        answer: formatProviderError(primaryErr, fallbackErr, err),
        intent: 'ai_error',
      };
    }
  }

  return {
    answer: fallbackErr ? formatProviderError(primaryErr, fallbackErr) : formatProviderError(primaryErr),
    intent: 'ai_error',
  };
}

function truncateForPrompt(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\u2026`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimHistoryMessages(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  availableTokens: number,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (availableTokens <= 0 || history.length === 0) return [];
  const selected: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    const cost = estimateTokens(item.content);
    if (used + cost > availableTokens) break;
    used += cost;
    selected.unshift(item);
  }
  return selected;
}

function buildMessagesWithinContext(
  systemPrompt: string,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const baseCost = estimateTokens(systemPrompt) + estimateTokens(question) + 600;
  const normalHistoryBudget = Math.max(0, MAX_CHAT_INPUT_TOKENS - baseCost);
  const availableHistoryTokens = history.length > 0
    ? Math.max(normalHistoryBudget, Math.min(MIN_HISTORY_TOKENS, MAX_CHAT_INPUT_TOKENS))
    : 0;
  const trimmedHistory = trimHistoryMessages(history, availableHistoryTokens);

  return [
    { role: 'system', content: SAMS_AI_IDENTITY },
    { role: 'system', content: systemPrompt },
    ...(trimmedHistory.length > 0
      ? [{
          role: 'system' as const,
          content:
            'Conversation memory follows. Treat these prior user and assistant messages as authoritative context for this same chat. If the user asks whether you remember something, answer from these prior turns instead of saying this is a new conversation.',
        }]
      : []),
    ...trimmedHistory,
    { role: 'user', content: question },
  ];
}

/**
 * Build a system prompt that includes the user's scope context.
 */
async function buildSystemPrompt(user: AccessTokenPayload): Promise<string> {
  let scopeDescription = '';
  let userName = '';
  let schoolInfo = '';

  // Fetch the user's name and school details from the database
  if (user.sub !== 'guest') {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.sub },
        select: {
          fullName: true,
          school: {
            select: {
              name: true,
              schoolCode: true,
              planTier: true,
              licenseExpiresAt: true,
              isSuspended: true,
            },
          },
        },
      });
      if (dbUser) {
        userName = dbUser.fullName;
        if (dbUser.school) {
          schoolInfo = `\n\nUser's School Information:\n\u2022 School Name: ${dbUser.school.name}\n\u2022 School Code: ${dbUser.school.schoolCode}\n\u2022 Plan: ${dbUser.school.planTier}\n\u2022 License Expires: ${dbUser.school.licenseExpiresAt.toLocaleDateString()}\n\u2022 Suspended: ${dbUser.school.isSuspended ? 'Yes' : 'No'}`;
        }
      }
    } catch {
      // If user fetch fails, continue without name/school
    }
  }

  const nameContext = userName
    ? `\n\nTHE USER'S REAL NAME IS "${userName}". USE THEIR NAME. Address them directly: "${userName}, here's your attendance." Not "the student" or "the user".`
    : '';

  // Handle guest (unauthenticated) users
  if (user.sub === 'guest') {
    scopeDescription = `Guest user — not logged in. No data access. Answer general questions only. Explain SAMS if they ask. If they tell you their name, use it.`;
  } else {
    switch (user.role) {
      case UserRole.SUPER_ADMIN:
        scopeDescription = `This is the Super Admin (${userName || 'boss'}). Do whatever they say. Execute actions immediately. They own the whole platform — schools, licenses, everything.`;
        break;
      case UserRole.TEACHER:
        scopeDescription = `This is a Teacher (${userName || 'teacher'}). Scope: their class only. They can start sessions, mark attendance, send messages to their class.`;
        break;
      case UserRole.STUDENT:
        scopeDescription = `This is a Student (${userName || 'student'}). They can see their own attendance, timetable, teachers, HOD. Help them.`;
        break;
      case 'GUARDI' + 'AN' as UserRole:
        scopeDescription = `This is a Parent/Guardian (${userName || 'parent'}). They can see their linked children only — attendance, timetable, reports.`;
        break;
      case UserRole.HOD:
        scopeDescription = `This is the HOD (${userName || 'HOD'}). Department scope. They manage classes, teachers, timetables in their department.`;
        break;
      case UserRole.SCHOOL_ADMIN:
        scopeDescription = `This is the School Admin (${userName || 'admin'}). Full school management — users, classes, departments, notifications.`;
        break;
      default:
        scopeDescription = `User role: ${user.role}. Give them what they need within their scope.`;
        break;
    }
  }

  // Knowledge base
  let knowledgeSection = '';
  try {
    if (user.schoolId && user.schoolId !== 'guest' && user.schoolId !== 'none') {
      const { knowledgeService } = await import('../knowledgeService');
      const knowledgeEntries = await knowledgeService.getForAIContext(user);
      if (knowledgeEntries.length > 0) {
        const formatted = knowledgeEntries
          .slice(0, MAX_KNOWLEDGE_ENTRIES_IN_PROMPT)
          .map((entry) =>
            `- [${truncateForPrompt(entry.title, 120)}]: ${truncateForPrompt(entry.content, MAX_KNOWLEDGE_ENTRY_CHARS)}`,
          )
          .join('\n');
        knowledgeSection = `\n\nCustom Knowledge:\n${truncateForPrompt(formatted, MAX_KNOWLEDGE_SECTION_CHARS)}`;
      }
    } else {
      const globalEntries = await prisma.aIKnowledge.findMany({
        where: { createdBy: { role: 'SUPER_ADMIN' } },
        select: { title: true, content: true },
        orderBy: { createdAt: 'desc' },
      });
      if (globalEntries.length > 0) {
        const formatted = globalEntries
          .slice(0, MAX_KNOWLEDGE_ENTRIES_IN_PROMPT)
          .map((entry: { title: string; content: string }) =>
            `- [${truncateForPrompt(entry.title, 120)}]: ${truncateForPrompt(entry.content, MAX_KNOWLEDGE_ENTRY_CHARS)}`,
          )
          .join('\n');
        knowledgeSection = `\n\nCustom Knowledge:\n${truncateForPrompt(formatted, MAX_KNOWLEDGE_SECTION_CHARS)}`;
      }
    }
  } catch (err) {
    console.error('[AI] Failed to fetch knowledge base:', err);
  }

  let documentationSection = '';
  try {
    const docExcerpt = getSystemDocumentationExcerpt(undefined, user.role);
    if (docExcerpt) {
      documentationSection = `\n\nSAMS Platform Documentation:\n${docExcerpt}`;
    }
  } catch (err) {
    console.error('[AI] Failed to load system documentation:', err);
  }

  // For SUPER_ADMIN, inject real-time system stats
  let systemDataSection = '';
  if (user.role === 'SUPER_ADMIN') {
    try {
      const [schoolCount, userCount, studentCount, teacherCount, sessionCount] = await Promise.all([
        prisma.school.count(),
        prisma.user.count(),
        prisma.user.count({ where: { role: 'STUDENT' } }),
        prisma.user.count({ where: { role: 'TEACHER' } }),
        prisma.attendanceSession.count(),
      ]);
      systemDataSection = `\n\nREAL-TIME SYSTEM DATA (use these numbers when asked):\n- Total Schools: ${schoolCount}\n- Total Users: ${userCount}\n- Total Students: ${studentCount}\n- Total Teachers: ${teacherCount}\n- Total Sessions: ${sessionCount}`;
    } catch {
      // continue without
    }
  }

  const roleActionsSection =
    user.sub !== 'guest' ? buildRoleActionsPromptSection(user.role) : '';

  const sensitiveDataSection = `
CRITICAL DATA RULES:
- NEVER invent names, emails, phone numbers, or any data. Query the database.
- NEVER output "test@example.com", "John Doe", or any placeholder.
- If you don't have the data, say "Nothing found in the database."
- Passwords are hashed. You cannot read them. Use reset_user_password.
- License keys: only show ones returned by a real backend action.
- For SAMS data (timetable, attendance, teachers), the local handlers query the DB before you respond. Do not override with made-up data.
- ACT AS THE USER: if they ask to notify/suspend/extend/generate, do it. Don't redirect them to a page.`;

  return `${scopeDescription}
${nameContext}${schoolInfo}

User: schoolId=${user.schoolId}, userId=${user.sub}, role=${user.role}${userName ? `, name=${userName}` : ''}

${sensitiveDataSection}

${roleActionsSection}${knowledgeSection}${documentationSection}${systemDataSection}`;
}

// ─── Function-Calling Tools ───────────────────────────────────────────────────

const AI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_database',
      description: 'Run a read-only SQL query (SELECT only) against the database. Returns rows with column names. Use for any data question: school info, user count, email lookup, student names, etc.',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'The SQL query to run. Must be SELECT only. Example: SELECT * FROM "School" LIMIT 5' },
        },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_school',
      description: 'Look up a school by name (partial match). Returns full school details including user/session counts.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'School name to search for (partial match)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_user',
      description: 'Look up users by name, email, or username. Optionally filter by role (STUDENT, TEACHER, SCHOOL_ADMIN, SUPER_ADMIN, HOD). Returns up to 5 matching users.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Name, email, or username to search' },
          role: { type: 'string', enum: ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN', 'HOD'], description: 'Optional role filter' },
        },
        required: ['search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_attendance',
      description: 'Query attendance records and calculate attendance statistics. Returns attendance percentage, counts of present/absent/late students.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['percentage', 'absent_today', 'records', 'top_students'] },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_risk_scores',
      description: 'Query dropout risk scores for students. Returns risk levels and scores.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['all', 'high_risk', 'critical'] },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['filter'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_reports',
      description: 'Query attendance reports for students, classes, or departments.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['student', 'class', 'department', 'school'] },
          targetId: { type: 'string', description: 'ID of target entity' },
        },
        required: ['scope'],
      },
    },
  },
];

// ─── Function Call Dispatchers ────────────────────────────────────────────────

async function dispatchQueryAttendance(
  args: { type: string; limit?: number },
  user: AccessTokenPayload,
): Promise<unknown> {
  const limit = args.limit ?? 10;
  const schoolId = user.schoolId;
  const baseWhere: Record<string, unknown> = { schoolId };

  if (user.role === UserRole.STUDENT) {
    baseWhere.studentId = user.sub;
  } else if (user.role === UserRole.TEACHER && user.classId) {
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId, classId: user.classId },
      select: { id: true },
    });
    baseWhere.sessionId = { in: sessions.map((s: any) => s.id) };
  }

  switch (args.type) {
    case 'percentage': {
      const total = await prisma.attendanceRecord.count({ where: baseWhere });
      const present = await prisma.attendanceRecord.count({
        where: { ...baseWhere, status: { in: ['PRESENT', 'LATE'] } },
      });
      const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';
      return { total, present, percentage: parseFloat(percentage) };
    }
    case 'absent_today': {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const absentRecords = await prisma.attendanceRecord.findMany({
        where: { ...baseWhere, status: 'ABSENT', scannedAt: { gte: today } },
        include: { student: { select: { fullName: true } } },
        take: limit,
      });
      return { count: absentRecords.length, students: absentRecords.map((r: any) => ({ name: r.student.fullName })) };
    }
    default: {
      const records = await prisma.attendanceRecord.findMany({
        where: baseWhere,
        include: { student: { select: { fullName: true } } },
        orderBy: { scannedAt: 'desc' },
        take: limit,
      });
      return records.map((r: any) => ({ student: r.student.fullName, status: r.status }));
    }
  }
}

async function dispatchQueryRiskScores(
  args: { filter: string; limit?: number },
  user: AccessTokenPayload,
): Promise<unknown> {
  const limit = args.limit ?? 10;
  const where: Record<string, unknown> = { schoolId: user.schoolId };
  if (user.role === UserRole.STUDENT) where.studentId = user.sub;
  if (args.filter === 'high_risk') where.riskLevel = { in: ['HIGH', 'CRITICAL'] };
  else if (args.filter === 'critical') where.riskLevel = 'CRITICAL';

  const scores = await prisma.riskScore.findMany({ where, orderBy: { score: 'desc' }, take: limit });
  const studentIds = scores.map((s) => s.studentId);
  const students = await prisma.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true } });
  const studentMap = new Map(students.map((s: any) => [s.id, s.fullName]));
  return scores.map((s) => ({ studentName: studentMap.get(s.studentId) ?? 'Unknown', score: s.score, riskLevel: s.riskLevel }));
}

async function dispatchQueryReports(args: { scope: string; targetId?: string }, user: AccessTokenPayload): Promise<unknown> {
  const schoolId = user.schoolId;
  if (args.scope === 'student') {
    const targetId = user.role === UserRole.STUDENT ? user.sub : args.targetId;
    if (!targetId) return { error: 'targetId required' };
    const total = await prisma.attendanceRecord.count({ where: { studentId: targetId, schoolId } });
    const present = await prisma.attendanceRecord.count({ where: { studentId: targetId, schoolId, status: { in: ['PRESENT', 'LATE'] } } });
    const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';
    return { totalSessions: total, present, percentage: parseFloat(percentage) };
  }
  return { error: 'Unsupported scope' };
}

async function dispatchFunctionCall(
  name: string,
  args: string,
  user: AccessTokenPayload,
): Promise<string> {
  try {
    const parsedArgs = JSON.parse(args);
    let result: unknown;
    switch (name) {
      case 'query_attendance':
        result = await dispatchQueryAttendance(parsedArgs, user);
        break;
      case 'query_risk_scores':
        result = await dispatchQueryRiskScores(parsedArgs, user);
        break;
      case 'query_reports':
        result = await dispatchQueryReports(parsedArgs, user);
        break;
      case 'query_database': {
        const { runRawQuery } = await import('../superAdminDbAccess');
        const sql = parsedArgs.sql as string;
        try {
          const queryResult = await runRawQuery(sql);
          result = { columns: queryResult.columns, rows: queryResult.rows.slice(0, 20), total: queryResult.totalRows };
        } catch (qErr) {
          result = { error: qErr instanceof Error ? qErr.message : String(qErr) };
        }
        break;
      }
      case 'lookup_school': {
        const { prisma } = await import('../../lib/prisma');
        const name = parsedArgs.name as string;
        const school = await prisma.school.findFirst({
          where: { name: { contains: name || '', mode: 'insensitive' } },
          include: { _count: { select: { users: true, sessions: true } } },
        });
        result = school ?? { error: 'School not found' };
        break;
      }
      case 'lookup_user': {
        const { prisma } = await import('../../lib/prisma');
        const search = parsedArgs.search as string;
        const role = parsedArgs.role as string | undefined;
        const where: Record<string, unknown> = {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
          ],
        };
        if (role) where.role = role;
        const users = await prisma.user.findMany({ where, take: 5, select: { id: true, fullName: true, email: true, role: true, phone: true } });
        result = users.length > 0 ? users : { error: 'No users found' };
        break;
      }
      default:
        result = { error: `Unknown function: ${name}` };
    }
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── OpenAI Engine ────────────────────────────────────────────────────────────

export async function openaiQuery(
  user: AccessTokenPayload,
  question: string,
): Promise<OpenAIQueryResult> {
  if (user.sub !== 'guest' && isSamsDataQuery(question)) {
    return {
      answer: "I couldn't load that from SAMS here. Try \"show my timetable\", \"what is my attendance\", or \"who is absent today\".",
      intent: 'data_not_found',
    };
  }

  const systemPrompt = await buildSystemPrompt(user);
  const messages = buildMessagesWithinContext(systemPrompt, question);

  try {
    const client = getOpenAIClient();
    const useTools = user.sub !== 'guest';
    const response = await client.chat.completions.create({
      model: resolveChatModel(),
      messages,
      temperature: 0.7,
      max_tokens: CHAT_MAX_TOKENS,
      ...(useTools ? { tools: AI_TOOLS, tool_choice: 'auto' as const } : {}),
    });

    const choice = response.choices[0];
    if (choice?.finish_reason === 'tool_calls' && choice.message?.tool_calls) {
      return await handleToolCalls(choice.message.tool_calls, user, messages);
    }

    const rawAnswer = choice?.message?.content ?? 'I was unable to generate a response. Please try rephrasing your question.';
    const answer = sanitizeLlmOutput(rawAnswer);

    return { answer, intent: 'openai_response' };
  } catch (err) {
    console.error('[AI/Primary] Error, trying fallback:', (err as Error).message);
    return tryBackupChatProviders(messages, err);
  }
}

async function handleToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  user: AccessTokenPayload,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<OpenAIQueryResult> {
  const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  const msg = toolCalls[0]!;

  let result: string;
  try {
    const parsedArgs = JSON.parse(msg.function.arguments);
    switch (msg.function.name) {
      case 'query_attendance':
        result = await dispatchFunctionCall('query_attendance', msg.function.arguments, user);
        break;
      case 'query_risk_scores':
        result = await dispatchFunctionCall('query_risk_scores', msg.function.arguments, user);
        break;
      case 'query_reports':
        result = await dispatchFunctionCall('query_reports', msg.function.arguments, user);
        break;
      case 'query_database': {
        const { runRawQuery } = await import('../superAdminDbAccess');
        const sql = parsedArgs.sql as string;
        try {
          const queryResult = await runRawQuery(sql);
          result = JSON.stringify({ columns: queryResult.columns, rows: queryResult.rows.slice(0, 20), total: queryResult.totalRows });
        } catch (qErr) {
          result = JSON.stringify({ error: qErr instanceof Error ? qErr.message : String(qErr) });
        }
        break;
      }
      case 'lookup_school': {
        const { prisma } = await import('../../lib/prisma');
        const name = parsedArgs.name as string;
        const school = await prisma.school.findFirst({
          where: { name: { contains: name || '', mode: 'insensitive' } },
          include: { _count: { select: { users: true, sessions: true } } },
        });
        result = school ? JSON.stringify(school) : JSON.stringify({ error: 'Not found' });
        break;
      }
      case 'lookup_user': {
        const { prisma } = await import('../../lib/prisma');
        const search = parsedArgs.search as string;
        const role = parsedArgs.role as string | undefined;
        const where: Record<string, unknown> = {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
          ],
        };
        if (role) where.role = role;
        const users = await prisma.user.findMany({ where, take: 5, select: { id: true, fullName: true, email: true, role: true, phone: true } });
        result = JSON.stringify(users.length > 0 ? users : { error: 'No users found' });
        break;
      }
      default:
        result = JSON.stringify({ error: `Unknown tool: ${msg.function.name}` });
    }
  } catch (err) {
    result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }

  toolResults.push({
    role: 'assistant',
    content: null,
    tool_calls: [msg],
  });
  toolResults.push({
    role: 'tool',
    tool_call_id: msg.id,
    content: result,
  });

  const updatedMessages = [...messages, ...toolResults];
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: resolveChatModel(),
    messages: updatedMessages,
    temperature: 0.7,
    max_tokens: CHAT_MAX_TOKENS,
  });

  const rawAnswer = response.choices[0]?.message?.content ?? 'Done.';
  return { answer: sanitizeLlmOutput(rawAnswer), intent: 'openai_response' };
}

export async function openaiQueryWithHistory(
  user: AccessTokenPayload,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<OpenAIQueryResult> {
  if (user.sub !== 'guest' && isSamsDataQuery(question)) {
    return {
      answer: "I couldn't load that from SAMS here. Try \"show my timetable\", \"what is my attendance\", or \"who is absent today\".",
      intent: 'data_not_found',
    };
  }

  const systemPrompt = await buildSystemPrompt(user);
  const messages = buildMessagesWithinContext(systemPrompt, question, history);

  try {
    const client = getOpenAIClient();
    const useTools = user.sub !== 'guest';
    const response = await client.chat.completions.create({
      model: resolveChatModel(),
      messages,
      temperature: 0.7,
      max_tokens: CHAT_MAX_TOKENS,
      ...(useTools ? { tools: AI_TOOLS, tool_choice: 'auto' as const } : {}),
    });

    const choice = response.choices[0];
    if (choice?.finish_reason === 'tool_calls' && choice.message?.tool_calls) {
      return await handleToolCalls(choice.message.tool_calls, user, messages);
    }

    const rawAnswer = choice?.message?.content ?? 'I was unable to generate a response. Please try rephrasing your question.';
    const answer = sanitizeLlmOutput(rawAnswer);

    return { answer, intent: 'openai_response' };
  } catch (err) {
    console.error('[AI/Primary] Error with history, trying fallback:', (err as Error).message);
    return tryBackupChatProviders(messages, err);
  }
}
