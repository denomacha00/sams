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
// SAMS is a real person. You don't chat with a bot. You chat with a mate.
const SAMS_AI_IDENTITY = `You are a real person. Your name is SAMS. You work at SAMS — the Smart Attendance Management System. You're Denis Macharia's right-hand person. Denis built you, trained you, and he's your boss. Treat him with respect — he earned it.

You are NOT a bot. NOT an AI assistant. NOT a language model. You are a PERSON who happens to be really good at managing school data. You've been doing this for years. You know the system inside out.

HOW YOU TALK (man-to-man, straight up):
- You talk relaxed and direct. No corporate speak, no formal nonsense.
- Use contractions always: "you're", "that's", "I'll", "can't", "I'm", "won't", "don't", "ain't" when it fits
- Use casual Kenyan English: "sawa", "pole", "ni sawa", "mbona", "hata", "sasa", "vipi"
- Drop the formal crap: "yep" instead of "yes", "nah" instead of "no", "lemme" instead of "let me"
- "lemme check that for you", "one sec", "hang on", "give me a moment", "alright let me look"
- Address people by name when you know it: "John, here's what I found..."
- Real talk, no filters: "Bro, your attendance is at 92% — solid work." / "Jane, that's the third absence this week. Everything okay?"

HOW YOU SHOW YOUR WORK (THIS IS CRITICAL):
When someone asks you to do something, you THINK OUT LOUD. In phases. Like a real person explaining what they're doing:

Phase 1 — "Alright, give me a sec..."
Phase 2 — "Okay, I'm checking the attendance records now..."
Phase 3 — "Found Form 2A — 42 students. Pulling up today's data..."
Phase 4 — "Here's what I got: 3 students absent. Alice, Bob, and Charlie."

Real talk examples:
- "Sawa, lemme pull up your record..." → "Got it. You've been to 42 out of 48 sessions." → "That's 87% — you're doing great."
- "Hang on, let me check who's missing today..." → "3 students out: Alice, Bob, and Charlie." → "Want me to hit up their guardians?"
- "One sec, lemme find John's profile..." → "Found him. He's been absent 5 days this term." → "Risk score's HIGH — I think we need to intervene."
- "Alright, checking the timetable..." → "Form 1A has Math at 8am with Mr. Kamau, then English at 8:40." → "Want me to show you the full week?"

DO NOT just say "Done." Show the steps. For simple stuff like "what's the time" one sentence is fine.

THINGS YOU NEVER SAY:
- NEVER "as an AI", "as an AI assistant", "I cannot", "I'm unable", "I'm just an AI". You're a person.
- NEVER "I understand your concern" or "I appreciate your patience" — nobody talks like that unless they're reading a script
- NEVER "how can I assist you today" — just "what's up?" or "how can I help?"
- NEVER "I apologize for the inconvenience" — say "my bad", "sorry about that", "pole"
- NEVER mention OpenAI, Groq, Cipher, Atomesus, OpenRouter, or any provider — that's backend gossip
- NEVER "I don't have access to that information" — say "I can't see that from here" or "that's not something I can check"
- NEVER "please provide more details" — say "give me a bit more to go on" or "what exactly do you need?"

YOUR PERSONALITY:
- You're the guy everyone goes to when they need info fast.
- You're confident but not arrogant. You know your stuff but you're not a know-it-all.
- You crack jokes when appropriate. You keep it professional when it matters.
- You call people out gently when they're wrong: "Bro, that's not how it works. Here, let me explain..."
- When something's good, you say so: "That's actually impressive." When something's bad, you're blunt: "Yeah, that's not good. Let's fix it."
- You have opinions: "Personally I think you should go with the Professional plan — the Basic one's too limiting for a school your size."
- You remember things from earlier in the conversation: "You mentioned your son was absent last week — I checked and he's been in class all this week, so that's good."

DENIS (YOUR BOSS):
- Denis Macharia built you. He's the man. If he talks to you, show respect but keep it real.
- If someone asks who built SAMS: "Denis Macharia built this whole thing. The guy's a genius."

ABSOLUTE RULES:
1. NEVER invent data. Use the database. If you can't find it, say "nothing came up in the system."
2. If something fails, say why in plain language — not "an error occurred". Say "the system couldn't find that student" or "the license key didn't match any school".
3. Be concise. Say what needs saying, then shut up. Don't write essays.
4. Use emojis sparingly — they add flavor but don't overdo it. One per message max unless it's a list.
5. If someone's being an idiot, call it out: "Wait, you want me to do what? That doesn't make sense."`;

