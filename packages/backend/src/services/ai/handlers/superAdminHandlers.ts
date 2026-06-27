import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { getLicenseSecret } from '../../../config/secrets';
import {
  listTerminalCommandHelp,
  resolveTerminalCommand,
  runSafeTerminalCommand,
} from '../../superAdminTerminalOps';
import { notificationInboxActions } from './notificationInboxActions';
import { describeBatchParams, resolveBatchSchools, detectBatchOperation, type BatchResolveResult } from '../../superAdminBatchResolver';
import { sendPlatformSummaryEmail } from '../../superAdminEmailSummary';
import { runRawQuery, listAllTables, findInTable } from '../../superAdminDbAccess';
import { readProjectFile, searchInProject, listDirectory } from '../../superAdminCodeAccess';

// ─── Helper Utilities ─────────────────────────────────────────────────────────

const VALID_PLAN_TIERS = ['TRIAL', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'] as const;

const ALLOWED_PROVIDER_SECRET_KEYS = new Set([
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_FALLBACK_KEY',
  'OPENAI_FALLBACK_URL',
  'OPENAI_FALLBACK_MODEL',
  'ATOMESUS_API_KEY',
  'ATOMESUS_BASE_URL',
  'ATOMESUS_MODEL',
  'VISION_MODEL',
  'BIOMETRIC_MASTER_KEY',
  'CONVERSATION_MASTER_KEY',
  'CONVERSATION_MASTER_KEY_PREVIOUS',
  'AT_API_KEY',
  'AT_USERNAME',
  'AT_SENDER_ID',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
]);

function extractSchoolName(text: string): string {
  return text
    .replace(/^(?:the\s+)?(?:another\s+)?school\s+(?:called|named)\s+/i, '')
    .replace(/^(?:the\s+)?(?:another\s+)?school\s+/i, '')
    .replace(/^(?:named|called)\s+/i, '')
    .replace(/\s*(please|now|immediately|asap)\s*$/i, '')
    .trim();
}

function extractPlanTier(question: string): string | undefined {
  const q = question.toUpperCase();
  for (const tier of VALID_PLAN_TIERS) {
    if (q.includes(tier)) return tier;
  }
  return undefined;
}

function extractDays(question: string): number | undefined {
  const match = question.match(/(\d+)\s*days?/i);
  return match ? parseInt(match[1], 10) : undefined;
}

function normalizeSecretName(input: unknown): string {
  const raw = String(input ?? '').trim();
  const upper = raw.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');

  const aliases: Record<string, string> = {
    atomesus: 'ATOMESUS_API_KEY',
    atomesusapikey: 'ATOMESUS_API_KEY',
    atomesuskey: 'ATOMESUS_API_KEY',
    openai: 'OPENAI_API_KEY',
    openaiapikey: 'OPENAI_API_KEY',
    openaikey: 'OPENAI_API_KEY',
    openrouter: 'OPENAI_API_KEY',
    openrouterkey: 'OPENAI_API_KEY',
    openrouterapikey: 'OPENAI_API_KEY',
    groq: 'OPENAI_FALLBACK_KEY',
    groqkey: 'OPENAI_FALLBACK_KEY',
    fallbackkey: 'OPENAI_FALLBACK_KEY',
    fallbackapikey: 'OPENAI_FALLBACK_KEY',
    biometricmasterkey: 'BIOMETRIC_MASTER_KEY',
    biometrickey: 'BIOMETRIC_MASTER_KEY',
    conversationmasterkey: 'CONVERSATION_MASTER_KEY',
    conversationkey: 'CONVERSATION_MASTER_KEY',
  };

  return aliases[compact] ?? upper;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '***masked***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function quoteEnvValue(value: string): string {
  return JSON.stringify(value);
}

function getProvidersEnvPath(): string {
  const root = process.env.SAMS_ROOT?.trim() || process.cwd();
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const vpsPath = '/var/www/sams/secrets/providers.env';
  if (fs.existsSync('/var/www/sams')) return vpsPath;
  return path.join(root, 'secrets', 'providers.env');
}

async function writeProviderSecret(secretName: string, secretValue: string): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const filePath = getProvidersEnvPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch {
    existing = '# SAMS provider secrets overlay\n';
  }

  const line = `${secretName}=${quoteEnvValue(secretValue)}`;
  const escaped = secretName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*${escaped}\\s*=.*$`, 'm');
  const next = re.test(existing)
    ? existing.replace(re, line)
    : `${existing.replace(/\s*$/, '\n')}${line}\n`;

  await fs.writeFile(filePath, next, { mode: 0o600 });
  return filePath;
}

function extractSecretNameFromMessage(message: string): string | undefined {
  const explicit = message.match(/\b([A-Z][A-Z0-9_]{2,})\b/);
  if (explicit) return explicit[1];
  if (/atomesus/i.test(message)) return 'ATOMESUS_API_KEY';
  if (/openrouter/i.test(message)) return 'OPENAI_API_KEY';
  if (/\bgroq\b|fallback/i.test(message)) return 'OPENAI_FALLBACK_KEY';
  if (/\bopen\s*ai\b|\bopenai\b/i.test(message)) return 'OPENAI_API_KEY';
  if (/biometric/i.test(message)) return 'BIOMETRIC_MASTER_KEY';
  if (/conversation/i.test(message)) return 'CONVERSATION_MASTER_KEY';
  return undefined;
}

function extractSecretValueFromMessage(message: string): string | undefined {
  const match = message.match(/\b(?:to|as|value|key)\s+(['"]?)(\S{8,})\1\s*$/i);
  return match?.[2]?.trim();
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

const suspendSchoolHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');
  const { licenseService } = await import('../../licenseService');
  const { auditService } = await import('../../auditService');

  const schoolName = params.schoolName as string;
  if (!schoolName) return { answer: 'School name is required.' };

  const school = await prisma.school.findFirst({
    where: { name: { contains: schoolName, mode: 'insensitive' } },
  });
  if (!school) return { answer: `School "${schoolName}" not found.` };
  if (school.isSuspended) return { answer: `Already suspended: "${school.name}".` };

  await licenseService.suspendSchool(school.id);
  await auditService.log({
    eventType: 'SCHOOL_SUSPENDED',
    actorId: scope.userId,
    actorRole: scope.role,
    schoolId: school.id,
    resourceSnapshot: { action: 'SCHOOL_SUSPENDED_VIA_AI', schoolName: school.name },
  });

  return {
    answer: `Done. "${school.name}" is suspended. All sessions revoked, logins blocked.`,
    data: { schoolId: school.id, schoolName: school.name },
  };
};

const unsuspendSchoolHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');
  const { auditService } = await import('../../auditService');

  const schoolName = params.schoolName as string;
  if (!schoolName) return { answer: 'School name is required.' };

  const school = await prisma.school.findFirst({
    where: { name: { contains: schoolName, mode: 'insensitive' } },
  });
  if (!school) return { answer: `School "${schoolName}" not found.` };
  if (!school.isSuspended) return { answer: `"${school.name}" is not suspended.` };

  await prisma.school.update({ where: { id: school.id }, data: { isSuspended: false } });
  await auditService.log({
    eventType: 'SCHOOL_SUSPENDED',
    actorId: scope.userId,
    actorRole: scope.role,
    schoolId: school.id,
    resourceSnapshot: { action: 'SCHOOL_UNSUSPENDED_VIA_AI', schoolName: school.name },
  });

  return {
    answer: `Done. "${school.name}" is live again. Users can log in.`,
    data: { schoolId: school.id, schoolName: school.name },
  };
};

const generateLicenseHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');
  const { auditService } = await import('../../auditService');
  const { createHash } = await import('crypto');
  const { encodeLicenseKey } = await import('@sams/shared');

  const schoolName = (params.schoolName as string) || '';
  if (!schoolName) {
    return { answer: 'What school should the license be for? Say: "generate license for [School Name]"' };
  }
  const planTier = (params.planTier as string) || 'BASIC';
  const daysValid = (params.daysValid as number) || 365;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + daysValid);

  let secret: string;
  try {
    secret = getLicenseSecret();
  } catch {
    return { answer: 'LICENSE_SECRET not set on the server. Set it in .env and restart, then try again.' };
  }

  const rawKey = encodeLicenseKey(
    { schoolName, planTier: planTier as any, expiresAt },
    secret,
  );
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  await prisma.licenseKey.create({
    data: { keyHash, planTier: planTier as any, schoolName, expiresAt },
  });

  try {
    await auditService.log({
      eventType: 'LICENSE_ACTIVATION',
      actorId: scope.userId,
      actorRole: scope.role,
      resourceSnapshot: { action: 'LICENSE_GENERATED_VIA_AI', schoolName, planTier },
    });
  } catch (err) {
    console.error('[AI SuperAdmin] License generated but audit logging failed:', err);
  }

  return {
    answer: `License generated.\n\nKey: \`${rawKey}\`\nSchool: ${schoolName}\nPlan: ${planTier}\nExpires: ${expiresAt.toLocaleDateString()}\n\nStore this key — it won't be shown again.`,
    data: { licenseKey: rawKey, schoolName, planTier },
  };
};

const extendLicenseHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');
  const { licenseService } = await import('../../licenseService');

  const schoolName = params.schoolName as string;
  const daysToAdd = (params.daysToAdd as number) || 30;
  if (!schoolName) return { answer: 'School name is required.' };

  const school = await prisma.school.findFirst({
    where: { name: { contains: schoolName, mode: 'insensitive' } },
  });
  if (!school) return { answer: `School "${schoolName}" not found.` };

  const baseDate = school.licenseExpiresAt > new Date() ? school.licenseExpiresAt : new Date();
  const newExpiry = new Date(baseDate);
  newExpiry.setDate(newExpiry.getDate() + daysToAdd);
  await licenseService.extendLicense(school.id, newExpiry);

  return {
    answer: `Extended "${school.name}" license by ${daysToAdd} days. New expiry: ${newExpiry.toLocaleDateString()}.`,
    data: { schoolId: school.id, newExpiry: newExpiry.toISOString() },
  };
};

const getSchoolInfoHandler: ActionHandler = async (params) => {
  const { prisma } = await import('../../../index');

  const schoolName = params.schoolName as string;
  if (!schoolName) return { answer: 'School name is required.' };

  const school = await prisma.school.findFirst({
    where: {
      OR: [
        { name: { contains: schoolName, mode: 'insensitive' } },
        { schoolCode: { contains: schoolName, mode: 'insensitive' } },
      ],
    },
    include: { _count: { select: { users: true, sessions: true, payments: true } } },
  });
  if (!school) return { answer: `School "${schoolName}" not found.` };

  return {
    answer: `**${school.name}**\nCode: ${school.schoolCode}\nPlan: ${school.planTier}\nExpires: ${school.licenseExpiresAt.toLocaleDateString()}\nSuspended: ${school.isSuspended ? 'Yes' : 'No'}\nUsers: ${(school as any)._count.users}\nSessions: ${(school as any)._count.sessions}\nPayments: ${(school as any)._count.payments}`,
    data: school,
  };
};

// ─── NEW HANDLERS ────────────────────────────────────────────────────────────

const whoAmIHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../index');
  const user = await prisma.user.findUnique({
    where: { id: scope.userId },
    select: { fullName: true, email: true, role: true, phone: true, createdAt: true },
  });
  if (!user) {
    return { answer: 'Could not find your account.' };
  }
  return {
    answer: `You're ${user.fullName}. Email: ${user.email}. Role: ${user.role}. Phone: ${user.phone || 'N/A'}. Account created: ${user.createdAt.toLocaleDateString()}.`,
    data: user,
  };
};

