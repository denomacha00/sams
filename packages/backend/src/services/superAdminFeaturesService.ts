import { PlanTier } from '@sams/shared';
import { prisma } from '../lib/prisma';
import { auditService } from './auditService';
import { notificationService } from './notificationService';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FeatureFlag {
  id: string;
  schoolId: string;
  featureKey: string;
  enabled: boolean;
  updatedAt: Date;
}

interface ExpiringLicense {
  id: string;
  name: string;
  schoolCode: string;
  planTier: PlanTier;
  licenseExpiresAt: Date;
  isSuspended: boolean;
  isReadOnly: boolean;
  daysUntilExpiry: number;
}

interface PerformanceMetrics {
  totalRequests: number;
  avgDurationMs: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  byEndpoint: Array<{
    path: string;
    method: string;
    count: number;
    avgDurationMs: number;
    errorRate: number;
  }>;
  timeRangeHours: number;
  sampledPeriod: { from: Date; to: Date };
}

interface SecurityEventFilter {
  severity?: string;
  eventType?: string;
  hours?: number;
}

interface SecuritySummary {
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  recentCount: number;
  timeRangeHours: number;
}

interface RevenueForecast {
  currentMRR: number;
  projectedMRR: number;
  mrrGrowth: number;
  churnRisk: number;
  trend: 'up' | 'down' | 'stable';
  monthlyBreakdown: Array<{
    month: string;
    projectedRevenue: number;
    activeSchools: number;
    churnedSchools: number;
  }>;
}

interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: { connected: boolean; latencyMs: number };
  api: { recentErrorRate: number; avgLatencyMs: number; uptime: number };
  schools: { total: number; active: number; suspended: number; expired: number };
}

// ─── Error Helper ───────────────────────────────────────────────────────────

class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export class SuperAdminFeaturesService {
  // ── Feature Flags ─────────────────────────────────────────────────────────

  async getFeatureFlags(schoolId: string): Promise<FeatureFlag[]> {
    return prisma.schoolFeatureFlag.findMany({
      where: { schoolId },
      orderBy: { featureKey: 'asc' },
    }) as unknown as FeatureFlag[];
  }

  async setFeatureFlag(
    schoolId: string,
    featureKey: string,
    enabled: boolean,
  ): Promise<FeatureFlag> {
    const flag = await prisma.schoolFeatureFlag.upsert({
      where: {
        schoolId_featureKey: { schoolId, featureKey },
      },
      update: { enabled, updatedAt: new Date() },
      create: { schoolId, featureKey, enabled },
    });

    await auditService.log({
      eventType: 'FEATURE_FLAG_UPDATED' as any,
      schoolId,
      resourceSnapshot: {
        featureKey,
        enabled,
        action: 'FEATURE_FLAG_SET',
      },
    });

    return flag as unknown as FeatureFlag;
  }

  async getAllFeatureFlags(): Promise<
    Array<{
      schoolId: string;
      schoolName: string;
      flags: FeatureFlag[];
    }>
  > {
    const schools = await prisma.school.findMany({
      select: { id: true, name: true },
    });

    const flags = await prisma.schoolFeatureFlag.findMany({
      orderBy: [{ schoolId: 'asc' }, { featureKey: 'asc' }],
    });

    const grouped: Record<string, { schoolName: string; flags: FeatureFlag[] }> = {};
    for (const school of schools) {
      grouped[school.id] = { schoolName: school.name, flags: [] };
    }
    for (const flag of flags) {
      if (grouped[flag.schoolId]) {
        grouped[flag.schoolId].flags.push(flag as unknown as FeatureFlag);
      }
    }

    return Object.entries(grouped).map(([schoolId, data]) => ({
      schoolId,
      schoolName: data.schoolName,
      flags: data.flags,
    }));
  }

  // ── License Monitoring ────────────────────────────────────────────────────