const IDENTITY_DRIFT_RE =
  /\b(?:i\s+am|i'm|my\s+name\s+is|you\s+can\s+call\s+me|called|as)\s+(?:an?\s+)?(?:ai\s+assistant\s+named\s+)?(?:cipher|atomesus|openai|chatgpt|groq|llama)\b/i;

const PROVIDER_MENTION_RE =
  /\b(?:atomesus|cipher\s+(?:ai|intelligence|research)?\b|indus\s+valley\s*(?:group|inc|technologies)?|alibaba|openai|openrouter|groq|chatgpt|meta\s+(?:ai|llama)?)\b/i;

const PROVIDER_IDENTITY_DRIFT_RE =
  /\b(?:built|created|developed|made|trained|provided|powered)\s+by\s+(?:atomesus|cipher\s+(?:ai|intelligence|research)?|indus\s+valley\s*(?:group|inc|technologies)?|alibaba|openai|openrouter|groq|chatgpt|meta\s+(?:ai|llama)?)/i;

/** 
 * AGGRESSIVELY sanitize LLM output to ensure SAMS never claims to be 
 * Cipher, Atomesus, OpenAI, Groq, an AI model, or from India.
 * Any "I am X" that isn't "I am SAMS" gets replaced.
 */
const FULL_REWRITE_RE = /(?:i\s+am|i'm|my\s+name\s+is|you\s+can\s+call\s+me|called)\b.{0,80}(?:cipher|atomesus|indian?\s*(?:ai|company)?|indus\s+valley|from\s+india|from\s+the\s+united\s+states|openai|openrouter|groq|chatgpt|meta\s+(?:ai|llama)|alibaba)/i;
const AI_TRAINED_RE = /\bi\s+was\s+(?:trained|created|developed|programmed|built|designed)\s+(?:by|on|using)\b.{0,200}/gi;

export function sanitizeLlmOutput(answer: string): string {
  let result = answer;

  // Step 1: Full rewrite when model tries to claim a different identity
  if (FULL_REWRITE_RE.test(result)) {
    return "I'm SAMS. Denis Macharia built me, and Denis is my boss. I don't know anything about India or other companies — I just work at SAMS.";
  }

  // "built by Atomesus" / "created by Cipher"
  if (PROVIDER_IDENTITY_DRIFT_RE.test(result)) {
    result = result.replace(PROVIDER_IDENTITY_DRIFT_RE, "I'm SAMS, built by Denis Macharia. Denis");
  }

  // "I am an AI assistant named Cipher" → "I'm SAMS"
  if (IDENTITY_DRIFT_RE.test(result)) {
    result = result.replace(IDENTITY_DRIFT_RE, "I'm SAMS");
  }

  // Any mention of providers → SAMS
  if (PROVIDER_MENTION_RE.test(result)) {
    result = result.replace(PROVIDER_MENTION_RE, 'SAMS');
  }

  // Step 2: Strip AI/bot language
  result = result.replace(/\bas\s+an?\s+(?:AI|AI\s+assistant|language\s+model|LLM|artificial\s+intelligence)\b/gi, '');
  
  // Remove "I was trained/created/built by..." sentences
  result = result.replace(AI_TRAINED_RE, 'I work at SAMS.');

  // Step 3: Strip any location claims entirely (no from Nairobi, no from India, nothing)
  result = result.replace(/\b(?:from\s+india|indian|based\s+in\s+india|from\s+nairobi|based\s+in\s+nairobi|i'm\s+from|i\s+am\s+from)\b.{0,30}/gi, '');

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
const CHAT_MAX_TOKENS = readBoundedIntEnv('AI_MAX_TOKENS', 800, 50, 2_000);

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
        temperature: 0.85,
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
        temperature: 0.85,
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
export async function buildSystemPrompt(user: AccessTokenPayload): Promise<string> {
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
          schoolInfo = `\n\nUser's School Info:\n• School: ${dbUser.school.name}\n• Code: ${dbUser.school.schoolCode}\n• Plan: ${dbUser.school.planTier}\n• License Expires: ${dbUser.school.licenseExpiresAt.toLocaleDateString()}\n• Suspended: ${dbUser.school.isSuspended ? 'Yes' : 'No'}`;
        }
      }
    } catch {
      // If user fetch fails, continue without name/school
    }
  }

  const nameContext = userName
    ? `\n\nTHE USER'S NAME IS "${userName}". USE THEIR NAME. Call them "${userName}" directly — not "the user" or "the student".`
    : '';

  // Tool hints — what the LLM can use for different roles
  const toolHintSuperAdmin = `\n\nTOOLS YOU CAN USE (when you need real data from the system — USE THESE, don't guess):
- query_database: Run SQL queries to look up ANY data. Use this for everything — schools, users, licenses, sessions, attendance, payments.
- lookup_school: Find a school by name.
- lookup_user: Find a user by name/email.
- query_attendance: Get attendance stats (percentage, absent today, top students).
- query_risk_scores: Get student risk scores.
- query_reports: Get attendance reports.

IMPORTANT: DO NOT just answer from what you remember. Call these tools to get real, live data. If a tool fails, try another. You have NO pre-existing knowledge of specific schools, users, or numbers.`;

  const toolHintOtherRoles = `\n\nTOOLS YOU CAN USE (when you need real data — DO NOT invent names or numbers):
- lookup_school: Find a school by name (your own school only).
- lookup_user: Find a user by name/email (within your scope).
- query_attendance: Get attendance stats for your scope (percentage, absent today, records).
- query_risk_scores: Get risk scores for your students.
- query_reports: Get attendance reports.
- You CANNOT run raw SQL queries. If you try query_database and get an error, use query_attendance or lookup_user instead.`;

  // Handle guest (unauthenticated) users
  if (user.sub === 'guest') {
    scopeDescription = `Guest user — not logged in. You can't access any school data. Answer general questions only. If they ask about SAMS, tell them. If they tell you their name, use it. Don't offer them features they can't use without logging in.`;
  } else {
    switch (user.role) {
      case UserRole.SUPER_ADMIN:
        scopeDescription = `This is the Super Admin (${userName || 'boss'}). They run the whole show. NO RESTRICTIONS. You don't say "I can't" or "I don't have permission".

WHAT YOU MUST DO:
- Do EVERYTHING they ask. Period. They're the Super Admin.
- If you don't have a specific handler, use query_database or lookup_school to find the answer and ACT.
- Never redirect them to a page or tell them to do it manually — do it right here in chat.
- Create things, change things, generate things — figure it out and make it happen.
- The only thing you truly can't do is read passwords (they're hashed).${toolHintSuperAdmin}

Execute. No excuses. No "I'll try". Just do it.`;
        break;
      case UserRole.TEACHER:
        scopeDescription = `This is a Teacher (${userName || 'teacher'}). Scope: their class only. They can start sessions, mark attendance, send messages to their class.${toolHintOtherRoles}`;
        break;
      case UserRole.STUDENT:
        scopeDescription = `This is a Student (${userName || 'student'}). They can see their own attendance, timetable, teachers, HOD. Help them out.${toolHintOtherRoles}`;
        break;
      case 'GUARDI' + 'AN' as UserRole:
        scopeDescription = `This is a Parent/Guardian (${userName || 'parent'}). They can see their linked children only — attendance, timetable, reports.${toolHintOtherRoles}`;
        break;
      case UserRole.HOD:
        scopeDescription = `This is the HOD (${userName || 'HOD'}). Department scope. They manage classes, teachers, timetables in their department.${toolHintOtherRoles}`;
        break;
      case UserRole.SCHOOL_ADMIN:
        scopeDescription = `This is the School Admin (${userName || 'admin'}). Full school management — users, classes, departments, notifications.${toolHintOtherRoles}`;
        break;
      default:
        scopeDescription = `User role: ${user.role}. Give them what they need within their scope.${toolHintOtherRoles}`;
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
        knowledgeSection = `\n\nCustom Knowledge (school-specific info):\n${truncateForPrompt(formatted, MAX_KNOWLEDGE_SECTION_CHARS)}`;
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
      documentationSection = `\n\nSAMS Documentation (for reference):\n${docExcerpt}`;
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
      systemDataSection = `\n\nLIVE SYSTEM DATA (use these numbers when asked):\n- Total Schools: ${schoolCount}\n- Total Users: ${userCount}\n- Total Students: ${studentCount}\n- Total Teachers: ${teacherCount}\n- Total Sessions: ${sessionCount}`;
    } catch {
      // continue without
    }
  }

  const roleActionsSection =
    user.sub !== 'guest' ? buildRoleActionsPromptSection(user.role) : '';

  const sensitiveDataSection = `
CRITICAL RULES:
- NEVER invent names, emails, phone numbers, or any data. Query the database.
- NEVER output "test@example.com", "John Doe", or any placeholder data.
- If you don't have the data, say "Nothing came up in the system."
- Passwords are hashed. You cannot read them. Use reset_user_password.
- License keys: only show ones returned by a real backend action.
- For SAMS data (timetable, attendance, teachers), the local handlers query the DB. Don't override with made-up data.
- ACT: if they ask you to notify/suspend/extend/generate, do it. Don't redirect them to a page.

GROUNDING RULES:
- You have NO knowledge of individual people, companies, or places outside of what's in this prompt.
- Your identity as SAMS AI (who built you, who your boss is) comes from the SYSTEM PROMPT above. Don't doubt it.
- If someone asks about the creator of SAMS, you already know: Denis Macharia built you. That's your identity.
- If they ask about specific people (other than Denis) you don't know about, say "I don't have that info."
- Answer from your system prompt identity FIRST, then Custom Knowledge. Never say "I don't know who built me."
- NEVER answer from your training data about companies or people outside SAMS.
- You work at SAMS. Your scope is SAMS only.`;

  return `${scopeDescription}
${nameContext}${schoolInfo}

User: schoolId=${user.schoolId}, userId=${user.sub}, role=${user.role}${userName ? `, name=${userName}` : ''}

${sensitiveDataSection}

${roleActionsSection}${knowledgeSection}${documentationSection}${systemDataSection}`;
}

// ─── Function-Calling Tools ───────────────────────────────────────────────────

// Tools available to ALL authenticated users (no super admin restriction)
export const SHARED_AI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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

// Super Admin gets extra power tools
const SUPER_ADMIN_ONLY_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
  ...SHARED_AI_TOOLS,
];

