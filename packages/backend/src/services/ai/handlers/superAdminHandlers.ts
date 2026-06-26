import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { getLicenseSecret } from '../../../config/secrets';
import {
  listTerminalCommandHelp,
  resolveTerminalCommand,
  runSafeTerminalCommand,
} from '../../superAdminTerminalOps';
import { notificationInboxActions } from './notificationInboxActions';

// ─── Helper Utilities (migrated from actionIntentDetector.ts) ─────────────────

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
  if (school.isSuspended) return { answer: `⚠️ School "${school.name}" is already suspended.` };

  await licenseService.suspendSchool(school.id);
  await auditService.log({
    eventType: 'SCHOOL_SUSPENDED',
    actorId: scope.userId,
    actorRole: scope.role,
    schoolId: school.id,
    resourceSnapshot: { action: 'SCHOOL_SUSPENDED_VIA_AI', schoolName: school.name },
  });

  return {
    answer: `✅ School "${school.name}" has been suspended.\n\n• All active sessions revoked\n• Users cannot log in\n• Audit log entry created`,
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
  if (!school.isSuspended) return { answer: `ℹ️ School "${school.name}" is not currently suspended.` };

  await prisma.school.update({
    where: { id: school.id },
    data: { isSuspended: false },
  });
  await auditService.log({
    eventType: 'SCHOOL_SUSPENDED',
    actorId: scope.userId,
    actorRole: scope.role,
    schoolId: school.id,
    resourceSnapshot: { action: 'SCHOOL_UNSUSPENDED_VIA_AI', schoolName: school.name },
  });

  return {
    answer: `✅ School "${school.name}" has been unsuspended.\n\n• Users can now log in\n• Full access restored`,
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
    return {
      answer: 'What school name should I use for the license? Please say: "generate license for [School Name]"',
    };
  }
  const planTier = (params.planTier as string) || 'BASIC';
  const daysValid = (params.daysValid as number) || 365;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + daysValid);

  let secret: string;
  try {
    secret = getLicenseSecret();
  } catch {
    return {
      answer:
        'License generation is not configured on the server yet. Set **LICENSE_SECRET** in `/var/www/sams/.env`, restart `sams-api`, then ask me again.',
    };
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
    answer: `✅ License generated!\n\n**Key:** \`${rawKey}\`\n\n• School: ${schoolName}\n• Plan: ${planTier}\n• Expires: ${expiresAt.toLocaleDateString()}\n\n⚠️ Store this key securely.`,
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
    answer: `✅ License extended for "${school.name}".\n\n• Previous expiry: ${school.licenseExpiresAt.toLocaleDateString()}\n• New expiry: ${newExpiry.toLocaleDateString()}\n• Days added: ${daysToAdd}`,
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
    answer: `📋 **${school.name}**\n\n• Code: ${school.schoolCode}\n• Plan: ${school.planTier}\n• Expires: ${school.licenseExpiresAt.toLocaleDateString()}\n• Suspended: ${school.isSuspended ? 'Yes ⚠️' : 'No ✅'}\n• Users: ${(school as any)._count.users}\n• Sessions: ${(school as any)._count.sessions}\n• Payments: ${(school as any)._count.payments}`,
    data: school,
  };
};

