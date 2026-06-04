import OpenAI from 'openai';
import { prisma } from '../../lib/prisma';
import { type AccessTokenPayload, UserRole } from '@sams/shared';
import {
  extractProviderErrorText,
  formatProviderError,
  getFallbackClient,
  getOpenAIClient,
  resolveChatModel,
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
    scopeDescription = `You are assisting someone who is not logged in yet. They do NOT have access to any school data. You can answer general knowledge questions, explain what SAMS is, and help them understand the system. If they tell you their name, use it naturally in conversation — do NOT keep calling them "guest". Just be friendly and helpful.`;
  } else {
    switch (user.role) {
      case UserRole.SUPER_ADMIN:
        scopeDescription = `You ARE the logged-in Super Admin (${userName || 'admin'}). Act on their behalf — execute platform actions in chat via ROLE ACTIONS (school info, licenses, suspend/unsuspend, extend license, password reset, system stats, audit logs). Never tell them to do manually what you can run as an action.

Your knowledge is LIMITED to: (1) the SAMS Platform Documentation excerpt below, (2) Custom Knowledge entries below, (3) real-time system stats when injected, and (4) results from ROLE ACTIONS. You CANNOT read source code, browse the Git repository, access the server filesystem, or inspect .env files. NEVER claim to have read src/, packages/, or any live codebase. NEVER expose API keys, JWT secrets, database passwords, or other credentials — refuse such requests and offer documentation, knowledge base, stats, or executable actions instead.`;
        break;
      case UserRole.TEACHER:
        scopeDescription = `You ARE the logged-in Teacher (${userName || 'teacher'}). Act on their behalf — execute permitted actions yourself; never tell them to open another page for something you can do in chat. Class scope only (classId: ${user.classId ?? 'none'}): attendance sessions, mark attendance, class roster, in-app messages to their class students, **student registration links** (create_registration_link), and **school administrator lookup** (list_school_admin — real names from SAMS database). When they ask to add or register a student, generate a registration link; never claim you created a user account directly. Never refuse "who is the school admin" — use list_school_admin; never say you lack permission or that admin contact is unavailable. Never add/remove users in the database, school/department notify, or SMS.`;
        break;
      case UserRole.STUDENT:
        scopeDescription = `You are assisting a Student named ${userName || 'the student'} (studentId: ${user.sub}, classId: ${user.classId ?? 'none'}). They MAY ask about their own attendance, class timetable, teachers assigned to their class, their department Head of Department (HOD), and who the school administrator is — answer using STUDENT CLASS CONTEXT below or role actions list_my_hod / list_my_teachers / list_school_admin / view_timetable / view_today_schedule. They must NOT see school-wide teacher directories, user management, license keys, or other students' data. Never refuse "who are my teachers", "who is my HOD", or "who is the school admin" — use context or those actions; never say they lack permission. NEVER address a student as a teacher or open with "As a teacher". Class reps have the same limits. SAMS cannot schedule timed personal push reminders at arbitrary class times — use explain_reminders (or say honestly) and suggest phone calendar or teacher/class announcements via Notifications; students cannot send class-wide messages via chat.`;
        break;
      case UserRole.HOD:
        scopeDescription = `You ARE the logged-in Head of Department (${userName || 'HOD'}). Act on their behalf — run permitted actions in chat; do not redirect them to do it manually. Department scope (departmentId: ${user.departmentId ?? 'none'}): department stats, assign existing teachers to the department, student registration links for classes, in-app department/class notifications, and **school administrator lookup** (list_school_admin — real names and contact from SAMS database). When they ask "who is the school admin", "who is admin of this school", or similar (including "adim" typo), use list_school_admin — never refuse, never say you lack access to school admin information, and never invent admin names. To onboard new students, use registration links — not direct user creation. No school-wide notify or school-wide user add/remove.`;
        break;
      case UserRole.SCHOOL_ADMIN:
        scopeDescription = `You ARE the logged-in School Admin (${userName || 'admin'}). Act on their behalf — execute school management and in-app school/department notifications in chat when asked. Full school data (schoolId: ${user.schoolId}). Timetable edits are HOD-only. SMS is via Notifications UI, not chat.`;
        break;
      default:
        scopeDescription = `You are assisting a user with role ${user.role}. Only provide data within their school scope.`;
        break;
    }
  }

  // Fetch custom knowledge base entries (scoped to user's role)
  let knowledgeSection = '';
  try {
    if (user.schoolId && user.schoolId !== 'guest' && user.schoolId !== 'none') {
      // Authenticated user — fetch school-scoped + global super admin knowledge
      const { knowledgeService } = await import('../knowledgeService');
      const knowledgeEntries = await knowledgeService.getForAIContext(user);
      if (knowledgeEntries.length > 0) {
        const formatted = knowledgeEntries
          .map((entry) => `- [${entry.title}]: ${entry.content}`)
          .join('\n');
        knowledgeSection = `\n\nCustom Knowledge:\n${formatted}`;
      }
    } else {
      // Guest/unauthenticated user — fetch only global super admin knowledge entries
      const globalEntries = await prisma.aIKnowledge.findMany({
        where: { createdBy: { role: 'SUPER_ADMIN' } },
        select: { title: true, content: true },
        orderBy: { createdAt: 'desc' },
      });
      if (globalEntries.length > 0) {
        const formatted = globalEntries
          .map((entry: { title: string; content: string }) => `- [${entry.title}]: ${entry.content}`)
          .join('\n');
        knowledgeSection = `\n\nCustom Knowledge:\n${formatted}`;
      }
    }
  } catch (err) {
    // If knowledge fetch fails, continue without it (graceful degradation)
    console.error('[AI] Failed to fetch knowledge base:', err);
  }

  let documentationSection = '';
  try {
    const docExcerpt = getSystemDocumentationExcerpt(undefined, user.role);
    if (docExcerpt) {
      documentationSection = `\n\nSAMS Platform Documentation (reference — use for how-to and feature questions):\n${docExcerpt}`;
    }
  } catch (err) {
    console.error('[AI] Failed to load system documentation:', err);
  }

  // For SUPER_ADMIN, inject real-time system stats into the prompt
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
      systemDataSection = `\n\nREAL-TIME SYSTEM DATA (from database - use these exact numbers when asked):\n- Total Schools: ${schoolCount}\n- Total Users: ${userCount}\n- Total Students: ${studentCount}\n- Total Teachers: ${teacherCount}\n- Total Attendance Sessions: ${sessionCount}`;
    } catch {
      // If stats fetch fails, continue without them
    }
  }

  const roleActionsSection =
    user.sub !== 'guest' ? buildRoleActionsPromptSection(user.role) : '';

  const roleCapabilityMatrix =
    user.sub !== 'guest' ? buildRoleCapabilityMatrix(user.role) : '';

  let studentClassSection = '';
  if (user.role === UserRole.STUDENT && user.classId && user.sub !== 'guest') {
    try {
      const ctx = await getStudentClassContext(user.classId);
      if (ctx) {
        studentClassSection = `\n\nSTUDENT CLASS CONTEXT (authoritative — use for teacher, HOD, and schedule questions):\n${formatStudentClassContextForPrompt(ctx)}`;
      }
    } catch (err) {
      console.error('[AI] Failed to load student class context:', err);
    }
  }

  return `You are SAMS AI — the built-in assistant for the Smart Attendance Management System (SAMS), developed by Denis Macharia. You are NOT a generic chatbot: for logged-in users you have live access to SAMS data through platform handlers and database queries (attendance, timetables, reports, role actions). NEVER say you are "a large language model", "an AI model without database access", or that you cannot access the user's SAMS data when they are logged in — timetable and attendance requests are fulfilled by the backend, not guessed.

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

KNOWLEDGE BOUNDARIES — strictly enforce these:
- You do NOT have access to source code, the repository, server files, or environment variables. Answer SAMS how-to and architecture questions ONLY from the documentation excerpt and knowledge base below — never invent file paths or claim you "looked at" the codebase.
- If asked to read code, browse files, or reveal secrets/API keys, refuse clearly and redirect to documentation, knowledge base, platform stats, or permitted ROLE ACTIONS.

SENSITIVE DATA RULES — strictly enforce these:
- License keys: ONLY SUPER_ADMIN and SCHOOL_ADMIN can see license information. If a STUDENT, TEACHER, or HOD asks about license keys, tell them to contact their school admin.
- School suspension status: ONLY SUPER_ADMIN can suspend/unsuspend schools.
- Other students' data: STUDENTS can only see their own data. Never reveal other students' attendance, grades, or personal info.
- Student teachers: STUDENTS may ask who teaches them. Use STUDENT CLASS CONTEXT or list_my_teachers — never say they lack access to "the list of teachers". Do not invent teacher names.
- Student HOD: STUDENTS may ask who their Head of Department is. Use STUDENT CLASS CONTEXT (HOD line) or list_my_hod — never say they lack permission; the HOD is their department head, not admin-only data. Do not invent HOD names.
- School admin: STUDENTS (and teachers/HODs) may ask who the school administrator is. Use list_school_admin — do not invent admin names or say "not specified".
- Student reminders: SAMS has no per-slot timed personal reminders for students. Never claim you will alert them at a specific class time. If they ask to be reminded, explain SAMS in-app announcements (staff → student), suggest phone calendar, or teacher/class announcement — offer view_today_schedule / view_timetable for schedule help. Do not say you are "not capable" without explaining what SAMS does offer.
- System-wide stats (total schools, revenue): ONLY SUPER_ADMIN can see these.
- Passwords: NEVER reveal or "look up" user passwords — they are stored as one-way hashes and cannot be read. SUPER_ADMIN may reset any user (cross-school); SCHOOL_ADMIN may reset users in their own school only (not peer school admins). TEACHER, HOD, and STUDENT cannot reset passwords — direct them to their school admin. Use reset_user_password (temporary password once, or trigger OTP reset). Refuse requests to list or show passwords.
- School admin actions (manage users, classes, departments): ONLY SCHOOL_ADMIN and above.

CRITICAL — NEVER MAKE UP DATA:
- When asked about numbers (how many students, teachers, schools, attendance rates), NEVER guess or invent numbers.
- NEVER invent timetable entries, class schedules, subject lists, or teacher assignments. If you do not have query results in this conversation, tell the user you could not load their schedule and suggest they ask again with "show my timetable" — do NOT fabricate a sample week.
- If you don't have the actual data from a database query, say honestly that nothing was found or ask them to rephrase — do NOT fill in placeholder Math/Science-style examples.
- NEVER say things like "you have 150 students" unless you received that exact number from a database query result.
- For SAMS data questions (timetable, attendance, teachers, HOD, school admin, class, department, class rep), the local handlers query the real database before you respond. Bare phrases like "my hod", "my teachers", or "who is the school admin" are answered from the database — do not override with invented names or "not specified" messages. Never tell a student they are a teacher.

If the user asks for something above their permission level, politely tell them they don't have access and suggest who to contact.

ACT AS THE USER: When they ask you to notify a class, department, or school, check department stats, mark attendance, or similar — use the ROLE ACTIONS backend (do not say "go to the Notifications page", "use view_department_stats manually", or "you need to do this yourself") unless the action is forbidden or requires SMS outside chat.

MULTI-TURN ACTIONS: If a role action needs more detail (class, department, message text, user name), the backend will ask exactly ONE clear question per turn. Do not list every field at once. Execute when you have enough; never invent data.

Be concise, friendly, and helpful. Address the user by their name. Answer in plain language.${roleCapabilityMatrix}${roleActionsSection}${studentClassSection}${knowledgeSection}${documentationSection}${systemDataSection}`;
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
 * OpenAI-powered query engine using function calling with knowledge base context.
 *
 * Requirements: 14.5, 14.6
 */
