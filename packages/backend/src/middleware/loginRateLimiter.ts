import { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createId } from '@paralleldrive/cuid2';
import { createRateLimitStore, getClientIp } from '../lib/rateLimitStore';

// ─── loginRateLimiter ─────────────────────────────────────────────────────────
// 20 failed login attempts per 15 minutes per IP.
// Successful requests are not counted (`skipSuccessfulRequests: true`).

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  store: createRateLimitStore('rl:login:'),
  passOnStoreError: true,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  handler: (req: Request, res: Response) => {
    const requestId = req.id ?? createId();
    res.status(429).json({
      error: 'Too many login attempts',
      code: 'RATE_LIMITED',
      requestId,
    });
  },
});
