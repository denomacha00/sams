"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const rbac_1 = require("../middleware/rbac");
const sessionService_1 = require("../services/sessionService");
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const startSessionSchema = zod_1.z.object({
    timetableEntryId: zod_1.z.string().min(1),
    location: zod_1.z.object({
        lat: zod_1.z.number().min(-90).max(90),
        lng: zod_1.z.number().min(-180).max(180),
    }),
});
// ─── Router ───────────────────────────────────────────────────────────────────
exports.sessionsRouter = (0, express_1.Router)();
/**
 * POST /api/v1/sessions
 * Start a new attendance session.
 */
exports.sessionsRouter.post('/', (0, rbac_1.requirePermission)('start:session'), async (req, res) => {
    const parsed = startSessionSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const session = await sessionService_1.sessionService.startSession(req.user.sub, req.schoolId, parsed.data.timetableEntryId, parsed.data.location);
        res.status(201).json(session);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to start session');
    }
});
/**
 * GET /api/v1/sessions
 * List sessions scoped to the school.
 */
exports.sessionsRouter.get('/', async (req, res) => {
    try {
        const where = { schoolId: req.schoolId };
        if (req.query.classId) {
            where.classId = req.query.classId;
        }
        if (req.query.teacherId) {
            where.teacherId = req.query.teacherId;
        }
        if (req.query.isActive !== undefined) {
            where.isActive = req.query.isActive === 'true';
        }
        const sessions = await index_1.prisma.attendanceSession.findMany({ where });
        res.status(200).json(sessions);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list sessions');
    }
});
/**
 * GET /api/v1/sessions/:id
 * Get a single session by ID.
 */
exports.sessionsRouter.get('/:id', async (req, res) => {
    try {
        const session = await index_1.prisma.attendanceSession.findUnique({
            where: { id: req.params.id },
        });
        if (!session) {
            throw new errors_1.AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
        }
        if (session.schoolId !== req.schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
        }
        res.status(200).json(session);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to get session');
    }
});
/**
 * GET /api/v1/sessions/:id/qr
 * Get the current active QR token for a session.
 */
exports.sessionsRouter.get('/:id/qr', async (req, res) => {
    try {
        const qrToken = await sessionService_1.sessionService.getActiveQR(req.params.id);
        if (!qrToken) {
            throw new errors_1.AppError(404, 'QR_NOT_FOUND', 'No active QR code for this session');
        }
        res.status(200).json({ qrToken });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to get QR code');
    }
});
/**
 * POST /api/v1/sessions/:id/end
 * End an active session.
 */
exports.sessionsRouter.post('/:id/end', (0, rbac_1.requirePermission)('start:session'), async (req, res) => {
    try {
        await sessionService_1.sessionService.endSession(req.params.id, req.user.sub);
        res.status(200).json({ message: 'Session ended' });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to end session');
    }
});
//# sourceMappingURL=sessions.js.map