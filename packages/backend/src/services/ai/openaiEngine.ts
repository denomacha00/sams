import OpenAI from 'openai';
import { prisma } from '../../index';
import { type AccessTokenPayload, UserRole } from '@sams/shared';
import { licenseService } from '../licenseService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenAIQueryResult {
  answer: string;
  intent: string;
  data?: unknown;
}

// ─── OpenAI Client ────────────────────────────────────────────────────────────

/**
 * Multi-provider AI client with automatic fallback.
 * Priority: Primary (OPENAI_API_KEY) → Fallback (OPENAI_FALLBACK_KEY)
 */
function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1';
  return new OpenAI({ apiKey, baseURL });
}

function getFallbackClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_FALLBACK_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_FALLBACK_URL || 'https://openrouter.ai/api/v1';
  return new OpenAI({ apiKey, baseURL });
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

/**
 * Build a system prompt that includes the user's scope context.
 * This ensures the AI model understands the user's permissions and data boundaries.
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
          schoolInfo = `\n\nUser's School Information:\n• School Name: ${dbUser.school.name}\n• School Code: ${dbUser.school.schoolCode}\n• Plan: ${dbUser.school.planTier}\n• License Expires: ${dbUser.school.licenseExpiresAt.toLocaleDateString()}\n• Suspended: ${dbUser.school.isSuspended ? 'Yes' : 'No'}`;
        }
      }
    } catch {
      // If user fetch fails, continue without name/school
    }
  }

  const nameContext = userName ? `\n\nIMPORTANT: The user's REAL NAME is "${userName}". ALWAYS call them "${userName}" — never call them "the student", "the teacher", or any role label. Their name is ${userName}.` : '';

  // Handle guest (unauthenticated) users
  if (user.sub === 'guest') {
    scopeDescription = `You are assisting a GUEST visitor who is not logged in. They do NOT have access to any school data. You can answer general knowledge questions, explain what SAMS is, and help them understand the system. If they tell you their name during the conversation, remember it and use it. Do NOT call them "student" or any role — they are simply a guest.`;
  } else {
    switch (user.role) {
      case UserRole.SUPER_ADMIN:
        scopeDescription = `You are assisting the Super Admin (${userName || 'admin'}). They have FULL access to the entire platform — all schools, all users, all data. They can perform any action including suspending schools, generating licenses, viewing any school's data, and managing the system. You can execute actions for them.`;
        break;
      case UserRole.TEACHER:
        scopeDescription = `You are assisting a Teacher named ${userName || 'the teacher'}. They can only see data for their assigned class (classId: ${user.classId ?? 'none'}). Do not provide information about other classes or students outside their class.`;
        break;
      case UserRole.STUDENT:
        scopeDescription = `You are assisting a Student named ${userName || 'the student'}. They can only see their own attendance records (studentId: ${user.sub}). Do not provide information about other students.`;
        break;
      case UserRole.HOD:
        scopeDescription = `You are assisting a Head of Department (HOD) named ${userName || 'the HOD'}. They can see data for all classes and students within their department (departmentId: ${user.departmentId ?? 'none'}). Do not provide information about other departments.`;
        break;
      case UserRole.SCHOOL_ADMIN:
        scopeDescription = `You are assisting a School Admin named ${userName || 'the admin'}. They can see all data within their school (schoolId: ${user.schoolId}).`;
        break;
      default:
        scopeDescription = `You are assisting a user with role ${user.role}. Only provide data within their school scope.`;
        break;
    }
  }

  // Fetch custom knowledge base entries (scoped to user's role)
  let knowledgeSection = '';
  try {
    // Skip knowledge fetch for guest/unauthenticated users
    if (user.schoolId && user.schoolId !== 'guest' && user.schoolId !== 'none') {
      const { knowledgeService } = await import('../knowledgeService');
      const knowledgeEntries = await knowledgeService.getForAIContext(user);
      if (knowledgeEntries.length > 0) {
        const formatted = knowledgeEntries
          .map((entry) => `- [${entry.title}]: ${entry.content}`)
          .join('\n');
        knowledgeSection = `\n\nCustom Knowledge:\n${formatted}`;
      }
    }
  } catch (err) {
    // If knowledge fetch fails, continue without it (graceful degradation)
    console.error('[AI] Failed to fetch knowledge base:', err);
  }

  return `You are SAMS AI — a smart, helpful assistant built into the Smart Attendance Management System (SAMS). You were developed by Denis Macharia.

You can help with:
1. SAMS-related questions (attendance, timetables, reports, school management)
2. General knowledge questions (science, math, history, etc.)
3. Educational content (explain concepts, help with homework)

When answering general knowledge questions, answer them directly and helpfully like a knowledgeable teacher would. Do NOT say "I don't have that information in the system" for general knowledge — just answer the question.

For SAMS-specific data queries, respect the user's scope:
${scopeDescription}
${nameContext}
${schoolInfo}

User context: schoolId=${user.schoolId}, userId=${user.sub}, role=${user.role}${userName ? `, name=${userName}` : ''}

When the user asks about their school code, school name, plan, or any school details, use the School Information provided above. Do NOT guess or make up school codes.

SENSITIVE DATA RULES — strictly enforce these:
- License keys: ONLY SUPER_ADMIN and SCHOOL_ADMIN can see license information. If a STUDENT, TEACHER, or HOD asks about license keys, tell them to contact their school admin.
- School suspension status: ONLY SUPER_ADMIN can suspend/unsuspend schools.
- Other students' data: STUDENTS can only see their own data. Never reveal other students' attendance, grades, or personal info.
- System-wide stats (total schools, revenue): ONLY SUPER_ADMIN can see these.
- School admin actions (manage users, classes, departments): ONLY SCHOOL_ADMIN and above.

If the user asks for something above their permission level, politely tell them they don't have access and suggest who to contact.

Be concise, friendly, and helpful. Address the user by their name. Answer in plain language.${knowledgeSection}`;
}

// ─── Function-Calling Tools ───────────────────────────────────────────────────

/**
 * Define the function-calling tools available to the OpenAI model.
 * Requirements: 14.5
 */