  async getExpiringLicenses(days: number): Promise<ExpiringLicense[]> {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const schools = await prisma.school.findMany({
      where: {
        licenseExpiresAt: { gte: now, lte: future },
      },
      select: {
        id: true,
        name: true,
        schoolCode: true,
        planTier: true,
        licenseExpiresAt: true,
        isSuspended: true,
        isReadOnly: true,
      },
      orderBy: { licenseExpiresAt: 'asc' },
    });

    return schools.map((s) => ({
      ...s,
      planTier: s.planTier as PlanTier,
      daysUntilExpiry: Math.ceil(
        (s.licenseExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      ),
    }));
  }

  // ── Performance Metrics ───────────────────────────────────────────────────

  async getPerformanceMetrics(hours: number): Promise<PerformanceMetrics> {
    const now = new Date();
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const overall = await prisma.$queryRaw<
      Array<{
        total: bigint;
        avg_duration: number;
        error_count: bigint;
        p50: number;
        p95: number;
        p99: number;
      }>
    >`
      SELECT
        COUNT(*)::bigint AS total,
        COALESCE(AVG("durationMs"), 0) AS avg_duration,
        SUM(CASE WHEN "statusCode" >= 500 THEN 1 ELSE 0 END)::bigint AS error_count,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "durationMs") AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "durationMs") AS p99
      FROM "ApiMetric"
      WHERE "createdAt" >= ${from}
    `;

    const row = overall[0];

    const byEndpoint = await prisma.$queryRaw<
      Array<{
        path: string;
        method: string;
        count: bigint;
        avg_duration: number;
        error_count: bigint;
      }>
    >`
      SELECT
        "path",
        "method",
        COUNT(*)::bigint AS count,
        COALESCE(AVG("durationMs"), 0) AS avg_duration,
        SUM(CASE WHEN "statusCode" >= 500 THEN 1 ELSE 0 END)::bigint AS error_count
      FROM "ApiMetric"
      WHERE "createdAt" >= ${from}
      GROUP BY "path", "method"
      ORDER BY count DESC
    `;

    const totalRequests = Number(row?.total ?? 0);
    const errorCount = Number(row?.error_count ?? 0);

    return {
      totalRequests,
      avgDurationMs: Math.round(Number(row?.avg_duration ?? 0) * 100) / 100,
      errorRate: totalRequests > 0 ? Math.round((errorCount / totalRequests) * 10000) / 100 : 0,
      p50Ms: Math.round(Number(row?.p50 ?? 0) * 100) / 100,
      p95Ms: Math.round(Number(row?.p95 ?? 0) * 100) / 100,
      p99Ms: Math.round(Number(row?.p99 ?? 0) * 100) / 100,
      byEndpoint: byEndpoint.map((e) => ({
        path: e.path,
        method: e.method,
        count: Number(e.count),
        avgDurationMs: Math.round(Number(e.avg_duration) * 100) / 100,
        errorRate:
          Number(e.count) > 0
            ? Math.round((Number(e.error_count) / Number(e.count)) * 10000) / 100
            : 0,
      })),
      timeRangeHours: hours,
      sampledPeriod: { from, to: now },
    };
  }

  async recordApiMetric(
    path: string,
    method: string,
    statusCode: number,
    durationMs: number,
    schoolId?: string,
  ): Promise<void> {
    await prisma.apiMetric.create({
      data: { path, method, statusCode, durationMs, schoolId: schoolId ?? null },
    });
  }

  // ── Security Events ───────────────────────────────────────────────────────

  async getSecurityEvents(
    filters?: SecurityEventFilter,
  ): Promise<{ events: any[]; count: number }> {
    const where: any = {};

    if (filters?.severity) {
      where.severity = filters.severity;
    }
    if (filters?.eventType) {
      where.eventType = filters.eventType;
    }
    if (filters?.hours) {
      const from = new Date(Date.now() - filters.hours * 60 * 60 * 1000);
      where.createdAt = { gte: from };
    }

    const [events, count] = await Promise.all([
      prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.securityEvent.count({ where }),
    ]);

    return { events, count };
  }

  async recordSecurityEvent(
    schoolId?: string,
    eventType?: string,
    severity?: string,
    ipAddress?: string,
    userId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await prisma.securityEvent.create({
      data: {
        schoolId: schoolId ?? null,
        eventType: eventType ?? 'UNKNOWN',
        severity: severity ?? 'INFO',
        ipAddress: ipAddress ?? null,
        userId: userId ?? null,
        metadata: (metadata ?? {}) as any,
      },
    });
  }

  async getSecuritySummary(hours: number): Promise<SecuritySummary> {
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);

    const events = await prisma.securityEvent.findMany({
      where: { createdAt: { gte: from } },
      select: { eventType: true, severity: true },
    });

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const event of events) {
      byType[event.eventType] = (byType[event.eventType] ?? 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
    }

    return {
      byType,
      bySeverity,
      recentCount: events.length,
      timeRangeHours: hours,
    };
  }

