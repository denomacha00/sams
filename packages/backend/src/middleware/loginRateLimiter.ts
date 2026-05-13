import { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createId } from '@paralleldrive/cuid2';

// ─── loginRateLimiter ─────────────────────────────────────────────────────────
// 20 failed login attempts per 15 minutes per IP, in-memory store (no Redis).
// Successful requests are not counted (`skipSuccessfulRequests: true`).

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skipSuccessfulRequests: true,
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
      error: 'Too many login attempts',
      code: 'RATE_LIMITED',
      requestId,
    });
  },
});
