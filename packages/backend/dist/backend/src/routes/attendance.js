"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attendanceRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const shared_1 = require("@sams/shared");
const rbac_1 = require("../middleware/rbac");
const attendanceService_1 = require("../services/attendanceService");
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const qrScanSchema = zod_1.z.object({
    qrToken: zod_1.z.string().min(1),
    gpsCoords: zod_1.z.object({
        lat: zod_1.z.number().min(-90).max(90),
        lng: zod_1.z.number().min(-180).max(180),
    }),
});
const manualSchema = zod_1.z.object({
    studentId: zod_1.z.string().min(1),
    sessionId: zod_1.z.string().min(1),
    status: zod_1.z.nativeEnum(shared_1.AttendanceStatus),
    note: zod_1.z.string().max(500).optional(),
});
const biometricSchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(1),
    studentId: zod_1.z.string().min(1),
    confidence: zod_1.z.number().min(0).max(1),
});
const updateRecordSchema = zod_1.z.object({
    status: zod_1.z.nativeEnum(shared_1.AttendanceStatus),
    note: zod_1.z.string().max(500).optional(),
});
const syncSchema = zod_1.z.object({
    records: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string().min(1),
        sessionId: zod_1.z.string().min(1),
        studentId: zod_1.z.string().min(1),
        status: zod_1.z.nativeEnum(shared_1.AttendanceStatus),
        method: zod_1.z.string().min(1),
        note: zod_1.z.string().max(500).optional(),
        scannedAt: zod_1.z.string().min(1),
        synced: zod_1.z.boolean(),
    })),
});
const linkGenerateSchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(1),
    expiryMinutes: zod_1.z.number().int().min(1).max(60).default(5),
});
const linkAttendanceSchema = zod_1.z.object({
    linkToken: zod_1.z.string().min(1),
    gpsCoords: zod_1.z.object({
        lat: zod_1.z.number().min(-90).max(90),
        lng: zod_1.z.number().min(-180).max(180),
    }),
});
// ─── Router ───────────────────────────────────────────────────────────────────
exports.attendanceRouter = (0, express_1.Router)();
/**
 * POST /api/v1/attendance/qr
 * Record attendance via QR code scan (student).
 */
exports.attendanceRouter.post('/qr', async (req, res) => {
    const parsed = qrScanSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const record = await attendanceService_1.attendanceService.recordQRScan(req.user.sub, req.schoolId, parsed.data.qrToken, parsed.data.gpsCoords);
        res.status(201).json(record);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to record QR scan');
    }
});
/**
 * POST /api/v1/attendance/manual
 * Record attendance manually (teacher).
 */
exports.attendanceRouter.post('/manual', (0, rbac_1.requirePermission)('mark:attendance'), async (req, res) => {
    const parsed = manualSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const record = await attendanceService_1.attendanceService.recordManual(req.user.sub, req.schoolId, parsed.data.studentId, parsed.data.sessionId, parsed.data.status, parsed.data.note);
        res.status(201).json(record);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to record manual attendance');
    }
});
/**
 * POST /api/v1/attendance/biometric
 * Record attendance via biometric verification (teacher).
 */
exports.attendanceRouter.post('/biometric', (0, rbac_1.requirePermission)('mark:attendance'), async (req, res) => {
    const parsed = biometricSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const record = await attendanceService_1.attendanceService.recordBiometric(req.user.sub, req.schoolId, parsed.data.sessionId, parsed.data.studentId, parsed.data.confidence);
        res.status(201).json(record);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to record biometric attendance');
    }
});
/**
 * POST /api/v1/attendance/link/generate
 * Generate a shareable attendance link for an active session (teacher).
 */
