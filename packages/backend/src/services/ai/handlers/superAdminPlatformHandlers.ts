import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── PERFORMANCE METRICS ──────────────────────────────────────────────────────

const viewPerformanceMetricsHandler: ActionHandler = async () => {
  const { superAdminFeaturesService } = await import('../../superAdminFeaturesService');
  const metrics = await superAdminFeaturesService.getPerformanceMetrics(24);
  
  const lines: string[] = [
    `📊 **Performance Metrics** (last ${metrics.timeRangeHours}h)`,
    '',
    `• **Total Requests:** ${metrics.totalRequests.toLocaleString()}`,
    `• **Avg Response:** ${metrics.avgDurationMs.toFixed(1)} ms`,
    `• **Error Rate:** ${(metrics.errorRate ?? 0).toFixed(2)}%`,
    `• **p50:** ${metrics.p50Ms.toFixed(1)} ms`,
    `• **p95:** ${metrics.p95Ms.toFixed(1)} ms`,
    `• **p99:** ${metrics.p99Ms.toFixed(1)} ms`,
  ];

  if (metrics.byEndpoint && metrics.byEndpoint.length > 0) {
    lines.push('', '**Top Endpoints:**');
    metrics.byEndpoint.slice(0, 10).forEach((ep) => {
      lines.push(`  • ${ep.method} ${ep.path}: ${ep.count} calls, ${ep.avgDurationMs.toFixed(0)}ms avg`);
    });
  }

  return {
    answer: lines.join('\n'),
    data: metrics,
  };
};

// ─── SYSTEM HEALTH ────────────────────────────────────────────────────────────

const viewSystemHealthHandler: ActionHandler = async () => {
  const { superAdminFeaturesService } = await import('../../superAdminFeaturesService');
  const health = await superAdminFeaturesService.getSystemHealth();
  
  const statusEmoji = health.status === 'healthy' ? '✅' : health.status === 'degraded' ? '⚠️' : '🔴';
  const lines: string[] = [
    `${statusEmoji} **System Health**`,
    '',
    `• **Status:** ${health.status === 'healthy' ? 'All systems operational' : health.status === 'degraded' ? 'Degraded' : 'Unhealthy'}`,
    '',
    '**Services:**',
    `  • Database: ${health.database.connected ? '✅ Connected' : '❌ Disconnected'} (${health.database.latencyMs}ms)`,
    `  • API Error Rate: ${health.api.recentErrorRate}%`,
    `  • API Avg Latency: ${health.api.avgLatencyMs}ms`,
    `  • API Uptime: ${health.api.uptime}%`,
    '',
    '**Schools:**',
    `  • Total: ${health.schools.total}`,
    `  • Active: ${health.schools.active}`,
    `  • Suspended: ${health.schools.suspended}`,
    `  • Expired: ${health.schools.expired}`,
  ];

  return {
    answer: lines.join('\n'),
    data: health,
  };
};

// ─── LIST BACKUPS ─────────────────────────────────────────────────────────────

const listBackupsHandler: ActionHandler = async () => {
  const { superAdminFeaturesService } = await import('../../superAdminFeaturesService');
  const backups = await superAdminFeaturesService.listBackups();
  
  if (backups.length === 0) {
    return { answer: 'No backups found. Say **trigger backup** to create one.', data: [] };
  }

  const lines = backups.slice(0, 20).map((b: any) => {
    const size = b.fileSize ? `${(b.fileSize / 1024 / 1024).toFixed(1)} MB` : '—';
    const statusEmoji = b.status === 'COMPLETED' ? '✅' : b.status === 'FAILED' ? '❌' : '⏳';
    const completed = b.completedAt ? new Date(b.completedAt).toLocaleString() : '—';
    return `${statusEmoji} **${b.status}** — ${size} — ${new Date(b.triggeredAt).toLocaleString()} — complete: ${completed}`;
  });

  return {
    answer: `💾 **Backups** (${backups.length})\n\n${lines.join('\n')}`,
    data: { backups },
  };
};

// ─── TRIGGER BACKUP ───────────────────────────────────────────────────────────

const triggerBackupHandler: ActionHandler = async (_params, scope) => {
  const { superAdminFeaturesService } = await import('../../superAdminFeaturesService');
  const result = await superAdminFeaturesService.triggerBackup(scope.userId);
  
  return {
    answer: `✅ Backup triggered (ID: ${result.id}). It will process in the background. Say **list backups** to check status.`,
    data: { backupId: result.id },
  };
};

// ─── LICENSE EXPIRY SUMMARY ───────────────────────────────────────────────────