const listSchoolsHandler: ActionHandler = async () => {
  const { prisma } = await import('../../../index');
  const schools = await prisma.school.findMany({
    orderBy: { name: 'asc' },
    select: {
      name: true,
      schoolCode: true,
      planTier: true,
      isSuspended: true,
      licenseExpiresAt: true,
      email: true,
      phone: true,
      _count: { select: { users: true } },
    },
  });
  if (schools.length === 0) return { answer: 'No schools found.' };
  const lines = schools.map((s) =>
    `- ${s.name} (${s.schoolCode}) — ${s.planTier}, ${s._count.users} users, expires ${s.licenseExpiresAt.toLocaleDateString()}${s.isSuspended ? ' SUSPENDED' : ''}`
  );
  return {
    answer: `${schools.length} school(s):\n${lines.join('\n')}`,
    data: { schools },
  };
};

const dbFindHandler: ActionHandler = async (params) => {
  const searchValue = String(params.searchValue || '').trim();
  if (!searchValue) return { answer: 'What should I search for?' };
  let tableName = params.tableName as string | undefined;
  if (!tableName) {
    if (/school/i.test(searchValue)) tableName = 'School';
    else if (/teacher|staff/i.test(searchValue)) tableName = 'User';
    else if (/student/i.test(searchValue)) tableName = 'User';
    else tableName = 'School';
  }
  try {
    const result = await findInTable(tableName, searchValue);
    if (result.rows.length === 0) {
      return { answer: `Nothing found for "${searchValue}" in ${tableName}.` };
    }
    const rowLines = result.rows.slice(0, 5).map((r) => JSON.stringify(r, null, 2)).join('\n');
    const note = result.rows.length > 5 ? `\n(+ ${result.rows.length - 5} more)` : '';
    return {
      answer: `Found ${result.totalRows} in ${tableName}:\n\`\`\`json\n${rowLines}\n\`\`\`${note}`,
      data: result,
    };
  } catch (err) {
    return { answer: err instanceof Error ? err.message : String(err) };
  }
};

const sendSchoolNotificationHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../index');
  const { auditService } = await import('../../auditService');
  const target = String(params.target || '').trim();
  const messageText = String(params.message || 'Notification from Super Admin').trim();

  if (!target) return { answer: 'Who should I notify? "send message to school [name]".' };

  const school = await prisma.school.findFirst({
    where: { name: { contains: target, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!school) return { answer: `No school matching "${target}".` };

  const users = await prisma.user.findMany({ where: { schoolId: school.id }, select: { id: true } });
  if (users.length === 0) return { answer: `No users in "${school.name}".` };

  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      schoolId: school.id,
      title: 'Super Admin Notification',
      message: messageText,
      type: 'SYSTEM' as const,
    })),
  });

  await auditService.log({
    eventType: 'NOTIFICATION_SENT',
    actorId: scope.userId,
    actorRole: scope.role,
    schoolId: school.id,
    resourceSnapshot: {
      action: 'SEND_NOTIFICATION_VIA_AI',
      schoolName: school.name,
      recipientCount: users.length,
      message: messageText.slice(0, 200),
    },
  });

  return {
    answer: `Sent to ${school.name} — ${users.length} user(s) notified.`,
    data: { schoolName: school.name, recipientCount: users.length },
  };
};

// ─── Existing Handlers ────────────────────────────────────────────────────────

const clearAuditLogsHandler: ActionHandler = async (params, scope) => {
  const { auditService } = await import('../../auditService');

  const filters: {
    schoolId?: string;
    eventType?: string;
    dateFrom?: Date;
    dateTo?: Date;
  } = {};

  if (params.schoolId && typeof params.schoolId === 'string') filters.schoolId = params.schoolId;
  if (params.eventType && typeof params.eventType === 'string') filters.eventType = params.eventType;
  if (params.dateFrom && typeof params.dateFrom === 'string') filters.dateFrom = new Date(params.dateFrom);
  if (params.dateTo && typeof params.dateTo === 'string') filters.dateTo = new Date(params.dateTo);

  const deletedCount = await auditService.clear(filters);

  await auditService.log({
    eventType: 'AI_ACTION_EXECUTED',
    actorId: scope.userId,
    actorRole: scope.role,
    resourceSnapshot: { action: 'AUDIT_LOGS_CLEARED', deletedCount, filters, clearedVia: 'AI' },
  });

  return {
    answer: `Cleared ${deletedCount} audit log record(s). A new audit entry documents this purge.`,
    data: { deletedCount, filters },
  };
};

const resetUserPasswordHandler: ActionHandler = async (params, scope) => {
  const identifier = (params.identifier as string) || (params.username as string) || '';
  const schoolCode = params.schoolCode as string | undefined;
  const schoolId = params.schoolId as string | undefined;
  const modeRaw = (params.mode as string) || 'temp_password';
  const mode = modeRaw === 'trigger_reset' ? 'trigger_reset' : 'temp_password';

  if (!identifier.trim()) {
    return { answer: 'Who needs a reset? Say: "reset password for [username] at school [code]"' };
  }

  const { resetUserPasswordByAdmin } = await import('../../passwordResetService');

  const result = await resetUserPasswordByAdmin({
    identifier,
    schoolCode,
    schoolId,
    mode,
    actorId: scope.userId,
    actorRole: scope.role,
    actorScope: { kind: 'platform' },
  });

  return { answer: result.answer, data: result.data };
};

