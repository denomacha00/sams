import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── FEATURE FLAGS ──────────────────────────────────────────────────────────

const listFeatureFlagsHandler: ActionHandler = async () => {
  const { prisma } = await import('../../../index');
  const schoolFeatureFlags = await prisma.schoolFeatureFlag.findMany({
    orderBy: { featureKey: 'asc' },
  });
  const uniqueFlags = new Map<string, string>();
  for (const f of schoolFeatureFlags) {
    if (!uniqueFlags.has(f.featureKey) || f.enabled) {
      uniqueFlags.set(f.featureKey, f.enabled ? '✅ ON' : '❌ OFF');
    }
  }
  if (uniqueFlags.size === 0) return { answer: 'No feature flags found.', data: [] };
  const lines = Array.from(uniqueFlags.entries()).map(([k, v]) => `• ${k}: ${v}`);
  return { answer: `⚙️ **Feature Flags** (${uniqueFlags.size})\n\n${lines.join('\n')}`, data: { flags: Array.from(uniqueFlags.entries()) } };
};

const toggleFeatureFlagHandler: ActionHandler = async (params) => {
  const key = String(params.featureKey || '').trim();
  if (!key) return { answer: 'Which feature flag? (e.g. "toggle biometric_attendance")' };
  const { prisma } = await import('../../../index');
  const flag = await prisma.schoolFeatureFlag.findFirst({ where: { featureKey: key } });
  if (!flag) return { answer: `Flag "${key}" not found.` };
  const updated = await prisma.schoolFeatureFlag.update({ where: { id: flag.id }, data: { enabled: !flag.enabled } });
  return { answer: `✅ ${updated.featureKey}: ${updated.enabled ? 'ON' : 'OFF'}`, data: { featureKey: updated.featureKey, enabled: updated.enabled } };
};

// ─── SECURITY EVENTS ────────────────────────────────────────────────────────

const listSecurityEventsHandler: ActionHandler = async () => {
  const { prisma } = await import('../../../index');
  const events = await prisma.securityEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  if (events.length === 0) return { answer: 'No security events found.', data: [] };
  const lines = events.map((e) => `• ${e.createdAt.toLocaleString()} [${e.severity}] ${e.eventType}`);
  return { answer: `🔒 **Security Events** (${events.length})\n\n${lines.join('\n')}`, data: { events } };
};

// ─── BRAND TEMPLATES ────────────────────────────────────────────────────────

const listBrandTemplatesHandler: ActionHandler = async () => {
  const { prisma } = await import('../../../index');
  const templates = await prisma.brandTemplate.findMany({ orderBy: { name: 'asc' } });
  if (templates.length === 0) return { answer: 'No brand templates found.', data: [] };
  const lines = templates.map((t) => `• ${t.name}${t.isActive ? ' (active)' : ''}`);
  return { answer: `🎨 **Brand Templates**\n\n${lines.join('\n')}`, data: { templates } };
};

// ─── SCHEDULED JOBS ────────────────────────────────────────────────────────

const listScheduledJobsHandler: ActionHandler = async () => {
  const { prisma } = await import('../../../index');
  const jobs = await prisma.scheduledJob.findMany({ orderBy: { nextRunAt: 'asc' } });
  if (jobs.length === 0) return { answer: 'No scheduled jobs configured.', data: [] };
  const lines = jobs.map((j) => `• ${j.name} - ${j.enabled ? '✅' : '❌'} next: ${j.nextRunAt ? j.nextRunAt.toLocaleString() : 'N/A'}`);
  return { answer: `⏰ **Scheduled Jobs** (${jobs.length})\n\n${lines.join('\n')}`, data: { jobs } };
};

const triggerJobHandler: ActionHandler = async (params) => {
  const jobName = String(params.jobName || '').trim();
  if (!jobName) return { answer: 'Which job? (e.g. "trigger daily_summary")' };
  const { prisma } = await import('../../../index');
  const job = await prisma.scheduledJob.findFirst({ where: { name: { contains: jobName, mode: 'insensitive' } } });
  if (!job) return { answer: `Job "${jobName}" not found.` };
  await prisma.scheduledJob.update({ where: { id: job.id }, data: { nextRunAt: new Date() } });
  return { answer: `✅ ${job.name} scheduled to run now.`, data: { jobId: job.id } };
};

// ─── REVENUE FORECAST ──────────────────────────────────────────────────────

const viewRevenueForecastHandler: ActionHandler = async () => {
  const { superAdminFeaturesService } = await import('../../superAdminFeaturesService');
  const forecast = await superAdminFeaturesService.getRevenueForecast(6);
  const lines = [
    `📊 **Revenue Forecast** (6 months)`,
    '',
    `• **Current MRR:** KES ${forecast.currentMRR.toLocaleString()}`,
    `• **Projected MRR (6mo):** KES ${forecast.projectedMRR.toLocaleString()}`,
    `• **MRR Growth:** ${forecast.mrrGrowth > 0 ? '+' : ''}${forecast.mrrGrowth}%`,
    `• **Churn Risk:** ${forecast.churnRisk}%`,
    `• **Trend:** ${forecast.trend === 'up' ? '📈 Up' : forecast.trend === 'down' ? '📉 Down' : '➡️ Stable'}`,
    '',
    '**Monthly Breakdown:**',
    ...forecast.monthlyBreakdown.map((m) =>
      `• ${m.month}: KES ${m.projectedRevenue.toLocaleString()} (${m.activeSchools} schools${m.churnedSchools > 0 ? `, ${m.churnedSchools} churned` : ''})`
    ),
  ];
  return {
    answer: lines.join('\n'),
    data: forecast,
  };
};

