-- Feature Flags per school (toggle features without code deploy)
CREATE TABLE "SchoolFeatureFlag" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchoolFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- Global default brand templates (logo, favicon, colors for new schools)
CREATE TABLE "BrandTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT DEFAULT '#4F46E5',
    "secondaryColor" TEXT DEFAULT '#6366F1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandTemplate_pkey" PRIMARY KEY ("id")
);

-- Scheduled jobs registry
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cronExpression" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastRunError" TEXT,
    "lastRunDurationMs" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- Security events (failed logins, suspicious IPs, anomaly detection)
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "ipAddress" TEXT,
    "userId" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- API performance metrics (latency, error rates)
CREATE TABLE "ApiMetric" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "schoolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiMetric_pkey" PRIMARY KEY ("id")
);

-- Data export job records
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "filters" JSONB DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "fileSize" INTEGER,
    "rowCount" INTEGER,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- Database backup records
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "fileSize" INTEGER,
    "error" TEXT,
    "triggeredById" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- Constraints and indexes
ALTER TABLE "SchoolFeatureFlag" ADD CONSTRAINT "SchoolFeatureFlag_schoolId_featureKey_key" UNIQUE ("schoolId", "featureKey");
ALTER TABLE "SchoolFeatureFlag" ADD CONSTRAINT "SchoolFeatureFlag_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE;
CREATE INDEX "SchoolFeatureFlag_schoolId_idx" ON "SchoolFeatureFlag"("schoolId");
CREATE INDEX "SchoolFeatureFlag_featureKey_idx" ON "SchoolFeatureFlag"("featureKey");

CREATE INDEX "SecurityEvent_schoolId_idx" ON "SecurityEvent"("schoolId");
CREATE INDEX "SecurityEvent_eventType_idx" ON "SecurityEvent"("eventType");
CREATE INDEX "SecurityEvent_severity_idx" ON "SecurityEvent"("severity");
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");
CREATE INDEX "SecurityEvent_ipAddress_idx" ON "SecurityEvent"("ipAddress");
CREATE INDEX "SecurityEvent_userId_idx" ON "SecurityEvent"("userId");

CREATE INDEX "ApiMetric_createdAt_idx" ON "ApiMetric"("createdAt");
CREATE INDEX "ApiMetric_path_idx" ON "ApiMetric"("path");
CREATE INDEX "ApiMetric_statusCode_idx" ON "ApiMetric"("statusCode");
CREATE INDEX "ApiMetric_schoolId_idx" ON "ApiMetric"("schoolId");

CREATE INDEX "DataExport_createdById_idx" ON "DataExport"("createdById");
CREATE INDEX "DataExport_status_idx" ON "DataExport"("status");
CREATE INDEX "DataExport_createdAt_idx" ON "DataExport"("createdAt");

CREATE INDEX "BackupRecord_status_idx" ON "BackupRecord"("status");
CREATE INDEX "BackupRecord_triggeredAt_idx" ON "BackupRecord"("triggeredAt");

CREATE INDEX "ScheduledJob_enabled_idx" ON "ScheduledJob"("enabled");
CREATE INDEX "ScheduledJob_nextRunAt_idx" ON "ScheduledJob"("nextRunAt");
