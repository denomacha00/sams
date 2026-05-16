"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentService = exports.PaymentService = void 0;
const axios_1 = __importDefault(require("axios"));
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
const auditService_1 = require("./auditService");
// ─── Constants ────────────────────────────────────────────────────────────────
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY ?? '';
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET ?? '';
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE ?? '';
const MPESA_PASSKEY = process.env.MPESA_PASSKEY ?? '';
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL ?? '';
const MPESA_BASE_URL = process.env.MPESA_BASE_URL ?? 'https://sandbox.safaricom.co.ke';
// ─── Payment Service ──────────────────────────────────────────────────────────
class PaymentService {
    /**
     * Get M-Pesa OAuth token.
     */
    async getAccessToken() {
        const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
        const response = await axios_1.default.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: { Authorization: `Basic ${auth}` },
        });
        return response.data.access_token;
    }
    /**
     * Generate M-Pesa timestamp and password.
     */
    generateTimestampAndPassword() {
        const now = new Date();
        const timestamp = now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
        return { timestamp, password };
    }
    /**
     * Initiate an M-Pesa STK Push.
     */
    async initiateSTKPush(schoolId, params) {
        const { timestamp, password } = this.generateTimestampAndPassword();
        const accessToken = await this.getAccessToken();
        // Create payment record
        const payment = await index_1.prisma.payment.create({
            data: {
                schoolId,
                phone: params.phone,
                amount: params.amount,
                planTier: params.planTier,
                status: 'PENDING',
            },
        });
        try {
            const response = await axios_1.default.post(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, {
                BusinessShortCode: MPESA_SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType: 'CustomerPayBillOnline',
                Amount: params.amount,
                PartyA: params.phone,
                PartyB: MPESA_SHORTCODE,
                PhoneNumber: params.phone,
                CallBackURL: MPESA_CALLBACK_URL,
                AccountReference: params.accountReference ?? `SAMS-${schoolId.slice(0, 8)}`,
                TransactionDesc: `SAMS ${params.planTier} subscription`,
            }, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            // Update payment with checkout ID
            await index_1.prisma.payment.update({
                where: { id: payment.id },
                data: { mpesaCheckoutId: response.data.CheckoutRequestID },
            });
            await auditService_1.auditService.log({
                eventType: 'PAYMENT_INITIATED',
                schoolId,
                resourceSnapshot: {
                    paymentId: payment.id,
                    phone: params.phone,
                    amount: params.amount,
                    planTier: params.planTier,
                    checkoutRequestId: response.data.CheckoutRequestID,
                },
            });
            return {
                paymentId: payment.id,
                checkoutRequestId: response.data.CheckoutRequestID,
                message: response.data.CustomerMessage ?? 'STK Push sent',
            };
        }
        catch (err) {
            // Update payment status to FAILED
            await index_1.prisma.payment.update({
                where: { id: payment.id },
                data: { status: 'FAILED' },
            });
            throw new errors_1.AppError(502, 'MPESA_ERROR', 'Failed to initiate M-Pesa STK Push');
        }
    }
    /**
     * Handle M-Pesa callback.
     */
    async handleCallback(callbackData) {
        const { stkCallback } = callbackData.Body;
        const { CheckoutRequestID, ResultCode, CallbackMetadata } = stkCallback;
        const payment = await index_1.prisma.payment.findFirst({
            where: { mpesaCheckoutId: CheckoutRequestID },
        });
        if (!payment) {
            console.error(`[PaymentService] No payment found for checkout ID: ${CheckoutRequestID}`);
            return;
        }
        if (ResultCode === 0) {
            // Success
            let mpesaReceiptNumber;
            if (CallbackMetadata?.Item) {
                const receiptItem = CallbackMetadata.Item.find((i) => i.Name === 'MpesaReceiptNumber');
                if (receiptItem?.Value) {
                    mpesaReceiptNumber = String(receiptItem.Value);
                }
            }
            await index_1.prisma.payment.update({
                where: { id: payment.id },
                data: {
                    status: 'SUCCESS',
                    mpesaReceiptNumber,
                    completedAt: new Date(),
                },
            });
            await auditService_1.auditService.log({
                eventType: 'PAYMENT_SUCCESS',
                schoolId: payment.schoolId,
                resourceSnapshot: {
                    paymentId: payment.id,
                    mpesaReceiptNumber,
                    amount: payment.amount,
                    planTier: payment.planTier,
                },
            });
        }
        else {
            // Failed
            await index_1.prisma.payment.update({
                where: { id: payment.id },
                data: { status: 'FAILED' },
            });
            await auditService_1.auditService.log({
                eventType: 'PAYMENT_FAILED',
                schoolId: payment.schoolId,
                resourceSnapshot: {
                    paymentId: payment.id,
                    resultCode: ResultCode,
                    resultDesc: stkCallback.ResultDesc,
                },
            });
        }
    }
    /**
     * Get invoice/payment details.
     */
    async getInvoice(schoolId, paymentId) {
        const payment = await index_1.prisma.payment.findUnique({
            where: { id: paymentId },
        });
        if (!payment) {
            throw new errors_1.AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
        }
        if (payment.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
        }
        return {
            id: payment.id,
            schoolId: payment.schoolId,
            amount: payment.amount,
            planTier: payment.planTier,
            mpesaReceiptNumber: payment.mpesaReceiptNumber,
            status: payment.status,
            completedAt: payment.completedAt,
            invoiceUrl: payment.invoiceUrl,
            initiatedAt: payment.initiatedAt,
        };
    }
    /**
     * List payments for a school.
     */
    async listPayments(schoolId) {
        const payments = await index_1.prisma.payment.findMany({
            where: { schoolId },
            orderBy: { initiatedAt: 'desc' },
        });
        return payments;
    }
}
exports.PaymentService = PaymentService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.paymentService = new PaymentService();
//# sourceMappingURL=paymentService.js.map