// ─── SCHOOL ADMIN ACTIVITY VIEW ────────────────────────────────────────────

const viewSchoolAdminActivityHandler: ActionHandler = async () => {
  const { superAdminFeaturesService } = await import('../../superAdminFeaturesService');
  const activities = await superAdminFeaturesService.getSchoolAdminActivity(48);
  if (activities.length === 0) {
    return { answer: 'No school admin activity found in the last 48 hours.', data: [] };
  }
  const lines = activities.slice(0, 20).map((a) =>
    `• ${a.createdAt.toLocaleString()} — ${(a as any).actor?.fullName || 'Unknown'} at ${(a as any).school?.name || 'N/A'}: ${a.eventType}`
  );
  return {
    answer: `📋 **School Admin Activity** (last 48h — ${activities.length} events)\n\n${lines.join('\n')}`,
    data: { count: activities.length, activities: activities.slice(0, 20) },
  };
};

// ─── DATA EXPORT ────────────────────────────────────────────────────────────

const triggerDataExportHandler: ActionHandler = async (params) => {
  const exportType = String(params.exportType || 'schools').trim();
  const formatRaw = String(params.format || 'csv').trim().toLowerCase();
  const format = formatRaw === 'csv' || formatRaw === 'json' || formatRaw === 'xlsx' ? formatRaw : 'csv';
  const { prisma } = await import('../../../index');
  const export_ = await prisma.dataExport.create({
    data: { exportType, format, status: 'PENDING', filters: { triggeredBy: 'ai' } },
  });
  return {
    answer: `📥 Data export initiated: ${exportType} as ${format.toUpperCase()} (ID: ${export_.id}). Check the page for download.`,
    data: { exportId: export_.id, exportType, format },
  };
};

// ─── ACTION DEFINITIONS ─────────────────────────────────────────────────────

export const superAdminExtraActions: ActionDefinition[] = [
  {
    action: 'view_revenue_forecast',
    description: 'View revenue forecast for the next 6 months (MRR, growth, churn risk)',
    destructive: false,
    patterns: [
      /(?:revenue\s+)?forecast/i,
      /revenue\s+project(?:ion|ed)/i,
      /mrr\b/i,
      /projected\s+revenue/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View revenue forecast.',
    handler: viewRevenueForecastHandler,
  },
  {
    action: 'view_school_admin_activity',
    description: 'View recent school admin activity across the platform (last 48h)',
    destructive: false,
    patterns: [
      /(?:school\s+)?admin\s+activity/i,
      /what\s+(?:are|have)\s+(?:school\s+)?admins?\s+(?:doing|up\s+to)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View school admin activity.',
    handler: viewSchoolAdminActivityHandler,
  },
  {
    action: 'list_feature_flags',
    description: 'List all feature flags across the platform',
    destructive: false,
    patterns: [/(?:list|show|view)\s+(?:feature\s+)?flags?/i, /what\s+features?\s+(?:are\s+)?(?:enabled|available)/i],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List feature flags.',
    handler: listFeatureFlagsHandler,
  },
  {
    action: 'toggle_feature_flag',
    description: 'Toggle a feature flag on/off',
    destructive: true,
    patterns: [/toggle\s+(?:feature\s+)?flag\s+(.+)/i, /(?:enable|disable)\s+(?:feature\s+)?(.+?)\s+(?:flag|feature)/i],
    extractParams: (_msg, match) => ({ featureKey: (match?.[1] || '').trim() }),
    descriptionTemplate: (p) => `Toggle flag "${String(p.featureKey)}".`,
    handler: toggleFeatureFlagHandler,
  },
  {
    action: 'list_security_events',
    description: 'List recent security events',
    destructive: false,
    patterns: [/(?:list|show|view)\s+(?:security\s+)?events?/i, /security\s+(?:events?|logs?|issues?)/i],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List recent security events.',
    handler: listSecurityEventsHandler,
  },
  {
    action: 'list_brand_templates',
    description: 'List brand templates',
    destructive: false,
    patterns: [/(?:list|show|view)\s+(?:brand\s+)?templates?/i],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List brand templates.',
    handler: listBrandTemplatesHandler,
  },
  {
    action: 'list_scheduled_jobs',
    description: 'List scheduled jobs',
    destructive: false,
    patterns: [/(?:list|show|view)\s+(?:scheduled\s+)?jobs?/i, /cron\s+jobs?/i],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List scheduled jobs.',
    handler: listScheduledJobsHandler,
  },
  {
    action: 'trigger_scheduled_job',
    description: 'Trigger a scheduled job to run now',
    destructive: false,
    patterns: [/trigger\s+(?:job\s+)?(.+)/i, /run\s+(?:job\s+)?(.+)/i],
    extractParams: (_msg, match) => ({ jobName: (match?.[1] || '').trim() }),
    descriptionTemplate: (p) => `Trigger job "${String(p.jobName)}".`,
    handler: triggerJobHandler,
  },
  {
    action: 'trigger_data_export',
    description: 'Trigger a data export',
    destructive: false,
    patterns: [
      /(?:export|download)\s+(.+?)\s+(?:as\s+)?(csv|json|xlsx|excel)?/i,
      /trigger\s+(?:data\s+)?export/i,
    ],
    extractParams: (msg, match) => ({
      exportType: (match?.[1] || '').trim() || 'all',
      format: (match?.[2] || 'csv').toLowerCase().replace('excel', 'xlsx'),
    }),
    descriptionTemplate: (p) => `Export ${String(p.exportType)} as ${String((p as any).format || 'CSV').toUpperCase()}.`,
    handler: triggerDataExportHandler,
  },
];
