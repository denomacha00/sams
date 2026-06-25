import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auditService } from '../services/auditService';
import { requirePermission } from '../middleware/rbac';
import { AppError } from '../middleware/errors';
import { superAdminFeaturesService } from '../services/superAdminFeaturesService';

// ─── Host Restriction Middleware (mirrors superAdmin.ts) ──────────────────────

function getAllowedSuperAdminHosts(): string[] {
  const fromEnv = process.env.SUPER_ADMIN_HOST || 'super.smart-managment.com';
  const hosts = fromEnv.split(',').map((h) => h.trim()).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    hosts.push('localhost', '127.0.0.1');
  }
  return [...new Set(hosts)];
}

function requireSuperAdminHost(req: Request, res: Response, next: NextFunction): void {
  const hostCheckDisabled = process.env.SUPER_ADMIN_HOST_CHECK === 'disabled';
  if (hostCheckDisabled) {
    next();
    return;
  }

  const allowedHosts = getAllowedSuperAdminHosts();
  const requestHost = req.hostname;

  if (!allowedHosts.includes(requestHost)) {
    res.status(403).json({
      error: 'Forbidden',
      code: 'HOST_NOT_ALLOWED',
      message:
        'Super Admin API must be reached via the Super Admin subdomain (same-origin /api proxy). ' +
        `Allowed Host: ${allowedHosts.join(', ')}. Received: ${requestHost}. ` +
        'Set SUPER_ADMIN_HOST on the API server or call /api from super.smart-managment.com, not api.smart-managment.com.',
    });
    return;
  }

  next();
}

// ─── Validation Schemas ───────────────────────────────────────────────────────

const setFeatureFlagSchema = z.object({
  featureKey: z.string().min(1),
  enabled: z.boolean(),
});

const triggerDataExportSchema = z.object({
  type: z.string().min(1),
  format: z.enum(['csv', 'xlsx']).default('csv'),
  filters: z.record(z.unknown()).optional(),
});

const updateScheduledJobSchema = z.object({
  enabled: z.boolean().optional(),
  cronExpression: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

const createBrandTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  primaryColor: z.string().optional(),
  logoUrl: z.string().optional(),
  theme: z.record(z.unknown()).optional(),
});

const updateBrandTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  primaryColor: z.string().optional(),
  logoUrl: z.string().optional(),
  theme: z.record(z.unknown()).optional(),
});

const applyBrandTemplateSchema = z.object({
  schoolId: z.string().min(1),
});

const batchExtendLicensesSchema = z.object({
  schoolIds: z.array(z.string()).min(1),
  daysToAdd: z.number().int().positive(),
});

const batchChangePlanSchema = z.object({
  schoolIds: z.array(z.string()).min(1),
  planTier: z.string().min(1),
});

const batchSuspendSchema = z.object({
  schoolIds: z.array(z.string()).min(1),
});

const batchUnsuspendSchema = z.object({
  schoolIds: z.array(z.string()).min(1),
});

