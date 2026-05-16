"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.biometricRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const rbac_1 = require("../middleware/rbac");
const licenseService_1 = require("../services/licenseService");
const biometricService_1 = require("../services/biometricService");
const errors_1 = require("../middleware/errors");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const enrollSchema = zod_1.z.object({
    studentId: zod_1.z.string().min(1),
    descriptor: zod_1.z.array(zod_1.z.number()).min(1, 'Descriptor must not be empty'),
});
// ─── Router ───────────────────────────────────────────────────────────────────
exports.biometricRouter = (0, express_1.Router)();
/**
 * Middleware: Gate all biometric routes behind Pro/Enterprise plan access.
 * Requirements: 7.1, 12.4
 */
exports.biometricRouter.use(async (req, res, next) => {
    try {
        const hasAccess = await licenseService_1.licenseService.checkFeatureAccess(req.schoolId, 'biometric');
        if (!hasAccess) {
            throw new errors_1.AppError(403, 'FEATURE_NOT_AVAILABLE', 'Biometric features require a Professional or Enterprise plan');
        }
        next();
    }
    catch (err) {
        if (err instanceof errors_1.AppError) {
            next(err);
        }
        else {
            next(new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to check feature access'));
        }
    }
});
/**
 * POST /api/v1/biometric/enroll
 * Enroll a biometric template for a student.
 * Requires mark:attendance permission (Teacher role).
 * Requirements: 7.4, 7.8
 */
exports.biometricRouter.post('/enroll', (0, rbac_1.requirePermission)('mark:attendance'), async (req, res) => {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        // Convert the number array to Float32Array
        const descriptor = new Float32Array(parsed.data.descriptor);
        await biometricService_1.biometricService.enrollTemplate(parsed.data.studentId, req.schoolId, descriptor);
        res.status(201).json({
            message: 'Biometric template enrolled successfully',
            studentId: parsed.data.studentId,
        });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to enroll biometric template');
    }
});
/**
 * GET /api/v1/biometric/templates/:classId
 * Get encrypted biometric templates for a class (for offline caching).
 * Requires mark:attendance permission (Teacher role).
 * Requirements: 7.4, 12.4
 */
exports.biometricRouter.get('/templates/:classId', (0, rbac_1.requirePermission)('mark:attendance'), async (req, res) => {
    const classId = req.params.classId;
    if (!classId) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: { classId: ['classId parameter is required'] },
        });
        return;
    }
    try {
        const templates = await biometricService_1.biometricService.getEncryptedTemplates(classId, req.schoolId);
        // Convert Buffers to base64 for JSON transport
        const response = templates.map((t) => ({
            id: t.id,
            studentId: t.studentId,
            encryptedData: t.encryptedData.toString('base64'),
            iv: t.iv.toString('base64'),
            authTag: t.authTag.toString('base64'),
        }));
        res.status(200).json(response);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to get biometric templates');
    }
});
//# sourceMappingURL=biometric.js.map