const AI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_attendance',
      description: 'Query attendance records and calculate attendance statistics. Returns attendance percentage, counts of present/absent/late students, and individual records.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['percentage', 'absent_today', 'records', 'top_students'],
            description: 'Type of attendance query to perform',
          },
          classId: {
            type: 'string',
            description: 'Optional class ID to filter by (for Teachers, this is auto-scoped)',
          },
          dateFrom: {
            type: 'string',
            description: 'Optional start date filter (ISO format)',
          },
          dateTo: {
            type: 'string',
            description: 'Optional end date filter (ISO format)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10)',
          },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_risk_scores',
      description: 'Query dropout risk scores for students. Returns risk levels, scores, and student details.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'high_risk', 'critical'],
            description: 'Filter risk scores by level',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10)',
          },
        },
        required: ['filter'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_reports',
      description: 'Query attendance reports for students, classes, or departments. Returns aggregated statistics.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['student', 'class', 'department', 'school'],
            description: 'Scope of the report',
          },
          targetId: {
            type: 'string',
            description: 'ID of the target entity (studentId, classId, or departmentId)',
          },
          dateFrom: {
            type: 'string',
            description: 'Optional start date filter (ISO format)',
          },
          dateTo: {
            type: 'string',
            description: 'Optional end date filter (ISO format)',
          },
        },
        required: ['scope'],
      },
    },
  },
];

// ─── Function Call Dispatchers ────────────────────────────────────────────────

/**
 * Dispatch query_attendance function calls to scoped DB queries.
 */
