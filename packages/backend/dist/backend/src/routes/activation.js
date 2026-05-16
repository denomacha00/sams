"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activationRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const activationService_1 = require("../services/activationService");
// ─── Validation Schema ────────────────────────────────────────────────────────
const activationSchema = zod_1.z.object({
    licenseKey: zod_1.z.string().min(1),
    schoolCode: zod_1.z
        .string()
        .min(3)
        .max(20)
        .regex(/^[A-Z0-9]+$/, 'schoolCode must be uppercase alphanumeric'),
    adminFullName: zod_1.z.string().min(2),
    adminEmail: zod_1.z.string().email(),
    adminPassword: zod_1.z.string().min(8),
});
// ─── Error Code → HTTP Status Mapping ────────────────────────────────────────
function activationErrorToStatus(code) {
    switch (code) {
        case 'INVALID_LICENSE_FORMAT':
            return 400;
        case 'INVALID_LICENSE':
            return 400;
        case 'LICENSE_EXPIRED':
            return 400;
        case 'LICENSE_USED':
            return 409;
        case 'SCHOOL_CODE_TAKEN':
            return 409;
        default:
            return 500;
    }
}
// ─── Router ───────────────────────────────────────────────────────────────────
exports.activationRouter = (0, express_1.Router)();
/**
 * POST /api/v1/activate
 * Activate a school using a license key and create the initial School Admin account.
 * Requirements: 1.1
 */
exports.activationRouter.post('/', async (req, res) => {
    const parsed = activationSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
            requestId: req.id,
        });
        return;
    }
    try {
        const result = await activationService_1.activationService.activate(parsed.data);
        res.status(201).json({
            schoolId: result.schoolId,
            schoolCode: result.schoolCode,
            message: 'School activated successfully',
        });
    }
    catch (err) {
        if (err instanceof activationService_1.ActivationError) {
            const status = activationErrorToStatus(err.code);
            res.status(status).json({
                error: err.message,
                code: err.code,
                requestId: req.id,
            });
            return;
        }
        // Unexpected error
        console.error('[ActivationRoute] Unexpected error:', err);
        res.status(500).json({
            error: 'An unexpected error occurred',
            code: 'INTERNAL_ERROR',
            requestId: req.id,
        });
    }
});
//# sourceMappingURL=activation.js.map