const batchSendNotificationSchema = z.object({
  schoolIds: z.array(z.string()).min(1),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const superAdminFeaturesRouter = Router();

// All routes require super admin host AND super:admin permission
superAdminFeaturesRouter.use(requireSuperAdminHost);
superAdminFeaturesRouter.use(requirePermission('super:admin'));

// ─── Feature Flags ────────────────────────────────────────────────────────────
// GET /super/features/flags              - getAllFeatureFlags()
// GET /super/features/flags/:schoolId    - getFeatureFlags(schoolId)
// PUT /super/features/flags/:schoolId    - setFeatureFlag(schoolId, featureKey, enabled)

superAdminFeaturesRouter.get('/features/flags', async (_req: Request, res: Response): Promise<void> => {
  const flags = await superAdminFeaturesService.getAllFeatureFlags();
  res.json(flags);
});

superAdminFeaturesRouter.get('/features/flags/:schoolId', async (req: Request, res: Response): Promise<void> => {
  const { schoolId } = req.params as { schoolId: string };
  const flags = await superAdminFeaturesService.getFeatureFlags(schoolId);
  res.json(flags);
});

superAdminFeaturesRouter.put('/features/flags/:schoolId', async (req: Request, res: Response): Promise<void> => {
  const { schoolId } = req.params as { schoolId: string };
  const parsed = setFeatureFlagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const { featureKey, enabled } = parsed.data;
  const result = await superAdminFeaturesService.setFeatureFlag(schoolId, featureKey, enabled);
  res.json(result);
});

// ─── Performance ──────────────────────────────────────────────────────────────
// GET /super/performance/metrics         - getPerformanceMetrics(query.hours)
// GET /super/performance/health          - getSystemHealth()

superAdminFeaturesRouter.get('/performance/metrics', async (req: Request, res: Response): Promise<void> => {
  const hours = parseInt(req.query.hours as string, 10) || 24;
  const metrics = await superAdminFeaturesService.getPerformanceMetrics(hours);
  res.json(metrics);
});

superAdminFeaturesRouter.get('/performance/health', async (_req: Request, res: Response): Promise<void> => {
  const health = await superAdminFeaturesService.getSystemHealth();
  res.json(health);
});

// ─── Security ─────────────────────────────────────────────────────────────────
// GET /super/security/events             - getSecurityEvents(query)
// GET /super/security/summary            - getSecuritySummary(query.hours)

superAdminFeaturesRouter.get('/security/events', async (req: Request, res: Response): Promise<void> => {
  const query = req.query as Record<string, string>;
  const events = await superAdminFeaturesService.getSecurityEvents(query);
  res.json(events);
});

superAdminFeaturesRouter.get('/security/summary', async (req: Request, res: Response): Promise<void> => {
  const hours = parseInt(req.query.hours as string, 10) || 24;
  const summary = await superAdminFeaturesService.getSecuritySummary(hours);
  res.json(summary);
});

// ─── Revenue ──────────────────────────────────────────────────────────────────
// GET /super/revenue/forecast            - getRevenueForecast(query.months)

superAdminFeaturesRouter.get('/revenue/forecast', async (req: Request, res: Response): Promise<void> => {
  const months = parseInt(req.query.months as string, 10) || 12;
  const forecast = await superAdminFeaturesService.getRevenueForecast(months);
  res.json(forecast);
});

// ─── Data Exports ─────────────────────────────────────────────────────────────
// GET    /super/export/list              - listExports()
// POST   /super/export/trigger           - triggerDataExport(body)
// GET    /super/export/:id               - getExportStatus(req.params.id)

superAdminFeaturesRouter.get('/export/list', async (_req: Request, res: Response): Promise<void> => {
  const exports = await superAdminFeaturesService.listExports();
  res.json(exports);
});

superAdminFeaturesRouter.post('/export/trigger', async (req: Request, res: Response): Promise<void> => {
  const parsed = triggerDataExportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const result = await superAdminFeaturesService.triggerDataExport(parsed.data);
  res.status(201).json(result);
});

superAdminFeaturesRouter.get('/export/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const exportStatus = await superAdminFeaturesService.getExportStatus(id);
  if (!exportStatus) {
    res.status(404).json({ error: 'Export not found', code: 'NOT_FOUND' });
    return;
  }
  res.json(exportStatus);
});

// ─── Backups ──────────────────────────────────────────────────────────────────
// GET    /super/backup/list              - listBackups()
// POST   /super/backup/trigger           - triggerBackup(req.user.sub)
// GET    /super/backup/:id               - getBackupStatus(req.params.id)

superAdminFeaturesRouter.get('/backup/list', async (_req: Request, res: Response): Promise<void> => {
  const backups = await superAdminFeaturesService.listBackups();
  res.json(backups);
});

superAdminFeaturesRouter.post('/backup/trigger', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.sub as string;
  const result = await superAdminFeaturesService.triggerBackup(userId);
  res.status(201).json(result);
});

superAdminFeaturesRouter.get('/backup/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const backup = await superAdminFeaturesService.getBackupStatus(id);
  if (!backup) {
    res.status(404).json({ error: 'Backup not found', code: 'NOT_FOUND' });
    return;
  }
  res.json(backup);
});

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────
// GET    /super/jobs                        - getScheduledJobs()
// PUT    /super/jobs/:id                    - updateScheduledJob(req.params.id, body)
// POST   /super/jobs/:id/run                - runScheduledJobNow(req.params.id)

superAdminFeaturesRouter.get('/jobs', async (_req: Request, res: Response): Promise<void> => {
  const jobs = await superAdminFeaturesService.getScheduledJobs();
  res.json(jobs);
});

superAdminFeaturesRouter.put('/jobs/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const parsed = updateScheduledJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const result = await superAdminFeaturesService.updateScheduledJob(id, parsed.data);
  res.json(result);
});