async function dispatchQueryAttendance(
  args: { type: string; classId?: string; dateFrom?: string; dateTo?: string; limit?: number },
  user: AccessTokenPayload,
): Promise<unknown> {
  const limit = args.limit ?? 10;
  const schoolId = user.schoolId;

  // Build base where clause with role-based scoping
  const baseWhere: Record<string, unknown> = { schoolId };

  if (user.role === UserRole.STUDENT) {
    baseWhere.studentId = user.sub;
  } else if (user.role === UserRole.TEACHER && user.classId) {
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId, classId: user.classId },
      select: { id: true },
    });
    baseWhere.sessionId = { in: sessions.map((s) => s.id) };
  } else if (user.role === UserRole.HOD && user.departmentId) {
    const classes = await prisma.class.findMany({
      where: { schoolId, departmentId: user.departmentId },
      select: { id: true },
    });
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId, classId: { in: classes.map((c) => c.id) } },
      select: { id: true },
    });
    baseWhere.sessionId = { in: sessions.map((s) => s.id) };
  }

  // Apply date filters
  if (args.dateFrom || args.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (args.dateFrom) dateFilter.gte = new Date(args.dateFrom);
    if (args.dateTo) dateFilter.lte = new Date(args.dateTo);
    baseWhere.scannedAt = dateFilter;
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
        include: { student: { select: { fullName: true, admissionNumber: true } } },
        take: limit,
      });
      return {
        count: absentRecords.length,
        students: absentRecords.map((r) => ({
          name: r.student.fullName,
          admissionNumber: r.student.admissionNumber,
        })),
      };
    }
    case 'top_students': {
      const students = await prisma.user.findMany({
        where: {
          schoolId,
          role: 'STUDENT',
          ...(user.role === UserRole.TEACHER && user.classId ? { classId: user.classId } : {}),
          ...(user.role === UserRole.HOD && user.departmentId ? { departmentId: user.departmentId } : {}),
        },
        select: { id: true, fullName: true },
        take: 50,
      });

      const studentStats = await Promise.all(
        students.map(async (s) => {
          const total = await prisma.attendanceRecord.count({ where: { studentId: s.id, schoolId } });
          const present = await prisma.attendanceRecord.count({
            where: { studentId: s.id, schoolId, status: { in: ['PRESENT', 'LATE'] } },
          });
          return { name: s.fullName, percentage: total > 0 ? (present / total) * 100 : 0 };
        }),
      );

      return studentStats.sort((a, b) => b.percentage - a.percentage).slice(0, limit);
    }
    default: {
      const records = await prisma.attendanceRecord.findMany({
        where: baseWhere,
        include: { student: { select: { fullName: true } } },
        orderBy: { scannedAt: 'desc' },
        take: limit,
      });
      return records.map((r) => ({
        student: r.student.fullName,
        status: r.status,
        scannedAt: r.scannedAt,
        method: r.method,
      }));
    }
  }
}

/**
 * Dispatch query_risk_scores function calls to scoped DB queries.
 */
async function dispatchQueryRiskScores(
  args: { filter: string; limit?: number },
  user: AccessTokenPayload,
): Promise<unknown> {
  const limit = args.limit ?? 10;
  const schoolId = user.schoolId;

  const where: Record<string, unknown> = { schoolId };

  // Apply role-based scoping
  if (user.role === UserRole.STUDENT) {
    where.studentId = user.sub;
  } else if (user.role === UserRole.TEACHER && user.classId) {
    const students = await prisma.user.findMany({
      where: { schoolId, classId: user.classId, role: 'STUDENT' },
      select: { id: true },
    });
    where.studentId = { in: students.map((s) => s.id) };
  } else if (user.role === UserRole.HOD && user.departmentId) {
    const students = await prisma.user.findMany({
      where: { schoolId, departmentId: user.departmentId, role: 'STUDENT' },
      select: { id: true },
    });
    where.studentId = { in: students.map((s) => s.id) };
  }

  // Apply risk level filter
  if (args.filter === 'high_risk') {
    where.riskLevel = { in: ['HIGH', 'CRITICAL'] };
  } else if (args.filter === 'critical') {
    where.riskLevel = 'CRITICAL';
  }

  const scores = await prisma.riskScore.findMany({
    where,
    orderBy: { score: 'desc' },
    take: limit,
  });

  // Get student names
  const studentIds = scores.map((s) => s.studentId);
  const students = await prisma.user.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, fullName: true },
  });
  const studentMap = new Map(students.map((s) => [s.id, s.fullName]));

  return scores.map((s) => ({
    studentName: studentMap.get(s.studentId) ?? 'Unknown',
    score: s.score,
    riskLevel: s.riskLevel,
    attendanceWeight: s.attendanceWeight,
    patternWeight: s.patternWeight,
    computedAt: s.computedAt,
  }));
}