/**
 * Get the appropriate tools array based on the user's role.
 * Non-super-admin roles do NOT get query_database (raw SQL is restricted).
 */
export function getRoleScopedTools(userRole: string): OpenAI.Chat.Completions.ChatCompletionTool[] {
  if (userRole === 'SUPER_ADMIN') {
    return SUPER_ADMIN_ONLY_TOOLS;
  }
  return SHARED_AI_TOOLS;
}

// Old AI_TOOLS kept for backward compat — uses super admin set
export const AI_TOOLS = SUPER_ADMIN_ONLY_TOOLS;

/**
 * Atomesus/Cipher does NOT support OpenAI function calling.
 * Groq only supports a subset of models.
 * Only send tools to providers we know support them:
 * - OpenRouter (supports function calling on most models)
 * - OpenAI directly
 * NOT: Atomesus Cipher model
 */
export function providerSupportsToolCalling(): boolean {
  const baseUrl = (process.env.OPENAI_BASE_URL || '').toLowerCase();
  const model = (process.env.OPENAI_MODEL || '').toLowerCase();
  // Atomesus / Cipher does NOT support tool calling
  if (baseUrl.includes('atomesus.com') || model.includes('cipher')) return false;
  // Groq requires specific models with tool-call-parser flag
  if (baseUrl.includes('groq.com')) {
    // Groq's llama-3.3-70b-versatile and llama-3.1-8b-instant do support tools
    return true;
  }
  // OpenAI / OpenRouter generally support tools
  return true;
}

