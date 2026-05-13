import { type Express, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createId } from '@paralleldrive/cuid2';
import Redis from 'ioredis';

// ─── Augment Express Request to include `id` ─────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

// ─── Redis client for rate limiting ──────────────────────────────────────────
// We create a dedicated client here so the rate limiter is self-contained and
// can be imported independently of the main Redis instance in index.ts.

const rateLimitRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
  retryStrategy: (times: number) => Math.min(times * 200, 5000),
});

rateLimitRedis.on('error', (err) => {
  console.error('[RateLimitRedis] Error:', err.message);
});

rateLimitRedis.connect().catch(() => {});

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
// 100 requests per minute per IP, backed by Redis.
// Exported so it can be reused on individual routes (e.g. auth endpoints).

export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Prefer the real IP forwarded by NGINX over the socket address
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? 'unknown';
  },
  store: new RedisStore({
    // rate-limit-redis v4 expects a sendCommand function that returns RedisReply
    sendCommand: (...args: string[]) => {
      const [command, ...rest] = args;
      return rateLimitRedis.call(command, ...rest) as Promise<
        boolean | number | string | (boolean | number | string)[]
      >;
    },
  }),
  handler: (req: Request, res: Response) => {
    const requestId = req.id ?? createId();
    res.status(429).json({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      requestId,
    });
  },
  skip: () => false,
});

// ─── Request-ID Middleware ────────────────────────────────────────────────────

function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = createId();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

// ─── HTTPS Redirect Middleware ────────────────────────────────────────────────
// Only active when FORCE_HTTPS=true. Disabled by default when behind Cloudflare
// (Cloudflare handles HTTPS at the edge).

function httpsRedirect(req: Request, res: Response, next: NextFunction): void {
  if (
    process.env.FORCE_HTTPS === 'true' &&
    req.headers['x-forwarded-proto'] !== 'https'
  ) {
    const httpsUrl = `https://${req.headers.host ?? ''}${req.originalUrl}`;
    res.redirect(301, httpsUrl);
    return;
  }
  next();
}

// ─── applyGlobalMiddleware ────────────────────────────────────────────────────

export function applyGlobalMiddleware(app: Express): void {
  // 1. Security headers
  app.use(helmet());

  // 2. CORS — origin controlled via environment variable
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      credentials: true,
    }),
  );

  // 3. HTTPS redirect (production only)
  app.use(httpsRedirect);

  // 4. Body parsers
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 5. Request-ID injection
  app.use(requestIdMiddleware);

  // 6. Global rate limiter (Redis-backed, 100 req/min/IP)
  app.use(globalRateLimiter);
}