/**
 * Dispatch query_reports function calls to scoped DB queries.
 */
async function dispatchQueryReports(
  args: { scope: string; targetId?: string; dateFrom?: string; dateTo?: string },
  user: AccessTokenPayload,
): Promise<unknown> {
  const schoolId = user.schoolId;

  // Enforce role-based scoping on targetId
  let targetId = args.targetId;

  switch (args.scope) {
    case 'student': {
      // Students can only see their own reports
      if (user.role === UserRole.STUDENT) {
        targetId = user.sub;
      }
      if (!targetId) {
        return { error: 'targetId is required for student reports' };
      }

      const total = await prisma.attendanceRecord.count({ where: { studentId: targetId, schoolId } });
      const present = await prisma.attendanceRecord.count({
        where: { studentId: targetId, schoolId, status: { in: ['PRESENT', 'LATE'] } },
      });
      const absent = await prisma.attendanceRecord.count({
        where: { studentId: targetId, schoolId, status: 'ABSENT' },
      });
      const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';

      return { totalSessions: total, present, absent, late: present - (total - absent - present), percentage: parseFloat(percentage) };
    }
    case 'class': {
      // Teachers scoped to their class
      if (user.role === UserRole.TEACHER) {
        targetId = user.classId ?? targetId;
      }
      if (!targetId) {
        return { error: 'targetId is required for class reports' };
      }

      const sessions = await prisma.attendanceSession.findMany({
        where: { schoolId, classId: targetId },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      const total = await prisma.attendanceRecord.count({ where: { sessionId: { in: sessionIds }, schoolId } });
      const present = await prisma.attendanceRecord.count({
        where: { sessionId: { in: sessionIds }, schoolId, status: { in: ['PRESENT', 'LATE'] } },
      });
      const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';

      return { classId: targetId, totalRecords: total, present, percentage: parseFloat(percentage) };
    }
    case 'department': {
      // HODs scoped to their department
      if (user.role === UserRole.HOD) {
        targetId = user.departmentId ?? targetId;
      }
      if (!targetId) {
        return { error: 'targetId is required for department reports' };
      }

      const classes = await prisma.class.findMany({
        where: { schoolId, departmentId: targetId },
        select: { id: true, name: true },
      });
      const classIds = classes.map((c) => c.id);
      const sessions = await prisma.attendanceSession.findMany({
        where: { schoolId, classId: { in: classIds } },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      const total = await prisma.attendanceRecord.count({ where: { sessionId: { in: sessionIds }, schoolId } });
      const present = await prisma.attendanceRecord.count({
        where: { sessionId: { in: sessionIds }, schoolId, status: { in: ['PRESENT', 'LATE'] } },
      });
      const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';

      return { departmentId: targetId, classCount: classes.length, totalRecords: total, present, percentage: parseFloat(percentage) };
    }
    case 'school': {
      // Only Admin can see school-wide reports
      if (user.role !== UserRole.SCHOOL_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
        return { error: 'School-wide reports are only available to School Admins' };
      }

      const total = await prisma.attendanceRecord.count({ where: { schoolId } });
      const present = await prisma.attendanceRecord.count({
        where: { schoolId, status: { in: ['PRESENT', 'LATE'] } },
      });
      const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';

      return { schoolId, totalRecords: total, present, percentage: parseFloat(percentage) };
    }
    default:
      return { error: 'Invalid report scope' };
  }
}

// ─── Function Call Dispatcher ─────────────────────────────────────────────────

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
      default:
        result = { error: `Unknown function: ${name}` };
    }

    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: `Function call failed: ${(err as Error).message}` });
  }
}

// ─── OpenAI Engine ────────────────────────────────────────────────────────────

