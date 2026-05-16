"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const shared_1 = require("@sams/shared");
const rbac_1 = require("../middleware/rbac");
const paymentService_1 = require("../services/paymentService");
const errors_1 = require("../middleware/errors");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const initiatePaymentSchema = zod_1.z.object({
    phone: zod_1.z.string().min(9).max(15),
    amount: zod_1.z.number().positive(),
    planTier: zod_1.z.nativeEnum(shared_1.PlanTier),
    accountReference: zod_1.z.string().max(50).optional(),
});
// ─── M-Pesa IP Whitelist Middleware ───────────────────────────────────────────
// Safaricom M-Pesa Daraja API callback IPs.
// In production, only requests from these IPs are allowed.
// In development/test, all IPs are allowed.
const MPESA_ALLOWED_IPS = (process.env.MPESA_ALLOWED_IPS ?? '196.201.214.200,196.201.214.206,196.201.213.114,196.201.214.207,196.201.214.208,196.201.213.44,196.201.212.127,196.201.212.128,196.201.212.129,196.201.212.130,196.201.212.131,196.201.212.132,196.201.212.133,196.201.212.134,196.201.212.135,196.201.212.136,196.201.212.137,196.201.212.138')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
function mpesaIpWhitelist(req, res, next) {
    // Skip IP check in development/test
    if (process.env.NODE_ENV !== 'production') {
        next();
        return;
    }
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : req.ip ?? req.socket.remoteAddress ?? '';
    if (!MPESA_ALLOWED_IPS.includes(clientIp)) {
        console.warn(`[PaymentsRouter] Blocked callback from non-whitelisted IP: ${clientIp}`);
        res.status(403).json({ error: 'Forbidden', code: 'IP_NOT_ALLOWED' });
        return;
    }
    next();
}
// ─── Router ───────────────────────────────────────────────────────────────────
exports.paymentsRouter = (0, express_1.Router)();
/**
 * POST /api/v1/payments/initiate
 * Initiate an M-Pesa STK Push payment.
 * Requires auth: School Admin only (manage:payments permission).
 */
exports.paymentsRouter.post('/initiate', (0, rbac_1.requirePermission)('manage:payments'), async (req, res) => {
    const parsed = initiatePaymentSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const result = await paymentService_1.paymentService.initiateSTKPush(req.schoolId, parsed.data);
        res.status(200).json(result);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to initiate payment');
    }
});
/**
 * POST /api/v1/payments/callback
 * M-Pesa callback endpoint (public, IP-whitelisted, no auth).
 * Called by Safaricom's Daraja API after STK Push completes.
 */
exports.paymentsRouter.post('/callback', mpesaIpWhitelist, async (req, res) => {
    try {
        await paymentService_1.paymentService.handleCallback(req.body);
        // M-Pesa expects a 200 response
        res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    catch (err) {
        // Still return 200 to M-Pesa to prevent retries
        console.error('[PaymentsRouter] Callback error:', err);
        res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
});
/**
 * GET /api/v1/payments
 * List payments for the school.
 */
exports.paymentsRouter.get('/', (0, rbac_1.requirePermission)('manage:payments'), async (req, res) => {
    try {
        const payments = await paymentService_1.paymentService.listPayments(req.schoolId);
        res.status(200).json(payments);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list payments');
    }
});
/**
 * GET /api/v1/payments/:id/invoice
 * Get invoice/payment details.
 */
exports.paymentsRouter.get('/:id/invoice', (0, rbac_1.requirePermission)('manage:payments'), async (req, res) => {
    try {
        const invoice = await paymentService_1.paymentService.getInvoice(req.schoolId, req.params.id);
        res.status(200).json(invoice);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to get invoice');
    }
});
//# sourceMappingURL=payments.js.map