  // ── Revenue Forecasting ───────────────────────────────────────────────────

  async getRevenueForecast(months: number): Promise<RevenueForecast> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const schools = await prisma.school.findMany({
      select: { id: true, name: true, planTier: true, licenseExpiresAt: true, isSuspended: true },
    });

    const tierPriceMap: Record<string, number> = {
      TRIAL: 0,
      BASIC: 5000,
      PROFESSIONAL: 15000,
      ENTERPRISE: 50000,
    };

    const activeSchools = schools.filter(
      (s) => !s.isSuspended && s.licenseExpiresAt > now,
    );
    const currentMRR = activeSchools.reduce(
      (sum, s) => sum + (tierPriceMap[s.planTier] ?? 0),
      0,
    );

    const monthlyBreakdown: RevenueForecast['monthlyBreakdown'] = [];
    let churnedSchools = 0;
    const churnRiskSchools = schools.filter(
      (s) => !s.isSuspended && s.licenseExpiresAt <= new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    );

    for (let i = 0; i < months; i++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthLabel = monthDate.toISOString().slice(0, 7);

      const monthStart = new Date(monthDate);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

      const expiringThisMonth = schools.filter(
        (s) =>
          !s.isSuspended &&
          s.licenseExpiresAt >= monthStart &&
          s.licenseExpiresAt <= monthEnd,
      );

      const remainingSchools =
        activeSchools.length - churnedSchools - Math.floor(expiringThisMonth.length * 0.7);

      const projectedRevenue = remainingSchools * (currentMRR / Math.max(activeSchools.length, 1));

      monthlyBreakdown.push({
        month: monthLabel,
        projectedRevenue: Math.round(projectedRevenue),
        activeSchools: remainingSchools,
        churnedSchools: churnedSchools + Math.floor(expiringThisMonth.length * 0.7),
      });

      churnedSchools += Math.floor(expiringThisMonth.length * 0.7);
    }

    const projectedMRR = monthlyBreakdown[months - 1]?.projectedRevenue ?? currentMRR;
    const mrrGrowth = currentMRR > 0 ? ((projectedMRR - currentMRR) / currentMRR) * 100 : 0;

    const churnRisk =
      activeSchools.length > 0
        ? Math.round((churnRiskSchools.length / activeSchools.length) * 10000) / 100
        : 0;

    const trend = mrrGrowth > 5 ? 'up' : mrrGrowth < -5 ? 'down' : 'stable';