exports.attendanceRouter.post('/link/generate', (0, rbac_1.requirePermission)('start:session'), async (req, res) => {
    const parsed = linkGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const result = await attendanceService_1.attendanceService.generateAttendanceLink(parsed.data.sessionId, req.schoolId, parsed.data.expiryMinutes);
        res.status(201).json(result);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to generate attendance link');
    }
});
/**
 * POST /api/v1/attendance/link
 * Record attendance via link token (authenticated student, no special permission).
 */
exports.attendanceRouter.post('/link', async (req, res) => {
    const parsed = linkAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const record = await attendanceService_1.attendanceService.recordLinkAttendance(req.user.sub, req.schoolId, parsed.data.linkToken, parsed.data.gpsCoords);
        res.status(201).json(record);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to record link attendance');
    }
});
/**
 * GET /api/v1/attendance/link/:token/info
 * Get link metadata (session subject, class name, teacher) for the attendance page UI.
 */
exports.attendanceRouter.get('/link/:token/info', async (req, res) => {
    const token = req.params.token;
    try {
        // Verify the token JWT, extract sessionId
        const QR_SECRET = process.env.QR_SECRET ?? 'qr-secret-dev';
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(token, QR_SECRET);
        }
        catch {
            res.status(200).json({ valid: false, error: 'INVALID' });
            return;
        }
        // Validate token type
        if (payload.type !== 'LINK') {
            res.status(200).json({ valid: false, error: 'INVALID' });
            return;
        }
        // Fetch session with class and teacher info
        const session = await index_1.prisma.attendanceSession.findUnique({
            where: { id: payload.sessionId },
            include: {
                class: true,
                teacher: { select: { fullName: true } },
            },
        });
        if (!session) {
            res.status(200).json({ valid: false, error: 'INVALID' });
            return;
        }
        if (!session.isActive) {
            res.status(200).json({ valid: false, error: 'SESSION_ENDED' });
            return;
        }
        // Return session info
        const expiresAt = payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined;
        res.status(200).json({
            valid: true,
            sessionId: session.id,
            subject: session.subject,
            className: session.class?.name ?? null,
            teacherName: session.teacher?.fullName ?? null,
            expiresAt,
        });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to get link info');
    }
});
/**
 * PUT /api/v1/attendance/:id
 * Update an existing attendance record.
 */
exports.attendanceRouter.put('/:id', (0, rbac_1.requirePermission)('mark:attendance'), async (req, res) => {
    const parsed = updateRecordSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const record = await attendanceService_1.attendanceService.updateRecord(req.user.sub, req.schoolId, req.params.id, parsed.data.status, parsed.data.note);
        res.status(200).json(record);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to update attendance record');
    }
});
/**
 * POST /api/v1/attendance/sync
 * Sync offline attendance records.
 */
exports.attendanceRouter.post('/sync', async (req, res) => {
    const parsed = syncSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const result = await attendanceService_1.attendanceService.syncOfflineRecords(req.schoolId, parsed.data.records);
        res.status(200).json(result);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to sync offline records');
    }
});
/**
 * GET /api/v1/attendance
 * List attendance records scoped to school/class/student based on role.
 */
exports.attendanceRouter.get('/', async (req, res) => {
    try {
        const where = { schoolId: req.schoolId };
        // Scope based on role
        if (req.user.role === shared_1.UserRole.STUDENT) {
            where.studentId = req.user.sub;
        }
        else if (req.user.role === shared_1.UserRole.TEACHER) {
            // Teachers see records from their sessions
            if (req.query.sessionId) {
                where.sessionId = req.query.sessionId;
            }
        }
        // Additional filters from query params
        if (req.query.studentId && req.user.role !== shared_1.UserRole.STUDENT) {
            where.studentId = req.query.studentId;
        }
        if (req.query.sessionId) {
            where.sessionId = req.query.sessionId;
        }
        if (req.query.status) {
            where.status = req.query.status;
        }
        const records = await index_1.prisma.attendanceRecord.findMany({ where });
        res.status(200).json(records);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list attendance records');
    }
});
//# sourceMappingURL=attendance.js.map