const viewLicenseExpirySummaryHandler: ActionHandler = async (params) => {
  const { prisma } = await import('../../../index');
  const { superAdminFeaturesService } = await import('../../superAdminFeaturesService');
  const lookaheadDays = (params.lookaheadDays as number) || 30;

  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + lookaheadDays);

  const schools = await prisma.school.findMany({
    where: { licenseExpiresAt: { lte: future } },
    select: {
      id: true,
      name: true,
      schoolCode: true,
      planTier: true,
      licenseExpiresAt: true,
      isSuspended: true,
    },
    orderBy: { licenseExpiresAt: 'asc' },
  });

  const expired = schools.filter((s) => s.licenseExpiresAt <= now);
  const warning = schools.filter((s) => {
    const days = Math.ceil((s.licenseExpiresAt.getTime() - now.getTime()) / 86400000);
    return days > 0 && days <= 7;
  });
  const upcoming = schools.filter((s) => {
    const days = Math.ceil((s.licenseExpiresAt.getTime() - now.getTime()) / 86400000);
    return days > 7;
  });

  const lines: string[] = [
    `📋 **License Expiry Summary** (${lookaheadDays}-day lookahead)`,
    '',
    `🔴 **Expired:** ${expired.length}`,
    `🟡 **Expiring within 7 days:** ${warning.length}`,
    `🟢 **Upcoming:** ${upcoming.length}`,
    '',
  ];

  if (schools.length === 0) {
    lines.push('No schools expiring within this period.');
  } else {
    lines.push('**Schools by Expiry:**');
    schools.forEach((s) => {
      const daysLeft = Math.ceil((s.licenseExpiresAt.getTime() - now.getTime()) / 86400000);
      const emoji = daysLeft <= 0 ? '🔴' : daysLeft <= 7 ? '🟡' : '🟢';
      const name = s.name;
      lines.push(`${emoji} **${name}** (${s.schoolCode}) — ${s.planTier} — ${daysLeft <= 0 ? 'EXPIRED' : `${daysLeft}d left`}${s.isSuspended ? ' [SUSPENDED]' : ''}`);
    });
  }

  return {
    answer: lines.join('\n'),
    data: { expired: expired.length, warning: warning.length, upcoming: upcoming.length, schools },
  };
};

// ─── ACTION DEFINITIONS ───────────────────────────────────────────────────────

export const superAdminPlatformActions: ActionDefinition[] = [
  {
    action: 'view_performance_metrics',
    description: 'View API performance metrics (response times, error rates, top endpoints)',
    destructive: false,
    patterns: [
      /(?:performance|response\s*time|latency|api\s*metrics)/i,
      /how\s+(?:fast|quick|slow)\s+(?:is\s+)?(?:the\s+)?(?:api|system|platform)/i,
      /(?:api|system|platform|server)\s+(?:metrics|stats|performance)/i,
      /slow\s+(?:requests|endpoints|api)/i,
      /error\s+rate/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View API performance metrics.',
    handler: viewPerformanceMetricsHandler,
  },
  {
    action: 'view_system_health',
    description: 'View complete system health status (database, API, schools)',
    destructive: false,
    patterns: [
      /(?:system|platform|server)\s+(?:health|status|diagnostic)/i,
      /(?:health|status)\s+(?:check|overview)/i,
      /is\s+(?:everything|the\s+system|the\s+platform)\s+(?:ok|up|running|healthy)/i,
      /database\s+(?:status|health|ok)/i,
      /how\s+(?:is|are)\s+(?:the\s+)?(?:platform|server|system)\s+(?:doing|running|performing)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View system health status.',
    handler: viewSystemHealthHandler,
  },
  {
    action: 'list_backups',
    description: 'List all database backups with status, size, and timestamps',
    destructive: false,
    patterns: [
      /(?:list|show|view)\s+(?:database\s+)?backups?/i,
      /backup\s+(?:list|history|status)/i,
      /what\s+(?:backups?|database\s+copies)\s+(?:are\s+)?(?:there|available)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List database backups.',
    handler: listBackupsHandler,
  },
  {
    action: 'trigger_backup',
    description: 'Trigger a new database backup immediately',
    destructive: false,
    patterns: [
      /(?:trigger|create|make|start|run)\s+(?:a\s+)?(?:database\s+)?backup/i,
      /back\s+up\s+(?:the\s+)?(?:database|system|platform)/i,
      /take\s+(?:a\s+)?(?:database\s+)?(?:backup|snapshot|dump)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'Trigger a database backup.',
    handler: triggerBackupHandler,
  },
  {
    action: 'view_license_expiry_summary',
    description: 'View license expiry summary — expired, at-risk, and upcoming schools',
    destructive: false,
    patterns: [
      /(?:license|licence)\s+(?:expir|expri)/i,
      /(?:expiring|expired)\s+(?:licenses?|schools?)/i,
      /which\s+schools?\s+(?:are\s+)?(?:expiring|expired|about\s+to\s+expire)/i,
      /license\s+expiry\s+(?:summary|report|check|overview)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View license expiry summary.',
    handler: viewLicenseExpirySummaryHandler,
  },
];