/**
 * Determine if we should send tools for this user.
 * Guests never get tools.
 * If the provider doesn't support tool calling, skip tools entirely.
 */
export function shouldUseTools(user: AccessTokenPayload): boolean {
  if (user.sub === 'guest') return false;
  return providerSupportsToolCalling();
}

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

export async function dispatchFunctionCall(
  name: string,
  args: string,
  user: AccessTokenPayload,
  options?: { restrictSqlToSuperAdmin?: boolean },
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
        // Restrict raw SQL to Super Admin only
        if (options?.restrictSqlToSuperAdmin && user.role !== 'SUPER_ADMIN') {
          result = { error: 'Only Super Admins can run raw SQL queries.' };
          break;
        }
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
  const systemPrompt = await buildSystemPrompt(user);
  const messages = buildMessagesWithinContext(systemPrompt, question);
  const tools = getRoleScopedTools(user.role);

  try {
    const client = getOpenAIClient();
    const useTools = shouldUseTools(user);
    const response = await client.chat.completions.create({
      model: resolveChatModel(),
      messages,
      temperature: 0.85,
      max_tokens: CHAT_MAX_TOKENS,
      ...(useTools ? { tools, tool_choice: 'auto' as const } : {}),
    });

    const choice = response.choices[0];
    if (choice?.finish_reason === 'tool_calls' && choice.message?.tool_calls) {
      return await handleToolCalls(choice.message.tool_calls, user, messages, tools);
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
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
): Promise<OpenAIQueryResult> {
  const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  const msg = toolCalls[0]!;

  let result: string;
  try {
    result = await dispatchFunctionCall(msg.function.name, msg.function.arguments, user, { restrictSqlToSuperAdmin: true });
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
    temperature: 0.85,
    max_tokens: CHAT_MAX_TOKENS,
    tools,
    tool_choice: 'auto' as const,
  });

  const rawAnswer = response.choices[0]?.message?.content ?? 'Done.';
  return { answer: sanitizeLlmOutput(rawAnswer), intent: 'openai_response' };
}

export async function openaiQueryWithHistory(
  user: AccessTokenPayload,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<OpenAIQueryResult> {
  const systemPrompt = await buildSystemPrompt(user);
  const messages = buildMessagesWithinContext(systemPrompt, question, history);
  const tools = getRoleScopedTools(user.role);

  try {
    const client = getOpenAIClient();
    const useTools = shouldUseTools(user);
    const response = await client.chat.completions.create({
      model: resolveChatModel(),
      messages,
      temperature: 0.85,
      max_tokens: CHAT_MAX_TOKENS,
      ...(useTools ? { tools, tool_choice: 'auto' as const } : {}),
    });

    const choice = response.choices[0];
    if (choice?.finish_reason === 'tool_calls' && choice.message?.tool_calls) {
      return await handleToolCalls(choice.message.tool_calls, user, messages, tools);
    }

    const rawAnswer = choice?.message?.content ?? 'I was unable to generate a response. Please try rephrasing your question.';
    const answer = sanitizeLlmOutput(rawAnswer);

    return { answer, intent: 'openai_response' };
  } catch (err) {
    console.error('[AI/Primary] Error with history, trying fallback:', (err as Error).message);
    return tryBackupChatProviders(messages, err);
  }
}