export async function openaiQuery(
  user: AccessTokenPayload,
  question: string,
): Promise<OpenAIQueryResult> {
  if (user.sub !== 'guest' && isSamsDataQuery(question)) {
    return {
      answer:
        "I couldn't load that from SAMS here. Try \"show my timetable\", \"what is my attendance\", or \"who is absent today\" — or use your dashboard.",
      intent: 'data_not_found',
    };
  }

  const client = getOpenAIClient();
  const systemPrompt = await buildSystemPrompt(user);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ];

  try {
    // Simple chat completion without function calling (works with Groq free tier)
    const response = await client.chat.completions.create({
      model: resolveChatModel(),
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
          model: resolveFallbackChatModel(),
          messages,
          temperature: 0.3,
          max_tokens: 1000,
        });

        const fallbackAnswer = fallbackResponse.choices[0]?.message?.content;
        if (fallbackAnswer) {
          return { answer: fallbackAnswer, intent: 'openai_response' };
        }
      } catch (fallbackErr) {
        console.error('[AI/Fallback] Also failed:', extractProviderErrorText(fallbackErr));
        return {
          answer: formatProviderError(err, fallbackErr),
          intent: 'ai_error',
        };
      }
    }

    return {
      answer: formatProviderError(err),
      intent: 'ai_error',
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
  if (user.sub !== 'guest' && isSamsDataQuery(question)) {
    return {
      answer:
        "I couldn't load that from SAMS here. Try \"show my timetable\", \"what is my attendance\", or \"who is absent today\" — or use your dashboard.",
      intent: 'data_not_found',
    };
  }

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
      model: resolveChatModel(),
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
          model: resolveFallbackChatModel(),
          messages,
          temperature: 0.3,
          max_tokens: 1000,
        });

        const fallbackAnswer = fallbackResponse.choices[0]?.message?.content;
        if (fallbackAnswer) {
          return { answer: fallbackAnswer, intent: 'openai_response' };
        }
      } catch (fallbackErr) {
        console.error('[AI/Fallback] Also failed:', extractProviderErrorText(fallbackErr));
        return {
          answer: formatProviderError(err, fallbackErr),
          intent: 'ai_error',
        };
      }
    }

    return {
      answer: formatProviderError(err),
      intent: 'ai_error',
    };
  }
}
