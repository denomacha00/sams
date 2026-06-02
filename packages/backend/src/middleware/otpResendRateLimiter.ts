import { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createId } from '@paralleldrive/cuid2';

/** 5 OTP resend requests per 15 minutes per IP. */
export const otpResendRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? 'unknown';
  },
  handler: (req: Request, res: Response) => {
    const requestId = req.id ?? createId();
    res.status(429).json({
      error: 'Too many verification code requests. Please wait and try again.',
      code: 'RATE_LIMITED',
      requestId,
    });
  },
});