    return {
      currentMRR,
      projectedMRR: Math.round(projectedMRR),
      mrrGrowth: Math.round(mrrGrowth * 100) / 100,
      churnRisk,
      trend,
      monthlyBreakdown,
    };
  }

  // ── School Admin Activity ─────────────────────────────────────────────────

  async getSchoolAdminActivity(hours: number): Promise<any[]> {
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);

    return prisma.auditLog.findMany({
      where: {
        actorRole: 'SCHOOL_ADMIN',
        createdAt: { gte: from },
      },
      include: {
        school: { select: { name: true } },
        actor: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ── Data Exports ──────────────────────────────────────────────────────────

  async triggerDataExport(data: {
    type: string;
    format?: string;
    filters?: Record<string, unknown>;
  }): Promise<any> {
    return prisma.dataExport.create({
      data: {
        exportType: data.type,
        format: data.format ?? 'csv',
        filters: (data.filters ?? {}) as any,
        status: 'PENDING',
      },
    });
  }

  async getExportStatus(exportId: string): Promise<any> {
    const exportRecord = await prisma.dataExport.findUnique({
      where: { id: exportId },
    });
    if (!exportRecord) {
      throw new AppError('NOT_FOUND', 'Export not found', 404);
    }
    return exportRecord;
  }

  async listExports(): Promise<any[]> {
    return prisma.dataExport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── Backups ───────────────────────────────────────────────────────────────

  async triggerBackup(triggeredById: string): Promise<any> {
    return prisma.backupRecord.create({
      data: {
        status: 'PENDING',
        triggeredById,
      },
    });
  }

  async getBackupStatus(backupId: string): Promise<any> {
    const backup = await prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!backup) {
      throw new AppError('NOT_FOUND', 'Backup not found', 404);
    }
    return backup;
  }

  async listBackups(): Promise<any[]> {
    return prisma.backupRecord.findMany({
      orderBy: { triggeredAt: 'desc' },
      take: 50,
    });
  }

  // ── Scheduled Jobs ────────────────────────────────────────────────────────

  async getScheduledJobs(): Promise<any[]> {
    return prisma.scheduledJob.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async updateScheduledJob(
    jobId: string,
    data: {
      enabled?: boolean;
      cronExpression?: string;
      description?: string;
    },
  ): Promise<any> {
    const job = await prisma.scheduledJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new AppError('NOT_FOUND', 'Scheduled job not found', 404);
    }

    return prisma.scheduledJob.update({
      where: { id: jobId },
      data: {
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.cronExpression !== undefined && { cronExpression: data.cronExpression }),
        ...(data.description !== undefined && { description: data.description }),
        updatedAt: new Date(),
      },
    });
  }

  async runScheduledJobNow(jobId: string): Promise<any> {
    const job = await prisma.scheduledJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new AppError('NOT_FOUND', 'Scheduled job not found', 404);
    }

    const start = Date.now();

    return prisma.scheduledJob.update({
      where: { id: jobId },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: 'RUNNING',
        lastRunDurationMs: 0,
        updatedAt: new Date(),
      },
    });
  }

  // ── Brand Templates ───────────────────────────────────────────────────────

  async getBrandTemplates(): Promise<any[]> {
    return prisma.brandTemplate.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createBrandTemplate(data: {
    name: string;
    logoUrl?: string;
    faviconUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
  }): Promise<any> {
    return prisma.brandTemplate.create({ data });
  }

  async updateBrandTemplate(
    id: string,
    data: {
      name?: string;
      logoUrl?: string;
      faviconUrl?: string;
      primaryColor?: string;
      secondaryColor?: string;
      isActive?: boolean;
    },
  ): Promise<any> {
    const existing = await prisma.brandTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Brand template not found', 404);
    }
    return prisma.brandTemplate.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  async applyBrandTemplateToSchool(
    templateId: string,
    schoolId: string,
  ): Promise<any> {
    const template = await prisma.brandTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      throw new AppError('NOT_FOUND', 'Brand template not found', 404);
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      throw new AppError('NOT_FOUND', 'School not found', 404);
    }

    return prisma.school.update({
      where: { id: schoolId },
      data: {
        logoUrl: template.logoUrl ?? school.logoUrl,
        primaryColor: template.primaryColor ?? school.primaryColor,
      },
    });
  }

  async deleteBrandTemplate(id: string): Promise<boolean> {
    const existing = await prisma.brandTemplate.findUnique({ where: { id } });
    if (!existing) {
      return false;
    }
    await prisma.brandTemplate.delete({ where: { id } });
    return true;
  }

  // ── Batch Operations ─────────────────────────────────────────────────────

  async batchExtendLicenses(data: {
    schoolIds: string[];
    daysToAdd: number;
  }): Promise<{ updated: number }> {
    const now = new Date();
    const extensionMs = data.daysToAdd * 24 * 60 * 60 * 1000;

    // For each school, add the days to their current expiry
    const schools = await prisma.school.findMany({
      where: { id: { in: data.schoolIds } },
      select: { id: true, licenseExpiresAt: true, name: true },
    });

    let updated = 0;
    for (const school of schools) {
      const baseDate = school.licenseExpiresAt > now ? school.licenseExpiresAt : now;
      const newExpiry = new Date(baseDate.getTime() + extensionMs);

      await prisma.school.update({
        where: { id: school.id },
        data: {
          licenseExpiresAt: newExpiry,
          isReadOnly: false,
        },
      });
      updated++;

      await auditService.log({
        eventType: 'LICENSE_ACTIVATION' as any,
        schoolId: school.id,
        resourceSnapshot: {
          action: 'BATCH_LICENSE_EXTEND',
          daysExtended: data.daysToAdd,
          schoolName: school.name,
        },
      });
    }

    return { updated };
  }

  async batchChangePlan(data: {
    schoolIds: string[];
    planTier: string;
  }): Promise<{ updated: number }> {
    const result = await prisma.school.updateMany({
      where: { id: { in: data.schoolIds } },
      data: { planTier: data.planTier as PlanTier },
    });

    return { updated: result.count };
  }

  async batchSuspend(data: {
    schoolIds: string[];
  }): Promise<{ updated: number }> {
    const result = await prisma.school.updateMany({
      where: { id: { in: data.schoolIds } },
      data: { isSuspended: true },
    });

    // Revoke all active sessions for these schools
    await prisma.attendanceSession.updateMany({
      where: {
        schoolId: { in: data.schoolIds },
        isActive: true,
      },
      data: { isActive: false },
    });

    return { updated: result.count };
  }

  async batchUnsuspend(data: {
    schoolIds: string[];
  }): Promise<{ updated: number }> {
    const result = await prisma.school.updateMany({
      where: { id: { in: data.schoolIds } },
      data: { isSuspended: false },
    });

    return { updated: result.count };
  }

  async batchSendNotification(data: {
    schoolIds: string[];
    title: string;
    message: string;
  }): Promise<{ sent: number }> {
    // Find all users (not just admins) in those schools
    const users = await prisma.user.findMany({
      where: {
        schoolId: { in: data.schoolIds },
        role: { not: 'SUPER_ADMIN' as any },
      },
      select: { id: true, schoolId: true },
    });

    for (const user of users) {
      await notificationService.sendInApp(user.id, {
        title: data.title,
        message: data.message,
        type: 'MESSAGE',
      });
    }

    return { sent: users.length };
  }

  // ── System Health ─────────────────────────────────────────────────────────

  async getSystemHealth(detailed: boolean = false): Promise<SystemHealth> {
    const now = new Date();

    let dbConnected = false;
    let dbLatency = -1;
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - dbStart;
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const recentMetrics = await prisma.apiMetric.findMany({
      where: { createdAt: { gte: fiveMinAgo } },
    });

    const totalRecent = recentMetrics.length;
    const errorsRecent = recentMetrics.filter((m) => m.statusCode >= 500).length;
    const avgLatency =
      totalRecent > 0
        ? recentMetrics.reduce((sum, m) => sum + m.durationMs, 0) / totalRecent
        : 0;

    const errorRate = totalRecent > 0 ? (errorsRecent / totalRecent) * 100 : 0;

    const [totalSchools, activeSchools, suspendedSchools, expiredSchools] =
      await Promise.all([
        prisma.school.count(),
        prisma.school.count({
          where: { isSuspended: false, licenseExpiresAt: { gte: now } },
        }),
        prisma.school.count({ where: { isSuspended: true } }),
        prisma.school.count({ where: { licenseExpiresAt: { lt: now } } }),
      ]);

    const status: SystemHealth['status'] = !dbConnected
      ? 'unhealthy'
      : errorRate > 10 || dbLatency > 1000
        ? 'degraded'
        : 'healthy';

    return {
      status,
      database: { connected: dbConnected, latencyMs: dbLatency },
      api: {
        recentErrorRate: Math.round(errorRate * 100) / 100,
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
        uptime: dbConnected ? 100 : 0,
      },
      schools: {
        total: totalSchools,
        active: activeSchools,
        suspended: suspendedSchools,
        expired: expiredSchools,
      },
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const superAdminFeaturesService = new SuperAdminFeaturesService();