const clearAuditLogsHandler: ActionHandler = async (params, scope) => {
  const { auditService } = await import('../../auditService');

  const filters: {
    schoolId?: string;
    eventType?: string;
    dateFrom?: Date;
    dateTo?: Date;
  } = {};

  if (params.schoolId && typeof params.schoolId === 'string') {
    filters.schoolId = params.schoolId;
  }
  if (params.eventType && typeof params.eventType === 'string') {
    filters.eventType = params.eventType;
  }
  if (params.dateFrom && typeof params.dateFrom === 'string') {
    filters.dateFrom = new Date(params.dateFrom);
  }
  if (params.dateTo && typeof params.dateTo === 'string') {
    filters.dateTo = new Date(params.dateTo);
  }

  const deletedCount = await auditService.clear(filters);

  await auditService.log({
    eventType: 'AI_ACTION_EXECUTED',
    actorId: scope.userId,
    actorRole: scope.role,
    resourceSnapshot: {
      action: 'AUDIT_LOGS_CLEARED',
      deletedCount,
      filters,
      clearedVia: 'AI',
    },
  });

  const filterNote =
    Object.keys(filters).length > 0
      ? ' (matching your filters)'
      : ' (entire audit log table)';

  return {
    answer: `✅ Cleared **${deletedCount}** audit log record(s)${filterNote}.\n\nA new audit entry documents this purge.`,
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
    return {
      answer:
        'Who needs a password reset? Say: "reset password for [username] at school [code]" or provide identifier + schoolCode/schoolId.',
    };
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
    answer: `📊 **System Stats**\n\n• Schools: ${totalSchools}\n• Students: ${totalStudents}\n• Teachers: ${totalTeachers}\n• Active Sessions: ${activeSessions}\n• Suspended: ${suspendedSchools}\n• Revenue: KES ${(revenue._sum.amount || 0).toLocaleString()}`,
    data: { totalSchools, totalStudents, totalTeachers, activeSessions, suspendedSchools },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

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
    totalConversationThreads,
    activeSessions,
    attachmentCount,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.school.count({ where: { isSuspended: true } }),
    prisma.school.count({ where: { licenseExpiresAt: { lt: new Date() } } }),
    prisma.user.count(),
    prisma.conversationThread.count(),
    prisma.attendanceSession.findMany({
      where: { isActive: true, timetableEntryId: { not: null } },
      select: {
        id: true,
        subject: true,
        schoolId: true,
        timetableEntry: { select: { dayOfWeek: true, startTime: true, endTime: true } },
      },
      take: 250,
    }),
    prisma.notificationAttachment.count(),
  ]);

  const staleSessions = activeSessions.filter((session) =>
    session.timetableEntry ? isTimetableWindowExpired(session.timetableEntry) : false,
  );
  const ai = getAIHealthSummary();
  const memoryEnabled = isConversationMemoryEnabled();

  const lines = [
    'System readiness check',
    '',
    `Schools: ${totalSchools} (${suspendedSchools} suspended, ${expiredLicenses} expired licenses)`,
    `Users: ${totalUsers}`,
    `Attendance: ${activeSessions.length} active session(s), ${staleSessions.length} past timetable window`,
    `Notifications: ${attachmentCount} attachment record(s)`,
    `AI: primary ${ai.primaryKey ? 'configured' : 'missing'}, fallback ${ai.fallbackKey ? 'configured' : 'missing'}, memory ${memoryEnabled ? 'enabled' : 'disabled'}`,
  ];

  if (ai.modelMismatch) {
    lines.push(`AI warning: ${ai.model} does not match ${ai.baseURL}.`);
  }
  if (staleSessions.length > 0) {
    lines.push('Attendance warning: stale sessions will be closed when the sessions API next runs; ask staff to refresh Sign In Students.');
  }
  if (!memoryEnabled) {
    lines.push('AI warning: set CONVERSATION_MASTER_KEY (32+ chars) so logged-in chat remembers safely.');
  }

  return {
    answer: lines.join('\n'),
    data: {
      totalSchools,
      suspendedSchools,
      expiredLicenses,
      totalUsers,
      totalConversationThreads,
      activeSessions: activeSessions.length,
      staleActiveSessions: staleSessions.length,
      ai,
      memoryEnabled,
    },
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
    attachmentCount,
    conversationThreads,
    auditCount,
  ] = await Promise.all([
    prisma.school.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        name: true,
        schoolCode: true,
        planTier: true,
        isSuspended: true,
        licenseExpiresAt: true,
        _count: { select: { users: true, sessions: true } },
      },
    }),
    prisma.school.count(),
    prisma.school.count({ where: { isSuspended: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { isLocked: false } }),
    prisma.user.count({ where: { isLocked: true } }),
    prisma.department.count(),
    prisma.class.count(),
    prisma.attendanceSession.count({ where: { isActive: true } }),
    prisma.attendanceRecord.count({
      where: {
        scannedAt: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        },
      },
    }),
    prisma.notification.count(),
    prisma.notificationAttachment.count(),
    prisma.conversationThread.count(),
    prisma.auditLog.count(),
  ]);

  const schoolLines = schools.map((school) => {
    const expiry = school.licenseExpiresAt.toISOString().slice(0, 10);
    return `- ${school.name} (${school.schoolCode}) - ${school.planTier}, users ${school._count.users}, sessions ${school._count.sessions}, expires ${expiry}${school.isSuspended ? ', SUSPENDED' : ''}`;
  });

  return {
    answer: [
      'Live database overview',
      '',
      `Schools: ${totalSchools} (${suspendedSchools} suspended)`,
      `Users: ${totalUsers} (${unlockedUsers} unlocked, ${lockedUsers} locked)`,
      `Departments/classes: ${totalDepartments} departments, ${totalClasses} classes`,
      `Attendance: ${activeSessions} active session(s), ${todayAttendance} record(s) today`,
      `Notifications: ${notificationCount} messages, ${attachmentCount} attachment(s)`,
      `AI memory/audit: ${conversationThreads} conversation thread(s), ${auditCount} audit log record(s)`,
      '',
      'Recent schools:',
      ...(schoolLines.length ? schoolLines : ['- No schools found']),
    ].join('\n'),
    data: {
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
      attachmentCount,
      conversationThreads,
      auditCount,
      recentSchools: schools,
    },
  };
};