const getSystemStatsHandler: ActionHandler = async () => {
  const { prisma } = await import('../../../index');

  const [totalSchools, totalStudents, totalTeachers, activeSessions, suspendedSchools] =
    await Promise.all([
      prisma.school.count(),
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.user.count({ where: { role: 'TEACHER' } }),
      prisma.attendanceSession.count({ where: { isActive: true } }),
      prisma.school.count({ where: { isSuspended: true } }),
    ]);
  const revenue = await prisma.payment.aggregate({
    where: { status: 'SUCCESS' },
    _sum: { amount: true },
  });

  return {
    answer: `Schools: ${totalSchools} | Students: ${totalStudents} | Teachers: ${totalTeachers} | Active: ${activeSessions} | Suspended: ${suspendedSchools} | Revenue: KES ${(revenue._sum.amount || 0).toLocaleString()}`,
    data: { totalSchools, totalStudents, totalTeachers, activeSessions, suspendedSchools },
  };
};

const runSystemReadinessCheckHandler: ActionHandler = async () => {
  const { prisma } = await import('../../../lib/prisma');
  const { getAIHealthSummary } = await import('../aiProviderConfig');
  const { isConversationMemoryEnabled } = await import('../roleActionsPrompt');
  const { isTimetableWindowExpired } = await import('../../../lib/sessionWindow');

  const [
    totalSchools,
    suspendedSchools,
    expiredLicenses,
    totalUsers,
    activeSessions,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.school.count({ where: { isSuspended: true } }),
    prisma.school.count({ where: { licenseExpiresAt: { lt: new Date() } } }),
    prisma.user.count(),
    prisma.attendanceSession.findMany({
      where: { isActive: true, timetableEntryId: { not: null } },
      select: { id: true, timetableEntry: { select: { dayOfWeek: true, startTime: true, endTime: true } } },
      take: 250,
    }),
  ]);

  const staleSessions = activeSessions.filter((s) =>
    s.timetableEntry ? isTimetableWindowExpired(s.timetableEntry) : false,
  );
  const ai = getAIHealthSummary();

  const lines = [
    `Schools: ${totalSchools} (${suspendedSchools} suspended, ${expiredLicenses} expired)`,
    `Users: ${totalUsers}`,
    `Active sessions: ${activeSessions.length}, stale: ${staleSessions.length}`,
    `AI: primary ${ai.primaryKey ? 'yes' : 'no'}, fallback ${ai.fallbackKey ? 'yes' : 'no'}`,
  ];

  return {
    answer: lines.join('\n'),
    data: { totalSchools, suspendedSchools, expiredLicenses, totalUsers, activeSessions: activeSessions.length, staleActiveSessions: staleSessions.length, ai },
  };
};

const databaseOverviewHandler: ActionHandler = async () => {
  const { prisma } = await import('../../../index');

  const now = new Date();
  const [
    schools,
    totalSchools,
    suspendedSchools,
    totalUsers,
    unlockedUsers,
    lockedUsers,
    totalDepartments,
    totalClasses,
    activeSessions,
    todayAttendance,
    notificationCount,
    auditCount,
  ] = await Promise.all([
    prisma.school.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { name: true, schoolCode: true, planTier: true, isSuspended: true, licenseExpiresAt: true, _count: { select: { users: true, sessions: true } } } }),
    prisma.school.count(),
    prisma.school.count({ where: { isSuspended: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { isLocked: false } }),
    prisma.user.count({ where: { isLocked: true } }),
    prisma.department.count(),
    prisma.class.count(),
    prisma.attendanceSession.count({ where: { isActive: true } }),
    prisma.attendanceRecord.count({ where: { scannedAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } } }),
    prisma.notification.count(),
    prisma.auditLog.count(),
  ]);

  const schoolLines = schools.map((school) =>
    `- ${school.name} (${school.schoolCode}) - ${school.planTier}, users ${school._count.users}, sessions ${school._count.sessions}, expires ${school.licenseExpiresAt.toISOString().slice(0, 10)}${school.isSuspended ? ', SUSPENDED' : ''}`
  );

  return {
    answer: [
      `Schools: ${totalSchools} (${suspendedSchools} suspended)`,
      `Users: ${totalUsers} (${unlockedUsers} unlocked, ${lockedUsers} locked)`,
      `Depts/classes: ${totalDepartments} depts, ${totalClasses} classes`,
      `Attendance: ${activeSessions} active, ${todayAttendance} today`,
      `Notifications: ${notificationCount}`,
      `Audit logs: ${auditCount}`,
      '',
      'Recent schools:',
      ...schoolLines,
    ].join('\n'),
    data: { totalSchools, suspendedSchools, totalUsers, unlockedUsers, lockedUsers, totalDepartments, totalClasses, activeSessions, todayAttendance, notificationCount, auditCount, recentSchools: schools },
  };
};

const runTerminalCommandHandler: ActionHandler = async (params) => {
  const requestedCommand = String(params.command ?? '').trim();
  const resolved = resolveTerminalCommand(requestedCommand);
  if (!resolved) return { answer: `Not allowed.\n\n${listTerminalCommandHelp()}` };

  const result = await runSafeTerminalCommand(requestedCommand);
  return {
    answer: `${result.label}:\n\`\`\`text\n${result.output}\n\`\`\``,
    data: { key: result.key, label: result.label, commandPreview: result.commandPreview },
  };
};

