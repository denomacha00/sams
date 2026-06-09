import { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createId } from '@paralleldrive/cuid2';
import { createRateLimitStore, getClientIp } from '../lib/rateLimitStore';

// ─── loginRateLimiter ─────────────────────────────────────────────────────────
// Extra IP-level protection without creating long support lockouts.
// Account-level auth still enforces 15 failed attempts => 1 minute cooldown.
// Successful requests are not counted (`skipSuccessfulRequests: true`).

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
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
