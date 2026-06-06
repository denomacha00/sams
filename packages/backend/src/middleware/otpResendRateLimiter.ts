import { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createId } from '@paralleldrive/cuid2';
import { createRateLimitStore, getClientIp } from '../lib/rateLimitStore';

/** 5 OTP resend requests per 15 minutes per IP. */
export const otpResendRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: createRateLimitStore('rl:otp:'),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  handler: (req: Request, res: Response) => {
    const requestId = req.id ?? createId();
    res.status(429).json({
      error: 'Too many verification code requests. Please wait and try again.',
      code: 'RATE_LIMITED',
      requestId,
    });
  },
});
