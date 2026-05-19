"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.superAdminRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const crypto_1 = require("crypto");
const shared_1 = require("@sams/shared");
const shared_2 = require("@sams/shared");
const index_1 = require("../index");
const licenseService_1 = require("../services/licenseService");
const auditService_1 = require("../services/auditService");
const rbac_1 = require("../middleware/rbac");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const generateLicenseSchema = zod_1.z.object({
    schoolName: zod_1.z.string().min(2).max(100),
    planTier: zod_1.z.nativeEnum(shared_1.PlanTier),
    expiresAt: zod_1.z.string().datetime(),
});
const extendLicenseSchema = zod_1.z.object({
    newExpiry: zod_1.z.string().datetime(),
});
// ─── Host Restriction Middleware ──────────────────────────────────────────────
// Requirement 2.4, 15.1: Super Admin panel is accessible only via super.sams.ke.
// In development/testing, the SUPER_ADMIN_HOST env var can override the allowed host.
// If SUPER_ADMIN_HOST_CHECK is set to "disabled", the check is skipped entirely
// (useful for local development and testing).
function requireSuperAdminHost(req, res, next) {
    const hostCheckDisabled = process.env.SUPER_ADMIN_HOST_CHECK === 'disabled';
    if (hostCheckDisabled) {
        next();
        return;
    }
    const allowedHost = process.env.SUPER_ADMIN_HOST || 'super.sams.ke';
    const requestHost = req.hostname;
    if (requestHost !== allowedHost) {
        res.status(403).json({
            error: 'Forbidden',
            code: 'HOST_NOT_ALLOWED',
            message: 'Super Admin routes are only accessible via the Super Admin panel.',
        });
        return;
    }
    next();
}
// ─── Router ───────────────────────────────────────────────────────────────────
exports.superAdminRouter = (0, express_1.Router)();
// Task 22.2: Restrict all /super/* routes to SUPER_ADMIN role AND super.sams.ke host
exports.superAdminRouter.use(requireSuperAdminHost);
exports.superAdminRouter.use((0, rbac_1.requirePermission)('super:admin'));
// ─── POST /super/licenses — Generate a new license key ────────────────────────
exports.superAdminRouter.post('/licenses', async (req, res) => {
    const parsed = generateLicenseSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    const { schoolName, planTier, expiresAt } = parsed.data;
    const expiryDate = new Date(expiresAt);
    const secret = process.env.LICENSE_SECRET || process.env.JWT_SECRET || 'default-license-secret';
    // Generate the raw license key
    const rawKey = (0, shared_2.encodeLicenseKey)({ schoolName, planTier: planTier, expiresAt: expiryDate }, secret);
    // Store SHA-256 hash of the key (raw key is never stored)
    const keyHash = (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
    await index_1.prisma.licenseKey.create({
        data: {
            keyHash,
            planTier,
            schoolName,
            expiresAt: expiryDate,
        },
    });
    // Audit log
    await auditService_1.auditService.log({
        eventType: 'LICENSE_ACTIVATION',
        actorId: req.user?.sub,
        actorRole: req.user?.role,
        resourceSnapshot: {
            action: 'LICENSE_GENERATED',
            schoolName,
            planTier,
            expiresAt: expiryDate.toISOString(),
        },
    });
    // Return raw key once — it cannot be retrieved again
    res.status(201).json({
        licenseKey: rawKey,
        schoolName,
        planTier,
        expiresAt: expiryDate.toISOString(),
        message: 'License key generated. Store it securely — it cannot be retrieved again.',
    });
});
// ─── GET /super/licenses — List all license keys ──────────────────────────────
exports.superAdminRouter.get('/licenses', async (req, res) => {
    const { planTier, used, expired } = req.query;
    const where = {};
    if (planTier && typeof planTier === 'string') {
        where.planTier = planTier;
    }
    if (used === 'true') {
        where.usedAt = { not: null };
    }
    else if (used === 'false') {
        where.usedAt = null;
    }
    if (expired === 'true') {
        where.expiresAt = { lt: new Date() };
    }
    else if (expired === 'false') {
        where.expiresAt = { gte: new Date() };
    }
    const licenses = await index_1.prisma.licenseKey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            planTier: true,
            schoolName: true,
            expiresAt: true,
            usedAt: true,
            usedBySchoolId: true,
            createdAt: true,
        },
    });
    res.json({ licenses, count: licenses.length });
});
// ─── POST /super/licenses/:id/revoke — Revoke a license key ──────────────────
exports.superAdminRouter.post('/licenses/:id/revoke', async (req, res) => {
    const licenseId = req.params.id;
    const license = await index_1.prisma.licenseKey.findUnique({
        where: { id: licenseId },
    });
    if (!license) {
        res.status(404).json({ error: 'License key not found', code: 'NOT_FOUND' });
        return;
    }
    if (license.usedAt) {
        res.status(400).json({
            error: 'Cannot revoke a license key that has already been used',
            code: 'LICENSE_ALREADY_USED',
        });
        return;
    }
    await index_1.prisma.licenseKey.delete({
        where: { id: licenseId },
    });
    // Audit log
    await auditService_1.auditService.log({
        eventType: 'LICENSE_ACTIVATION',
        actorId: req.user?.sub,
        actorRole: req.user?.role,
        resourceSnapshot: {
            action: 'LICENSE_REVOKED',
            licenseId,
            schoolName: license.schoolName,
            planTier: license.planTier,
            revokedAt: new Date().toISOString(),
        },
    });
    res.json({ message: 'License key revoked successfully', licenseId });
});
// ─── GET /super/analytics — System-wide analytics ─────────────────────────────
exports.superAdminRouter.get('/analytics', async (_req, res) => {
    const [totalSchools, totalStudents, activeSessions, totalTeachers, totalUsers] = await Promise.all([
        index_1.prisma.school.count(),
        index_1.prisma.user.count({ where: { role: 'STUDENT' } }),
        index_1.prisma.attendanceSession.count({ where: { isActive: true } }),
        index_1.prisma.user.count({ where: { role: 'TEACHER' } }),
        index_1.prisma.user.count(),
    ]);
    const schoolsByPlan = await index_1.prisma.school.groupBy({
        by: ['planTier'],
        _count: { id: true },
    });
    const suspendedSchools = await index_1.prisma.school.count({ where: { isSuspended: true } });
    const expiredSchools = await index_1.prisma.school.count({
        where: { licenseExpiresAt: { lt: new Date() } },
    });
    res.json({
        totalSchools,
        totalStudents,
        totalTeachers,
        totalUsers,
        activeSessions,
        suspendedSchools,
        expiredSchools,
        schoolsByPlan: schoolsByPlan.map((g) => ({
            planTier: g.planTier,
            count: g._count.id,
        })),
    });
});
// ─── GET /super/schools — List all schools with stats ─────────────────────────
exports.superAdminRouter.get('/schools', async (_req, res) => {
    const schools = await index_1.prisma.school.findMany({
        include: {
            _count: {
                select: {
                    users: true,
                    sessions: true,
                },
            },
        },
        orderBy: { createdAt: 'desc' },
    });
    const result = schools.map((school) => ({
        id: school.id,
        name: school.name,
        schoolCode: school.schoolCode,
        planTier: school.planTier,
        licenseExpiresAt: school.licenseExpiresAt,
        isSuspended: school.isSuspended,
        isReadOnly: school.isReadOnly,
        createdAt: school.createdAt,
        stats: {
            totalUsers: school._count.users,
            totalSessions: school._count.sessions,
        },
    }));
    res.json({ schools: result });
});
// ─── GET /super/schools/:id — Get school details ──────────────────────────────
exports.superAdminRouter.get('/schools/:id', async (req, res) => {
    const schoolId = req.params.id;
    const school = await index_1.prisma.school.findUnique({
        where: { id: schoolId },
        include: {
            _count: {
                select: {
                    users: true,
                    sessions: true,
                    payments: true,
                },
            },
            payments: {
                where: { status: 'SUCCESS' },
                orderBy: { completedAt: 'desc' },
                take: 5,
            },
        },
    });
    if (!school) {
        res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
        return;
    }
    res.json({
        id: school.id,
        name: school.name,
        schoolCode: school.schoolCode,
        planTier: school.planTier,
        licenseExpiresAt: school.licenseExpiresAt,
        isSuspended: school.isSuspended,
        isReadOnly: school.isReadOnly,
        logoUrl: school.logoUrl,
        primaryColor: school.primaryColor,
        createdAt: school.createdAt,
        updatedAt: school.updatedAt,
        stats: {
            totalUsers: school._count.users,
            totalSessions: school._count.sessions,
            totalPayments: school._count.payments,
        },
        recentPayments: school.payments,
    });
});
// ─── POST /super/schools/:id/suspend — Suspend a school ──────────────────────
exports.superAdminRouter.post('/schools/:id/suspend', async (req, res) => {
    const schoolId = req.params.id;
    const school = await index_1.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
        res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
        return;
    }
    await licenseService_1.licenseService.suspendSchool(schoolId);
    res.json({ message: 'School suspended successfully', schoolId });
});
// ─── POST /super/schools/:id/unsuspend — Clear suspension ─────────────────────
exports.superAdminRouter.post('/schools/:id/unsuspend', async (req, res) => {
    const schoolId = req.params.id;
    const school = await index_1.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
        res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
        return;
    }
    await index_1.prisma.school.update({
        where: { id: schoolId },
        data: { isSuspended: false },
    });
    // Audit log
    await auditService_1.auditService.log({
        eventType: 'SCHOOL_SUSPENDED',
        actorId: req.user?.sub,
        actorRole: req.user?.role,
        schoolId,
        resourceSnapshot: {
            schoolId,
            schoolName: school.name,
            action: 'SCHOOL_UNSUSPENDED',
            unsuspendedAt: new Date().toISOString(),
        },
    });
    res.json({ message: 'School unsuspended successfully', schoolId });
});
// ─── POST /super/schools/:id/extend — Extend license ─────────────────────────
exports.superAdminRouter.post('/schools/:id/extend', async (req, res) => {
    const schoolId = req.params.id;
    const parsed = extendLicenseSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    const school = await index_1.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
        res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
        return;
    }
    const newExpiry = new Date(parsed.data.newExpiry);
    await licenseService_1.licenseService.extendLicense(schoolId, newExpiry);
    res.json({
        message: 'License extended successfully',
        schoolId,
        newExpiresAt: newExpiry.toISOString(),
    });
});
// ─── DELETE /super/schools/:id — Delete a school and all its data ─────────────
exports.superAdminRouter.delete('/schools/:id', async (req, res) => {
    const schoolId = req.params.id;
    const school = await index_1.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
        res.status(404).json({ error: 'School not found', code: 'NOT_FOUND' });
        return;
    }
    // Delete all related data in order (respecting foreign keys)
    await index_1.prisma.$transaction(async (tx) => {
        await tx.attendanceRecord.deleteMany({ where: { schoolId } });
        await tx.attendanceSession.deleteMany({ where: { schoolId } });
        await tx.notification.deleteMany({ where: { schoolId } });
        await tx.conversationRecord.deleteMany({ where: { thread: { schoolId } } });
        await tx.conversationThread.deleteMany({ where: { schoolId } });
        await tx.aIKnowledge.deleteMany({ where: { schoolId } });
        await tx.registrationLink.deleteMany({ where: { schoolId } });
        await tx.timetableEntry.deleteMany({ where: { schoolId } });
        await tx.riskScore.deleteMany({ where: { schoolId } });
        await tx.payment.deleteMany({ where: { schoolId } });
        await tx.auditLog.deleteMany({ where: { schoolId } });
        await tx.refreshToken.deleteMany({ where: { user: { schoolId } } });
        await tx.webAuthnCredential.deleteMany({ where: { user: { schoolId } } });
        await tx.biometricTemplate.deleteMany({ where: { schoolId } });
        await tx.user.deleteMany({ where: { schoolId } });
        await tx.class.deleteMany({ where: { schoolId } });
        await tx.department.deleteMany({ where: { schoolId } });
        await tx.licenseKey.updateMany({ where: { usedBySchoolId: schoolId }, data: { usedBySchoolId: null, usedAt: null } });
        await tx.school.delete({ where: { id: schoolId } });
    });
    // Audit log — wrapped in try-catch since the school no longer exists
    try {
        await auditService_1.auditService.log({
            eventType: 'SCHOOL_SUSPENDED',
            actorId: req.user?.sub,
            actorRole: req.user?.role,
            resourceSnapshot: {
                schoolId,
                schoolName: school.name,
                action: 'SCHOOL_DELETED',
                deletedAt: new Date().toISOString(),
            },
        });
    }
    catch {
        // School was deleted, audit log may fail — that's ok
    }
    res.json({ message: 'School deleted successfully', schoolId });
});
// ─── GET /super/revenue — Aggregate payment totals by plan tier ───────────────
exports.superAdminRouter.get('/revenue', async (_req, res) => {
    const revenue = await index_1.prisma.payment.groupBy({
        by: ['planTier'],
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
        _count: { id: true },
    });
    const totalRevenue = revenue.reduce((sum, r) => sum + (r._sum.amount || 0), 0);
    res.json({
        totalRevenue,
        byPlanTier: revenue.map((r) => ({
            planTier: r.planTier,
            totalAmount: r._sum.amount || 0,
            paymentCount: r._count.id,
        })),
    });
});
// ─── GET /super/audit-logs — Query audit logs with filters ────────────────────
exports.superAdminRouter.get('/audit-logs', async (req, res) => {
    const { schoolId, eventType, dateFrom, dateTo, limit, offset } = req.query;
    const filters = {};
    if (schoolId && typeof schoolId === 'string')
        filters.schoolId = schoolId;
    if (eventType && typeof eventType === 'string')
        filters.eventType = eventType;
    if (dateFrom && typeof dateFrom === 'string')
        filters.dateFrom = new Date(dateFrom);
    if (dateTo && typeof dateTo === 'string')
        filters.dateTo = new Date(dateTo);
    if (limit)
        filters.limit = parseInt(limit, 10) || 50;
    if (offset)
        filters.offset = parseInt(offset, 10) || 0;
    // Default limit
    if (!filters.limit)
        filters.limit = 50;
    const logs = await auditService_1.auditService.query(filters);
    // Serialize BigInt values to strings for JSON compatibility
    const serializedLogs = JSON.parse(JSON.stringify(logs, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    res.json({ logs: serializedLogs, count: serializedLogs.length });
});
// ─── AI Knowledge Base CRUD ────────────────────────────────────────────────────
const aiKnowledgeSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(200),
    content: zod_1.z.string().min(1),
    category: zod_1.z.string().default('general'),
});
// GET /super/ai-knowledge — List all knowledge entries
exports.superAdminRouter.get('/ai-knowledge', async (_req, res) => {
    const entries = await index_1.prisma.aIKnowledge.findMany({
        orderBy: { createdAt: 'desc' },
    });
    res.json({ entries });
});
// POST /super/ai-knowledge — Add a new knowledge entry
exports.superAdminRouter.post('/ai-knowledge', async (req, res) => {
    const parsed = aiKnowledgeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    const entry = await index_1.prisma.aIKnowledge.create({
        data: {
            ...parsed.data,
            schoolId: req.user.schoolId,
            createdById: req.user.sub,
        },
    });
    res.status(201).json({ entry });
});
// PUT /super/ai-knowledge/:id — Update a knowledge entry
exports.superAdminRouter.put('/ai-knowledge/:id', async (req, res) => {
    const id = req.params.id;
    const parsed = aiKnowledgeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    const existing = await index_1.prisma.aIKnowledge.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ error: 'Knowledge entry not found', code: 'NOT_FOUND' });
        return;
    }
    const entry = await index_1.prisma.aIKnowledge.update({
        where: { id },
        data: parsed.data,
    });
    res.json({ entry });
});
// DELETE /super/ai-knowledge/:id — Delete a knowledge entry
exports.superAdminRouter.delete('/ai-knowledge/:id', async (req, res) => {
    const id = req.params.id;
    const existing = await index_1.prisma.aIKnowledge.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ error: 'Knowledge entry not found', code: 'NOT_FOUND' });
        return;
    }
    await index_1.prisma.aIKnowledge.delete({ where: { id } });
    res.json({ message: 'Knowledge entry deleted successfully' });
});
// ─── POST /super/ai-action — Execute admin actions via AI ─────────────────────
const aiActionSchema = zod_1.z.object({
    action: zod_1.z.enum([
        'generate_license',
        'suspend_school',
        'unsuspend_school',
        'extend_license',
        'get_school_info',
        'get_system_stats',
    ]),
    params: zod_1.z.record(zod_1.z.unknown()).default({}),
});
exports.superAdminRouter.post('/ai-action', async (req, res) => {
    const parsed = aiActionSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    const { action, params } = parsed.data;
    try {
        switch (action) {
            case 'generate_license': {
                const planTier = params.planTier || 'BASIC';
                const schoolName = params.schoolName || 'Unnamed School';
                const daysValid = params.daysValid || 365;
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + daysValid);
                const validTiers = ['TRIAL', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'];
                if (!validTiers.includes(planTier)) {
                    res.status(400).json({
                        error: `Invalid plan tier "${planTier}". Must be one of: ${validTiers.join(', ')}`,
                        code: 'INVALID_PLAN_TIER',
                    });
                    return;
                }
                const secret = process.env.LICENSE_SECRET || process.env.JWT_SECRET || 'default-license-secret';
                const rawKey = (0, shared_2.encodeLicenseKey)({ schoolName, planTier: planTier, expiresAt }, secret);
                const keyHash = (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
                await index_1.prisma.licenseKey.create({
                    data: {
                        keyHash,
                        planTier: planTier,
                        schoolName,
                        expiresAt,
                    },
                });
                await auditService_1.auditService.log({
                    eventType: 'LICENSE_ACTIVATION',
                    actorId: req.user?.sub,
                    actorRole: req.user?.role,
                    resourceSnapshot: {
                        action: 'LICENSE_GENERATED_VIA_AI',
                        schoolName,
                        planTier,
                        expiresAt: expiresAt.toISOString(),
                    },
                });
                res.json({
                    message: `✅ License generated successfully!\n\n**License Key:** \`${rawKey}\`\n\n**Details:**\n• School: ${schoolName}\n• Plan: ${planTier}\n• Expires: ${expiresAt.toLocaleDateString()}\n\n⚠️ Store this key securely — it cannot be retrieved again.`,
                    result: { licenseKey: rawKey, schoolName, planTier, expiresAt: expiresAt.toISOString() },
                });
                return;
            }
            case 'suspend_school': {
                const schoolName = params.schoolName;
                if (!schoolName) {
                    res.status(400).json({ error: 'School name is required', code: 'MISSING_PARAM' });
                    return;
                }
                const school = await index_1.prisma.school.findFirst({
                    where: { name: { contains: schoolName, mode: 'insensitive' } },
                });
                if (!school) {
                    res.status(404).json({
                        error: `School "${schoolName}" not found. Please check the name and try again.`,
                        code: 'NOT_FOUND',
                    });
                    return;
                }
                if (school.isSuspended) {
                    res.json({ message: `⚠️ School "${school.name}" is already suspended.` });
                    return;
                }
                await licenseService_1.licenseService.suspendSchool(school.id);
                res.json({
                    message: `✅ School "${school.name}" has been suspended.\n\n• All active sessions revoked\n• Users cannot log in\n• Audit log entry created`,
                    result: { schoolId: school.id, schoolName: school.name, action: 'suspended' },
                });
                return;
            }
            case 'unsuspend_school': {
                const schoolName = params.schoolName;
                if (!schoolName) {
                    res.status(400).json({ error: 'School name is required', code: 'MISSING_PARAM' });
                    return;
                }
                const school = await index_1.prisma.school.findFirst({
                    where: { name: { contains: schoolName, mode: 'insensitive' } },
                });
                if (!school) {
                    res.status(404).json({
                        error: `School "${schoolName}" not found. Please check the name and try again.`,
                        code: 'NOT_FOUND',
                    });
                    return;
                }
                if (!school.isSuspended) {
                    res.json({ message: `ℹ️ School "${school.name}" is not currently suspended.` });
                    return;
                }
                await index_1.prisma.school.update({
                    where: { id: school.id },
                    data: { isSuspended: false },
                });
                await auditService_1.auditService.log({
                    eventType: 'SCHOOL_SUSPENDED',
                    actorId: req.user?.sub,
                    actorRole: req.user?.role,
                    schoolId: school.id,
                    resourceSnapshot: {
                        schoolId: school.id,
                        schoolName: school.name,
                        action: 'SCHOOL_UNSUSPENDED_VIA_AI',
                        unsuspendedAt: new Date().toISOString(),
                    },
                });
                res.json({
                    message: `✅ School "${school.name}" has been unsuspended.\n\n• Users can now log in\n• Full access restored`,
                    result: { schoolId: school.id, schoolName: school.name, action: 'unsuspended' },
                });
                return;
            }
            case 'extend_license': {
                const schoolName = params.schoolName;
                const daysToAdd = params.daysToAdd || 30;
                if (!schoolName) {
                    res.status(400).json({ error: 'School name is required', code: 'MISSING_PARAM' });
                    return;
                }
                const school = await index_1.prisma.school.findFirst({
                    where: { name: { contains: schoolName, mode: 'insensitive' } },
                });
                if (!school) {
                    res.status(404).json({
                        error: `School "${schoolName}" not found. Please check the name and try again.`,
                        code: 'NOT_FOUND',
                    });
                    return;
                }
                const currentExpiry = school.licenseExpiresAt;
                const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
                const newExpiry = new Date(baseDate);
                newExpiry.setDate(newExpiry.getDate() + daysToAdd);
                await licenseService_1.licenseService.extendLicense(school.id, newExpiry);
                res.json({
                    message: `✅ License extended for "${school.name}".\n\n• Previous expiry: ${currentExpiry.toLocaleDateString()}\n• New expiry: ${newExpiry.toLocaleDateString()}\n• Days added: ${daysToAdd}\n• Read-only mode cleared`,
                    result: {
                        schoolId: school.id,
                        schoolName: school.name,
                        previousExpiry: currentExpiry.toISOString(),
                        newExpiry: newExpiry.toISOString(),
                        daysAdded: daysToAdd,
                    },
                });
                return;
            }
            case 'get_school_info': {
                const schoolName = params.schoolName;
                if (!schoolName) {
                    res.status(400).json({ error: 'School name is required', code: 'MISSING_PARAM' });
                    return;
                }
                const school = await index_1.prisma.school.findFirst({
                    where: { name: { contains: schoolName, mode: 'insensitive' } },
                    include: {
                        _count: { select: { users: true, sessions: true, payments: true } },
                    },
                });
                if (!school) {
                    res.status(404).json({
                        error: `School "${schoolName}" not found.`,
                        code: 'NOT_FOUND',
                    });
                    return;
                }
                res.json({
                    message: `📋 **School Info: ${school.name}**\n\n• ID: ${school.id}\n• Code: ${school.schoolCode}\n• Plan: ${school.planTier}\n• License Expires: ${school.licenseExpiresAt.toLocaleDateString()}\n• Suspended: ${school.isSuspended ? 'Yes ⚠️' : 'No ✅'}\n• Read-Only: ${school.isReadOnly ? 'Yes' : 'No'}\n• Total Users: ${school._count.users}\n• Total Sessions: ${school._count.sessions}\n• Total Payments: ${school._count.payments}\n• Created: ${school.createdAt.toLocaleDateString()}`,
                    result: school,
                });
                return;
            }
            case 'get_system_stats': {
                const [totalSchools, totalStudents, totalTeachers, activeSessions, suspendedSchools] = await Promise.all([
                    index_1.prisma.school.count(),
                    index_1.prisma.user.count({ where: { role: 'STUDENT' } }),
                    index_1.prisma.user.count({ where: { role: 'TEACHER' } }),
                    index_1.prisma.attendanceSession.count({ where: { isActive: true } }),
                    index_1.prisma.school.count({ where: { isSuspended: true } }),
                ]);
                const revenue = await index_1.prisma.payment.aggregate({
                    where: { status: 'SUCCESS' },
                    _sum: { amount: true },
                });
                res.json({
                    message: `📊 **System Stats**\n\n• Schools: ${totalSchools}\n• Students: ${totalStudents}\n• Teachers: ${totalTeachers}\n• Active Sessions: ${activeSessions}\n• Suspended: ${suspendedSchools}\n• Revenue: KES ${(revenue._sum.amount || 0).toLocaleString()}`,
                    result: {
                        totalSchools,
                        totalStudents,
                        totalTeachers,
                        activeSessions,
                        suspendedSchools,
                        totalRevenue: revenue._sum.amount || 0,
                    },
                });
                return;
            }
            default:
                res.status(400).json({ error: `Unknown action: ${action}`, code: 'UNKNOWN_ACTION' });
        }
    }
    catch (err) {
        console.error('[SuperAdmin/AI-Action] Error:', err);
        res.status(500).json({
            error: err.message || 'Failed to execute action',
            code: 'ACTION_FAILED',
        });
    }
});
//# sourceMappingURL=superAdmin.js.map