superAdminFeaturesRouter.post('/jobs/:id/run', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const result = await superAdminFeaturesService.runScheduledJobNow(id);
  res.json(result);
});

// ─── Brand Templates ──────────────────────────────────────────────────────────
// GET    /super/brand-templates             - getBrandTemplates()
// POST   /super/brand-templates             - createBrandTemplate(body)
// PUT    /super/brand-templates/:id         - updateBrandTemplate(req.params.id, body)
// DELETE /super/brand-templates/:id         - deleteBrandTemplate(req.params.id)
// POST   /super/brand-templates/:id/apply   - applyBrandTemplateToSchool(req.params.id, body.schoolId)

superAdminFeaturesRouter.get('/brand-templates', async (_req: Request, res: Response): Promise<void> => {
  const templates = await superAdminFeaturesService.getBrandTemplates();
  res.json(templates);
});

superAdminFeaturesRouter.post('/brand-templates', async (req: Request, res: Response): Promise<void> => {
  const parsed = createBrandTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const template = await superAdminFeaturesService.createBrandTemplate(parsed.data);
  res.status(201).json(template);
});

superAdminFeaturesRouter.put('/brand-templates/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const parsed = updateBrandTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const template = await superAdminFeaturesService.updateBrandTemplate(id, parsed.data);
  if (!template) {
    res.status(404).json({ error: 'Brand template not found', code: 'NOT_FOUND' });
    return;
  }
  res.json(template);
});

superAdminFeaturesRouter.delete('/brand-templates/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const result = await superAdminFeaturesService.deleteBrandTemplate(id);
  if (!result) {
    res.status(404).json({ error: 'Brand template not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Brand template deleted successfully' });
});

superAdminFeaturesRouter.post('/brand-templates/:id/apply', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const parsed = applyBrandTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const result = await superAdminFeaturesService.applyBrandTemplateToSchool(id, parsed.data.schoolId);
  res.json(result);
});

// ─── Batch Operations ─────────────────────────────────────────────────────────
// POST /super/batch/extend-licenses       - batchExtendLicenses(body)
// POST /super/batch/change-plan           - batchChangePlan(body)
// POST /super/batch/suspend               - batchSuspend(body)
// POST /super/batch/unsuspend             - batchUnsuspend(body)
// POST /super/batch/send-notification     - batchSendNotification(body)

superAdminFeaturesRouter.post('/batch/extend-licenses', async (req: Request, res: Response): Promise<void> => {
  const parsed = batchExtendLicensesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const result = await superAdminFeaturesService.batchExtendLicenses(parsed.data);
  res.json(result);
});

superAdminFeaturesRouter.post('/batch/change-plan', async (req: Request, res: Response): Promise<void> => {
  const parsed = batchChangePlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const result = await superAdminFeaturesService.batchChangePlan(parsed.data);
  res.json(result);
});

superAdminFeaturesRouter.post('/batch/suspend', async (req: Request, res: Response): Promise<void> => {
  const parsed = batchSuspendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const result = await superAdminFeaturesService.batchSuspend(parsed.data);
  res.json(result);
});

superAdminFeaturesRouter.post('/batch/unsuspend', async (req: Request, res: Response): Promise<void> => {
  const parsed = batchUnsuspendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const result = await superAdminFeaturesService.batchUnsuspend(parsed.data);
  res.json(result);
});

superAdminFeaturesRouter.post('/batch/send-notification', async (req: Request, res: Response): Promise<void> => {
  const parsed = batchSendNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const result = await superAdminFeaturesService.batchSendNotification(parsed.data);
  res.json(result);
});

// ─── Activity & License Expiry ────────────────────────────────────────────────
// GET /super/activity/school-admins       - getSchoolAdminActivity(query.hours)
// GET /super/license-expiry/summary       - getExpiringLicenses(query.days)

superAdminFeaturesRouter.get('/activity/school-admins', async (req: Request, res: Response): Promise<void> => {
  const hours = parseInt(req.query.hours as string, 10) || 24;
  const activity = await superAdminFeaturesService.getSchoolAdminActivity(hours);
  res.json(activity);
});

superAdminFeaturesRouter.get('/license-expiry/summary', async (req: Request, res: Response): Promise<void> => {
  const days = parseInt(req.query.days as string, 10) || 30;
  const expiring = await superAdminFeaturesService.getExpiringLicenses(days);
  res.json(expiring);
});
