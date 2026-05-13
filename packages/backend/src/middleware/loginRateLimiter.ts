import { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createId } from '@paralleldrive/cuid2';
import Redis from 'ioredis';

// ─── Dedicated Redis client ───────────────────────────────────────────────────
// Follows the same pattern as globalMiddleware.ts: a self-contained Redis
// client so this module can be imported independently.

const loginRateLimitRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: false,
});

loginRateLimitRedis.on('error', (err) => {
  console.error('[LoginRateLimitRedis] Error:', err);
});

// ─── loginRateLimiter ─────────────────────────────────────────────────────────
// 5 failed login attempts per 15 minutes per IP, backed by Redis.
// Successful requests are not counted (`skipSuccessfulRequests: true`).

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
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
  store: new RedisStore({
    sendCommand: (...args: string[]) => {
      const [command, ...rest] = args;
      return loginRateLimitRedis.call(command, ...rest) as Promise<
        boolean | number | string | (boolean | number | string)[]
      >;
    },
  }),
  handler: (req: Request, res: Response) => {
    const requestId = req.id ?? createId();
    res.status(429).json({
      error: 'Too many login attempts',
      code: 'RATE_LIMITED',
      requestId,
    });
  },
});