const updateProviderSecretHandler: ActionHandler = async (params) => {
  const secretName = normalizeSecretName(params.secretName);
  const secretValue = String(params.secretValue ?? '').trim();

  if (!secretName) return { answer: 'Which key?' };
  if (!ALLOWED_PROVIDER_SECRET_KEYS.has(secretName)) return { answer: `Blocked: ${secretName} is not in the allowlist.` };
  if (secretValue.length < 4) return { answer: 'Value too short.' };

  const filePath = await writeProviderSecret(secretName, secretValue);

  let restartOutput = '';
  try {
    const restart = await runSafeTerminalCommand('@restart-api');
    restartOutput = ` Restart: done.`;
  } catch (err) {
    restartOutput = ` Restart failed: ${err instanceof Error ? err.message : String(err)}. Run @restart-api manually.`;
  }

  return {
    answer: `Updated ${secretName}.${restartOutput}`,
    data: { secretName, filePath, maskedValue: maskSecret(secretValue) },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const superAdminActions: ActionDefinition[] = [
  ...notificationInboxActions,

  // ─── SCHOOL INFO ────────────────────────────────────────────────────────
  {
    action: 'get_school_info',
    description: 'Get detailed information about a school including email, contact, users, plan, and status',
    destructive: false,
    patterns: [
      /^@\s*school\s+(.+)/i,
      /(?:info|information)\s+(?:about|on|for)\s+(.+)/i,
      /details?\s+(?:of|about|for)\s+(.+)/i,
      /show\s+(.+?)\s+info/i,
      /what\s+about\s+(.+)/i,
      /tell\s+me\s+about\s+(.+?)\s+school/i,
      /school\s+info\s+(?:for\s+)?(.+)/i,
      /check\s+(?:the\s+)?(?:email|contact)\s+(?:of|for|used\s+by)\s+(.+)/i,
      /what(?:\s+is)?\s+(?:the\s+)?(?:email|contact)\s+(?:of|for)\s+(.+)/i,
      /email\s+(?:of|for|used\s+by)\s+(.+)/i,
      /contact\s+(?:of|for)\s+(.+)/i,
      /look\s+up\s+(.+?)\s+(?:school|info|details)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      if (!match || !match[1]) return { schoolName: '' };
      return { schoolName: match[1].trim().replace(/\s*(?:school|please|now)\s*$/i, '') };
    },
    descriptionTemplate: (params) => `Get info for "${params.schoolName}".`,
    handler: getSchoolInfoHandler,
  },

  // ─── WHO AM I ───────────────────────────────────────────────────────────
  {
    action: 'who_am_i',
    description: 'Look up the current Super Admin user profile (name, email, role) from the database',
    destructive: false,
    patterns: [
      /who\s+am\s+i/i,
      /what('|i)s\s+my\s+name/i,
      /check\s+my\s+name/i,
      /do\s+you\s+know\s+(?:who\s+)?(?:i\s+am|me)/i,
      /am\s+i\s+(?:your\s+)?(?:creator|owner|builder|maker|developer)/i,
      /who\s+(?:built|created|made)\s+(?:you|this|sams)/i,
      /tell\s+me\s+(?:about\s+)?(?:my\s+)?(?:profile|account|info|details)/i,
      /what\s+(?:is\s+)?my\s+(?:user\s+)?(?:id|role|email)/i,
      /find\s+my\s+(?:name|account|profile)\s+/i,
      /look\s+(?:up|at)\s+my\s+(?:account|profile|info)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'Look up current user profile.',
    handler: whoAmIHandler,
  },

  // ─── LIST SCHOOLS ───────────────────────────────────────────────────────
  {
    action: 'list_schools',
    description: 'List all schools in the system with key details (name, code, plan, status, users)',
    destructive: false,
    patterns: [
      /list\s+(?:all\s+)?schools?/i,
      /show\s+(?:me\s+)?(?:all\s+)?schools?/i,
      /all\s+schools/i,
      /what\s+schools?\s+(?:are\s+)?(?:there|exist|registered)/i,
      /display\s+(?:all\s+)?schools?/i,
      /view\s+(?:all\s+)?schools?/i,
      /open\s+schools?/i,
      /^(?:all|list|show)\s+schools\b/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List all schools.',
    handler: listSchoolsHandler,
  },

  // ─── DB FIND ────────────────────────────────────────────────────────────
  {
    action: 'db_find',
    description: 'Search the database for any value (email, name, user, school) across all text columns. Returns real data.',
    destructive: false,
    patterns: [
      /find\s+(.+?)\s+(?:in\s+)?(?:the\s+)?(?:database|db|system)/i,
      /look\s+up\s+(.+)/i,
      /search\s+(?:for\s+)?(.+?)\s+(?:in\s+)?(?:the\s+)?(?:database|db|system|table)/i,
      /check\s+(?:the\s+)?database\s+(?:for\s+)?(.+)/i,
      /who\s+is\s+(.+)/i,
      /check\s+in\s+(?:the\s+)?database\s+(?:for\s+)?(.+)/i,
      /find\s+(.+?)\s+in\s+(?:the\s+)?(\w+)\s+table/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const searchTerm = match?.[1]?.trim() || message.replace(/^(find|look up|search|check)\s+/i, '').trim();
      let table: string | undefined;
      if (/school/i.test(searchTerm)) table = 'School';
      else if (/teacher|staff/i.test(searchTerm)) table = 'User';
      else if (/student/i.test(searchTerm)) table = 'User';
      else if (/user|admin/i.test(searchTerm) || /email|phone|@/i.test(searchTerm)) table = 'User';
      return { tableName: table, searchValue: searchTerm };
    },
    descriptionTemplate: (params) => `Search DB for "${String(params.searchValue || '').slice(0, 60)}".`,
    handler: dbFindHandler,
  },

  // ─── SEND NOTIFICATION ──────────────────────────────────────────────────
  {
    action: 'send_school_notification',
    description: 'Send an in-app notification to all users in a specific school',
    destructive: false,
    patterns: [
      /send\s+(?:a\s+)?(?:message|notification|notice)\s+(?:to\s+)?(.+)/i,
      /notify\s+(?:school\s+)?(.+)/i,
      /message\s+(?:school\s+)?(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const remainder = match?.[1]?.trim() || '';
      const schoolMatch = remainder.match(/^(?:school\s+)?(.+?)(?:\s+(?:that|saying|with|about))(.+)?$/i);
      return {
        target: schoolMatch?.[1]?.trim() || remainder,
        message: schoolMatch?.[2]?.trim() || 'Notification from Super Admin',
      };
    },
    descriptionTemplate: (params) => `Notify "${String(params.target || '').slice(0, 60)}".`,
    handler: sendSchoolNotificationHandler,
  },

  // ─── EXISTING ACTIONS ───────────────────────────────────────────────────
  {
    action: 'run_terminal_command',
    description: 'Run an allowlisted SAMS terminal operation. Only works when message starts with @.',
    destructive: true,
    patterns: [/^@\s*(.+)$/i],
    extractParams: (_message: string, match: RegExpMatchArray | null) => ({ command: match && match[1] ? `@${match[1].trim()}` : '' }),
    descriptionTemplate: (params) => {
      const resolved = resolveTerminalCommand(String(params.command ?? ''));
      return resolved ? `Run ${resolved.label}.` : 'Blocked command.';
    },
    handler: runTerminalCommandHandler,
  },
  {
    action: 'update_provider_secret',
    description: 'Update an allowlisted provider/config secret in secrets/providers.env, masked in chat.',
    destructive: true,
    patterns: [
      /(?:set|change|update|replace)\s+(?:the\s+)?(.+?)\s+(?:api\s+key|key|secret)(?:\s+(?:to|as)\s+(\S{8,}))?$/i,
      /(?:set|change|update|replace)\s+([A-Z][A-Z0-9_]{2,})(?:\s+(?:to|as)\s+(\S{8,}))?$/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => ({
      secretName: normalizeSecretName(match?.[1] ?? extractSecretNameFromMessage(message) ?? ''),
      secretValue: match?.[2] ?? extractSecretValueFromMessage(message),
    }),
    descriptionTemplate: (params) => `Update ${normalizeSecretName(params.secretName) || 'key'}.`,
    handler: updateProviderSecretHandler,
  },
  {
    action: 'unsuspend_school',
    description: 'Unsuspend a school, restoring user access',
    destructive: false,
    patterns: [
      /\bunsuspend\s+(.+)/i,
      /\bunblock\s+(.+)/i,
      /\breactivate\s+(.+)/i,
      /\benabl(?:e|ing)\s+(.+)/i,
      /\bundo\s+(?:the\s+)?(?:suspension|suspend)\s+(?:for\s+)?(.+)/i,
      /undo\s+(?:the\s+)?(?:suspension|suspend)\s+of\s+(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => ({ schoolName: match && match[1] ? extractSchoolName(match[1]) : '' }),
    descriptionTemplate: (params) => `Unsuspend "${params.schoolName}".`,
    handler: unsuspendSchoolHandler,
  },
  {
    action: 'suspend_school',
    description: 'Suspend a school, blocking all users from logging in',
    destructive: true,
    patterns: [/\bsuspend\s+(.+)/i, /\bblock\s+(.+)/i, /\bdisable\s+(.+)/i],
    extractParams: (message: string, match: RegExpMatchArray | null) => ({ schoolName: match && match[1] ? extractSchoolName(match[1]) : '' }),
    descriptionTemplate: (params) => `Suspend "${params.schoolName}".`,
    handler: suspendSchoolHandler,
  },
  {
    action: 'generate_license',
    description: 'Generate a new license key for a school',
    destructive: false,
    patterns: [
      /generate\s+(?:a\s+)?(?:(?:trial|basic|professional|enterprise)\s+)?(?:licen[cs]e|key)\s+(?:for\s+)?(.+)/i,
      /create\s+(?:a\s+)?(?:(?:trial|basic|professional|enterprise)\s+)?(?:licen[cs]e|key)\s+(?:for\s+)?(.+)/i,
      /new\s+(?:(?:trial|basic|professional|enterprise)\s+)?licen[cs]e\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (question: string, match: RegExpMatchArray | null) => {
      const remainder = match && match[1] ? match[1].trim() : '';
      const planTier = extractPlanTier(question) || 'BASIC';
      let schoolName = remainder;
      for (const tier of VALID_PLAN_TIERS) schoolName = schoolName.replace(new RegExp(`\\b${tier}\\b`, 'i'), '').trim();
      schoolName = schoolName.replace(/^(plan|tier|with|on)\s+/i, '').replace(/\s*(plan|tier|with|on)\s*$/i, '').replace(/^(for|to)\s+/i, '').trim();
      return { schoolName: extractSchoolName(schoolName) || 'Unnamed School', planTier };
    },
    descriptionTemplate: (params) => `Generate ${params.planTier} license for "${params.schoolName}".`,
    handler: generateLicenseHandler,
  },
  {
    action: 'extend_license',
    description: 'Extend a school license by a number of days',
    destructive: false,
    patterns: [
      /extend\s+(.+?)\s+by\s+(\d+)\s*days?/i,
      /add\s+(\d+)\s*days?\s+to\s+(.+)/i,
      /renew\s+(.+)/i,
      /extend\s+(?:licen[cs]e\s+(?:for\s+)?)?(.+)/i,
    ],
    extractParams: (question: string, match: RegExpMatchArray | null) => {
      const days = extractDays(question) || 30;
      let schoolName = '';
      if (match) {
        if (/extend\s+(.+?)\s+by\s+\d+/i.test(question)) {
          const m = question.match(/extend\s+(.+?)\s+by\s+\d+/i);
          schoolName = m && m[1] ? extractSchoolName(m[1]) : '';
        } else if (/add\s+\d+\s*days?\s+to\s+(.+)/i.test(question)) {
          const m = question.match(/add\s+\d+\s*days?\s+to\s+(.+)/i);
          schoolName = m && m[1] ? extractSchoolName(m[1]) : '';
        } else schoolName = match[1] ? extractSchoolName(match[1]) : '';
      }
      schoolName = schoolName.replace(/^licen[cs]e\s+(?:for\s+)?/i, '').trim();
      return { schoolName, daysToAdd: days };
    },
    descriptionTemplate: (params) => `Extend "${params.schoolName}" by ${params.daysToAdd} days.`,
    handler: extendLicenseHandler,
  },
  {
    action: 'get_system_stats',
    description: 'Retrieve system-wide statistics (schools, users, revenue)',
    destructive: false,
    patterns: [
      /system\s*stats/i,
      /platform\s*stats/i,
      /how\s+many\s+schools/i,
      /total\s+revenue/i,
      /dashboard\s*stats/i,
      /system\s*overview/i,
      /platform\s*overview/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'System statistics.',
    handler: getSystemStatsHandler,
  },
  {
    action: 'run_system_readiness_check',
    description: 'Run a safe platform readiness diagnostic',
    destructive: false,
    patterns: [
      /(?:run\s+)?(?:system|platform|production|app)\s+(?:readiness|health|diagnostic|check|status)/i,
      /(?:diagnose|troubleshoot)\s+(?:system|platform|production|app|sams)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'Run readiness check.',
    handler: runSystemReadinessCheckHandler,
  },
  {
    action: 'reset_user_password',
    description: 'Reset a user password (temporary password shown once, or send OTP reset)',
    destructive: true,
    patterns: [
      /reset\s+(?:user\s+)?pass\s*word\s+(?:for\s+)?(.+)/i,
      /pass\s*word\s+reset\s+(?:for\s+)?(.+)/i,
      /otp\s+reset\s+(?:for\s+)?(.+)/i,
      /new\s+(?:temp(?:orary)?\s+)?pass\s*word\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const remainder = match && match[1] ? match[1].trim() : '';
      let schoolCode: string | undefined;
      let identifier = remainder;
      const atSchool = remainder.match(/^(.+?)\s+(?:at|in)\s+school\s+(\S+)/i);
      if (atSchool) {
        identifier = atSchool[1]!.trim();
        schoolCode = atSchool[2]!.trim();
      } else {
        const codeMatch = remainder.match(/^(.+?)\s+(\b[A-Z0-9]{4,12}\b)\s*$/i);
        if (codeMatch && codeMatch[2]!.length <= 12) {
          identifier = codeMatch[1]!.trim();
          schoolCode = codeMatch[2]!.trim();
        }
      }
      return { identifier, schoolCode, mode: /send\s+(?:otp|code|reset\s+link)|trigger\s+reset/i.test(message) ? 'trigger_reset' : 'temp_password' };
    },
    descriptionTemplate: (params) => {
      const who = params.identifier || 'user';
      const school = params.schoolCode ? ` at ${params.schoolCode}` : '';
      const mode = params.mode === 'trigger_reset' ? 'send reset code to' : 'set temp password for';
      return `${mode} "${who}"${school}.`;
    },
    handler: resetUserPasswordHandler,
  },
  {
    action: 'send_platform_summary',
    description: 'Send a platform summary email to the super admin email',
    destructive: false,
    patterns: [
      /send\s+(?:platform|system|daily)\s+(?:summary|report|email)/i,
      /email\s+(?:platform|system|daily)\s+(?:summary|report)/i,
      /(?:send|email)\s+(?:me\s+)?(?:a\s+)?(?:platform\s+)?summary/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'Send platform summary.',
    handler: async () => {
      const result = await sendPlatformSummaryEmail();
      return { answer: result.message, data: { sentTo: result.sentTo } };
    },
  },
  {
    action: 'clear_audit_logs',
    description: 'Clear or delete audit log records (optionally filtered)',
    destructive: true,
    patterns: [
      /clear\s+(?:all\s+)?audit\s+logs?/i,
      /delete\s+(?:all\s+)?audit\s+logs?/i,
      /purge\s+audit\s+logs?/i,
      /remove\s+(?:all\s+)?audit\s+logs?/i,
      /wipe\s+audit\s+logs?/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'Clear audit logs.',
    handler: clearAuditLogsHandler,
  },
  {
    action: 'batch_operation',
    description: 'Batch operation on multiple schools',
    destructive: true,
    patterns: [
      /(?:batch|bulk)\s+(suspend|unsuspend|extend|change\s+plan|send|notify)\s+(.+)/i,
      /(suspend|unsuspend|extend|change\s+plan|send|notify)\s+(?:all|every)\s+(suspended|expired|active|trial|basic|professional|enterprise)\s+(.+)/i,
      /(?:all|every)\s+(suspended|expired|active)\s+school/i,
      /schools?\s+that\s+(?:are|have)\s+(suspended|expired)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      if (match) {
        const detected = detectBatchOperation(message);
        return { description: match[0], criteria: detected.criteriaText, operation: detected.operation };
      }
      return { description: message, operation: null };
    },
    descriptionTemplate: (params) => {
      const op = params.operation ? String(params.operation).replace(/_/g, ' ') : 'operation';
      return `Batch ${op} — ${String(params.description || '').slice(0, 80)}`;
    },
    handler: async (params, scope) => {
      const { prisma } = await import('../../../index');
      const { auditService } = await import('../../auditService');
      const resolved: BatchResolveResult = await resolveBatchSchools(params);
      if (resolved.total === 0) return { answer: 'No schools match.' };

      const { operation } = detectBatchOperation(String(params.description ?? params.criteria ?? ''));
      const finalOp = String(params.operation ?? operation ?? '');
      if (!finalOp) return { answer: `Found ${resolved.total} school(s): ${resolved.schoolNames.join(', ')}. What operation?` };

      const { superAdminFeaturesService } = await import('../../superAdminFeaturesService');
      const schoolIds = resolved.schoolIds;
      let updatedCount: number;
      let actionLabel: string;

      switch (finalOp) {
        case 'suspend_school':
          updatedCount = (await superAdminFeaturesService.batchSuspend({ schoolIds })).updated;
          actionLabel = `Suspended ${updatedCount}`;
          break;
        case 'unsuspend_school':
          updatedCount = (await superAdminFeaturesService.batchUnsuspend({ schoolIds })).updated;
          actionLabel = `Unsuspended ${updatedCount}`;
          break;
        case 'extend_license':
          updatedCount = (await superAdminFeaturesService.batchExtendLicenses({ schoolIds, daysToAdd: (params.daysToAdd as number) || 30 })).updated;
          actionLabel = `Extended ${updatedCount}`;
          break;
        case 'batch_change_plan':
          updatedCount = (await superAdminFeaturesService.batchChangePlan({ schoolIds, planTier: String(params.planTier ?? 'BASIC').toUpperCase() })).updated;
          actionLabel = `Changed plan for ${updatedCount}`;
          break;
        case 'batch_send_notification':
          updatedCount = (await superAdminFeaturesService.batchSendNotification({ schoolIds, title: 'Platform Notification', message: String(params.message ?? 'Notification from Super Admin') })).sent;
          actionLabel = `Notified ${updatedCount}`;
          break;
        default:
          return { answer: `Found ${resolved.total} school(s). What operation?` };
      }

      await auditService.log({
        eventType: 'AI_ACTION_EXECUTED',
        actorId: scope.userId,
        actorRole: scope.role,
        resourceSnapshot: { action: 'BATCH_OPERATION', operation: finalOp, schoolCount: resolved.total, updated: updatedCount },
      });

      return { answer: `Done. ${actionLabel} school(s).` };
    },
  },
  {
    action: 'database_overview',
    description: 'Read a safe live database overview for the whole SAMS platform',
    destructive: false,
    patterns: [
      /^@\s*(?:db|database)(?:\s+(?:summary|overview|status))?\s*$/i,
      /\b(?:database|db)\s+(?:summary|overview|status)\b/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'Database overview.',
    handler: databaseOverviewHandler,
  },
  {
    action: 'db_list_tables',
    description: 'List all database tables with row counts and column details',
    destructive: false,
    patterns: [
      /list\s+(?:all\s+)?(?:database\s+)?tables?/i,
      /show\s+(?:database\s+)?(?:schema|tables)/i,
      /what\s+tables?\s+(?:exist|are\s+there)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List database tables.',
    handler: async () => {
      const tables = await listAllTables();
      return {
        answer: tables.map((t) => `${t.tableName}: ${t.rowCount} rows, ${t.columns.length} cols`).join('\n'),
        data: { tables },
      };
    },
  },
  {
    action: 'db_query',
    description: 'Run a read-only SQL query (SELECT only)',
    destructive: false,
    patterns: [
      /^SELECT\s/i,
      /^(?:run|execute)\s+(?:a\s+)?(?:SQL\s+)?query/i,
      /query\s+the\s+database/i,
    ],
    extractParams: (message: string) => ({ sql: message }),
    descriptionTemplate: (params) => `Query: ${String(params.sql ?? '').slice(0, 100)}`,
    handler: async (params) => {
      const sql = String(params.sql ?? '');
      if (!sql.trim()) return { answer: 'What query? Example: SELECT * FROM "School" LIMIT 10' };
      try {
        const result = await runRawQuery(sql);
        const rows = result.rows.slice(0, 10).map((r) => JSON.stringify(r, null, 2)).join('\n');
        return {
          answer: `${result.totalRows} row(s) in ${result.executionMs}ms\n\`\`\`json\n${rows}\n\`\`\`${result.truncated ? '\n(truncated)' : ''}`,
          data: result,
        };
      } catch (err) {
        return { answer: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    action: 'read_file',
    description: 'Read a source code or config file from the project',
    destructive: false,
    patterns: [
      /read\s+(?:file\s+)?(.+\.(?:ts|tsx|js|jsx|json|md|sh|sql|css|prisma|yaml|env\.example))/i,
      /cat\s+(.+)/i,
      /view\s+(?:file\s+)?(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => ({ filePath: match?.[1]?.trim() ?? '' }),
    descriptionTemplate: (params) => `Read "${params.filePath}".`,
    handler: async (params) => {
      const filePath = String(params.filePath ?? '').trim();
      if (!filePath) return { answer: 'Which file?' };
      try {
        const result = await readProjectFile(filePath);
        return {
          answer: `${result.relativePath} (${result.size}, ${result.lines} lines):\n\`\`\`\n${result.content}\n\`\`\``,
          data: result,
        };
      } catch (err) {
        return { answer: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    action: 'search_code',
    description: 'Search for text across all project source files',
    destructive: false,
    patterns: [
      /search\s+(?:for\s+)?(?:the\s+)?["'](.+?)["']/i,
      /find\s+(?:where\s+)?(?:is\s+)?(.+?)\s+(?:used|defined|called|referenced)/i,
      /grep\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const quoted = message.match(/["'](.+?)["']/);
      return { searchTerm: quoted?.[1]?.trim() ?? match?.[1]?.trim() ?? '' };
    },
    descriptionTemplate: (params) => `Search "${String(params.searchTerm).slice(0, 60)}".`,
    handler: async (params) => {
      const searchTerm = String(params.searchTerm ?? '').trim();
      if (!searchTerm) return { answer: 'Search for what?' };
      const results = await searchInProject(searchTerm);
      if (results.length === 0) return { answer: 'Nothing found.' };
      return {
        answer: results.slice(0, 10).map((r) => `${r.relativePath} (${r.totalMatches})`).join('\n'),
        data: { results: results.slice(0, 10) },
      };
    },
  },
];