const runTerminalCommandHandler: ActionHandler = async (params) => {
  const requestedCommand = String(params.command ?? '').trim();
  const resolved = resolveTerminalCommand(requestedCommand);
  if (!resolved) {
    return {
      answer: `That terminal command is not allowed.\n\n${listTerminalCommandHelp()}`,
    };
  }

  const result = await runSafeTerminalCommand(requestedCommand);
  return {
    answer: [
      `Command: ${result.label}`,
      `Executed: ${result.commandPreview}`,
      '',
      '```text',
      result.output,
      '```',
    ].join('\n'),
    data: {
      key: result.key,
      label: result.label,
      commandPreview: result.commandPreview,
    },
  };
};

const updateProviderSecretHandler: ActionHandler = async (params) => {
  const secretName = normalizeSecretName(params.secretName);
  const secretValue = String(params.secretValue ?? '').trim();

  if (!secretName) {
    return { answer: 'Which key should I update? Example: ATOMESUS_API_KEY.' };
  }
  if (!ALLOWED_PROVIDER_SECRET_KEYS.has(secretName)) {
    return {
      answer:
        `I blocked that key because it is not in the Super Admin secrets allowlist: **${secretName}**.\n\n` +
        `Allowed keys include: ${Array.from(ALLOWED_PROVIDER_SECRET_KEYS).sort().join(', ')}.`,
    };
  }
  if (secretValue.length < 4) {
    return { answer: 'That value looks too short. Paste the full new value for the key.' };
  }

  const filePath = await writeProviderSecret(secretName, secretValue);

  let restartOutput = '';
  try {
    const restart = await runSafeTerminalCommand('@restart-api');
    restartOutput = `\n\nRestart: ${restart.label} completed.`;
  } catch (err) {
    restartOutput =
      `\n\nI updated the file, but the automatic API restart did not complete:\n` +
      '```text\n' +
      `${err instanceof Error ? err.message : String(err)}\n` +
      '```\n' +
      'Run **@restart-api** from Super Admin AI after checking the server.';
  }

  return {
    answer:
      `Updated **${secretName}** in the provider secrets overlay.\n\n` +
      `Stored value: **${maskSecret(secretValue)}**\n` +
      `File: ${filePath}\n` +
      `The full secret was not printed back in chat.` +
      restartOutput +
      '\n\nRun **@diagnose-ai** or **@secrets** to verify masked provider status.',
    data: { secretName, filePath, maskedValue: maskSecret(secretValue) },
  };
};