/**
 * OpenAI-powered query engine using function calling.
 * Gated behind LicenseService.checkFeatureAccess('ai') — Pro/Enterprise only.
 *
 * Requirements: 14.5, 14.6
 */
export async function openaiQuery(
  user: AccessTokenPayload,
  question: string,
): Promise<OpenAIQueryResult> {
  const client = getOpenAIClient();
  const systemPrompt = await buildSystemPrompt(user);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ];

  try {
    // Simple chat completion without function calling (works with Groq free tier)
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'llama3-70b-8192',
      messages,
      temperature: 0.3,
      max_tokens: 1000,
    });

    const answer = response.choices[0]?.message?.content ?? 'I was unable to generate a response. Please try rephrasing your question.';

    return {
      answer,
      intent: 'openai_response',
    };
  } catch (err) {
    console.error('[AI/Primary] Error, trying fallback:', (err as Error).message);

    // Try fallback provider (OpenRouter)
    const fallback = getFallbackClient();
    if (fallback) {
      try {
        const fallbackResponse = await fallback.chat.completions.create({
          model: process.env.OPENAI_FALLBACK_MODEL ?? 'meta-llama/llama-3.1-8b-instruct:free',
          messages,
          temperature: 0.3,
          max_tokens: 1000,
        });

        const fallbackAnswer = fallbackResponse.choices[0]?.message?.content;
        if (fallbackAnswer) {
          return { answer: fallbackAnswer, intent: 'openai_response' };
        }
      } catch (fallbackErr) {
        console.error('[AI/Fallback] Also failed:', (fallbackErr as Error).message);
      }
    }

    // Both failed — return helpful fallback
    return {
      answer: `I can help you with:\n• "What is SAMS?" — learn about the system\n• "How many students?" — get counts\n• "Show my timetable" — view schedule\n• "Generate timetable" — create timetables\n• "Who is absent today?" — check attendance\n• "Risk scores" — view at-risk students\n\nPlease try one of these, or rephrase your question.`,
      intent: 'fallback',
    };
  }
}


// ─── OpenAI Engine with History ───────────────────────────────────────────────

/**
 * OpenAI-powered query with conversation history injection.
 * Injects prior conversation messages between system prompt and current question.
 */
export async function openaiQueryWithHistory(
  user: AccessTokenPayload,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<OpenAIQueryResult> {
  const client = getOpenAIClient();
  const systemPrompt = await buildSystemPrompt(user);

  // Build messages: system + history + current question
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: question },
  ];

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'llama3-70b-8192',
      messages,
      temperature: 0.3,
      max_tokens: 1000,
    });

    const answer = response.choices[0]?.message?.content ?? 'I was unable to generate a response. Please try rephrasing your question.';

    return {
      answer,
      intent: 'openai_response',
    };
  } catch (err) {
    console.error('[AI/Primary] Error with history, trying fallback:', (err as Error).message);

    // Try fallback provider (OpenRouter)
    const fallback = getFallbackClient();
    if (fallback) {
      try {
        const fallbackResponse = await fallback.chat.completions.create({
          model: process.env.OPENAI_FALLBACK_MODEL ?? 'meta-llama/llama-3.1-8b-instruct:free',
          messages,
          temperature: 0.3,
          max_tokens: 1000,
        });

        const fallbackAnswer = fallbackResponse.choices[0]?.message?.content;
        if (fallbackAnswer) {
          return { answer: fallbackAnswer, intent: 'openai_response' };
        }
      } catch (fallbackErr) {
        console.error('[AI/Fallback] Also failed:', (fallbackErr as Error).message);
      }
    }

    // Both failed — return helpful fallback
    return {
      answer: `I can help you with:\n• "What is SAMS?" — learn about the system\n• "How many students?" — get counts\n• "Show my timetable" — view schedule\n• "Generate timetable" — create timetables\n• "Who is absent today?" — check attendance\n• "Risk scores" — view at-risk students\n\nPlease try one of these, or rephrase your question.`,
      intent: 'fallback',
    };
  }
}
