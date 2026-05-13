import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PlanTier } from '@sams/shared';
import { requirePermission } from '../middleware/rbac';
import { paymentService } from '../services/paymentService';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const initiatePaymentSchema = z.object({
  phone: z.string().min(9).max(15),
  amount: z.number().positive(),
  planTier: z.nativeEnum(PlanTier),
  accountReference: z.string().max(50).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const paymentsRouter = Router();

/**
 * POST /api/v1/payments/initiate
 * Initiate an M-Pesa STK Push payment.
 */
paymentsRouter.post('/initiate', requirePermission('manage:payments'), async (req: Request, res: Response): Promise<void> => {
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
    const result = await paymentService.initiateSTKPush(req.schoolId, parsed.data);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to initiate payment');
  }
});

/**
 * POST /api/v1/payments/callback
 * M-Pesa callback endpoint (public, IP-whitelisted).
 */
paymentsRouter.post('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    await paymentService.handleCallback(req.body);
    // M-Pesa expects a 200 response
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    // Still return 200 to M-Pesa to prevent retries
    console.error('[PaymentsRouter] Callback error:', err);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

/**
 * GET /api/v1/payments
 * List payments for the school.
 */
paymentsRouter.get('/', requirePermission('manage:payments'), async (req: Request, res: Response): Promise<void> => {
  try {
    const payments = await paymentService.listPayments(req.schoolId);
    res.status(200).json(payments);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list payments');
  }
});

/**
 * GET /api/v1/payments/:id/invoice
 * Get invoice/payment details.
 */
paymentsRouter.get('/:id/invoice', requirePermission('manage:payments'), async (req: Request, res: Response): Promise<void> => {
  try {
    const invoice = await paymentService.getInvoice(req.schoolId, req.params.id as string);
    res.status(200).json(invoice);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get invoice');
  }
});