export const superAdminActions: ActionDefinition[] = [
  ...notificationInboxActions,
  {
    action: 'database_overview',
    description: 'Read a safe live database overview for the whole SAMS platform',
    destructive: false,
    patterns: [
      /^@\s*(?:db|database)(?:\s+(?:summary|overview|status))?\s*$/i,
      /\b(?:database|db)\s+(?:summary|overview|status)\b/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () =>
      'Read live SAMS database overview: schools, users, attendance sessions, notifications, AI memory, and audit counts.',
    handler: databaseOverviewHandler,
  },
  {
    action: 'get_school_info',
    description: 'Get detailed information about a school',
    destructive: false,
    patterns: [
      /^@\s*school\s+(.+)/i,
      /(?:info|information)\s+(?:about|on|for)\s+(.+)/i,
      /details?\s+(?:of|about|for)\s+(.+)/i,
      /show\s+(.+?)\s+info/i,
      /what\s+about\s+(.+)/i,
      /tell\s+me\s+about\s+(.+?)\s+school/i,
      /school\s+info\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
      return { schoolName };
    },
    descriptionTemplate: (params) =>
      `Get information about school "${params.schoolName}".`,
    handler: getSchoolInfoHandler,
  },
  {
    action: 'run_terminal_command',
    description:
      'Run an allowlisted SAMS terminal operation. Only works when the Super Admin message starts with @.',
    destructive: true,
    patterns: [/^@\s*(.+)$/i],
    extractParams: (_message: string, match: RegExpMatchArray | null) => {
      const command = match && match[1] ? `@${match[1].trim()}` : '';
      return { command };
    },
    descriptionTemplate: (params) => {
      const command = String(params.command ?? '');
      const resolved = resolveTerminalCommand(command);
      if (!resolved) {
        return `Refuse blocked terminal command "${command}".`;
      }
      return `Run terminal operation "${resolved.label}" (${resolved.command} ${resolved.args.join(' ')}).`;
    },
    handler: runTerminalCommandHandler,
  },
  {
    action: 'update_provider_secret',
    description:
      'Update an allowlisted provider/config secret in secrets/providers.env, masked in chat. Super Admin only.',
    destructive: true,
    patterns: [
      /(?:set|change|update|replace)\s+(?:the\s+)?(.+?)\s+(?:api\s+key|key|secret)(?:\s+(?:to|as)\s+(\S{8,}))?$/i,
      /(?:set|change|update|replace)\s+(?:the\s+)?(?:api\s+key|key|secret)\s+(?:for\s+)?(.+?)(?:\s+(?:to|as)\s+(\S{8,}))?$/i,
      /(?:set|change|update|replace)\s+([A-Z][A-Z0-9_]{2,})(?:\s+(?:to|as)\s+(\S{8,}))?$/i,
      /(?:add|save)\s+(?:my\s+)?(.+?)\s+(?:api\s+)?key(?:\s+(?:to|as)\s+(\S{8,}))?$/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => ({
      secretName: normalizeSecretName(match?.[1] ?? extractSecretNameFromMessage(message) ?? ''),
      secretValue: match?.[2] ?? extractSecretValueFromMessage(message),
    }),
    descriptionTemplate: (params) => {
      const key = normalizeSecretName(params.secretName);
      return `Update provider secret **${key || 'unknown key'}** in secrets/providers.env, masked in chat, then restart the API.`;
    },
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
      /\bundo\s+(?:the\s+)?(?:suspension|suspend)\s+of\s+(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
      return { schoolName };
    },
    descriptionTemplate: (params) =>
      `Unsuspend school "${params.schoolName}" — users will be able to log in again.`,
    handler: unsuspendSchoolHandler,
  },
  {
    action: 'suspend_school',
    description: 'Suspend a school, blocking all users from logging in',
    destructive: true,
    patterns: [/\bsuspend\s+(.+)/i, /\bblock\s+(.+)/i, /\bdisable\s+(.+)/i],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
      return { schoolName };
    },
    descriptionTemplate: (params) =>
      `Suspend school "${params.schoolName}" — this will block all users from logging in.`,
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
      /new\s+(?:(?:trial|basic|professional|enterprise)\s+)?(?:licen[cs]e|key)\s+(.+)/i,
    ],
    extractParams: (question: string, match: RegExpMatchArray | null) => {
      const remainder = match && match[1] ? match[1].trim() : '';
      const planTier = extractPlanTier(question) || 'BASIC';
      let schoolName = remainder;
      for (const tier of VALID_PLAN_TIERS) {
        schoolName = schoolName.replace(new RegExp(`\\b${tier}\\b`, 'i'), '').trim();
      }
      schoolName = schoolName
        .replace(/^(plan|tier|with|on)\s+/i, '')
        .replace(/\s*(plan|tier|with|on)\s*$/i, '')
        .replace(/^(for|to)\s+/i, '')
        .trim();
      schoolName = extractSchoolName(schoolName);
      return { schoolName: schoolName || 'Unnamed School', planTier };
    },
    descriptionTemplate: (params) =>
      `Generate a ${params.planTier} license key for "${params.schoolName}".`,
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
        } else {
          schoolName = match[1] ? extractSchoolName(match[1]) : '';
        }
      }

      schoolName = schoolName.replace(/^licen[cs]e\s+(?:for\s+)?/i, '').trim();
      return { schoolName, daysToAdd: days };
    },
    descriptionTemplate: (params) =>
      `Extend license for "${params.schoolName}" by ${params.daysToAdd} days.`,
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
    descriptionTemplate: () =>
      `Retrieve system-wide statistics (schools, users, revenue, etc.).`,
    handler: getSystemStatsHandler,
  },
  {
    action: 'run_system_readiness_check',
    description: 'Run a safe platform readiness diagnostic using live database and AI configuration',
    destructive: false,
    patterns: [
      /(?:run\s+)?(?:system|platform|production|app)\s+(?:readiness|health|diagnostic|diagnostics|check|status)/i,
      /(?:diagnose|troubleshoot)\s+(?:system|platform|production|app|sams)/i,
      /is\s+sams\s+ready/i,
      /check\s+(?:the\s+)?(?:whole\s+)?(?:system|platform|app)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () =>
      'Run a safe SAMS readiness diagnostic from live database/configuration signals.',
    handler: runSystemReadinessCheckHandler,
  },
  {
    action: 'reset_user_password',
    description:
      'Reset a user password (temporary password shown once, or send OTP reset). Cannot read existing passwords.',
    destructive: true,
    patterns: [
      /reset\s+(?:user\s+)?pass\s*word\s+(?:for\s+)?(.+)/i,
      /rest\s+(?:user\s+)?pass\s*word\s+(?:for\s+)?(.+)/i,
      /pass\s*word\s+reset\s+(?:for\s+)?(.+)/i,
      /otp\s+(?:pass\s*word\s+)?reset\s+(?:for\s+)?(.+)/i,
      /help\s+(?:user\s+)?(.+?)\s+(?:with\s+)?(?:login|password)/i,
      /help\s+(?:user\s+)?(.+?)\s+(?:with\s+)?(?:login|pass\s*word)/i,
      /forgot\s+pass\s*word\s+(?:for\s+)?(.+)/i,
      /new\s+(?:temp(?:orary)?\s+)?pass\s*word\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const remainder = match && match[1] ? match[1].trim() : '';
      let schoolCode: string | undefined;
      let schoolId: string | undefined;
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

      const mode = /send\s+(?:otp|code|reset\s+link)|trigger\s+reset/i.test(message)
        ? 'trigger_reset'
        : 'temp_password';

      return { identifier, schoolCode, schoolId, mode };
    },
    descriptionTemplate: (params) => {
      const who = params.identifier || 'user';
      const school = params.schoolCode ? ` at school ${params.schoolCode}` : '';
      const mode = params.mode === 'trigger_reset' ? 'send reset code to' : 'set temporary password for';
      return `${mode} "${who}"${school}. Existing passwords cannot be read.`;
    },
    handler: resetUserPasswordHandler,
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
    descriptionTemplate: () =>
      'Clear audit logs. This permanently deletes matching records and leaves one new entry documenting the purge.',
    handler: clearAuditLogsHandler,
  },
];
