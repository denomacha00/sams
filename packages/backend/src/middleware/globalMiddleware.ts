import { type Express, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createId } from '@paralleldrive/cuid2';
import { createRateLimitStore, getClientIp, skipOperationalProbe } from '../lib/rateLimitStore';

// ─── Augment Express Request to include `id` ─────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
// 200 requests per minute per IP. Production uses Redis so limits stay shared
// if PM2 runs more than one worker.

export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  store: createRateLimitStore('rl:global:'),
  passOnStoreError: true,
  standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  keyGenerator: getClientIp,
  handler: (req: Request, res: Response) => {
    const requestId = req.id ?? createId();
    res.status(429).json({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      requestId,
    });
  },
  skip: skipOperationalProbe,
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
  if (process.env.TRUST_PROXY_HOPS) {
    const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS, 10);
    if (Number.isFinite(hops) && hops > 0) app.set('trust proxy', hops);
  } else if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 'loopback');
  }

  // 1. Security headers
  app.use(helmet());

  // 2. CORS — origin controlled via environment variable
  // NOTE: When credentials:true, origin MUST be an explicit domain (not '*').
  // In production set CORS_ORIGIN to your frontend domain, e.g. https://app.smart-managment.com
  const corsOrigin = process.env.CORS_ORIGIN;
  app.use(
    cors({
      origin: corsOrigin && corsOrigin !== '*'
        ? corsOrigin
        : (origin, callback) => {
            // In development allow all origins; in production this path should not be hit
            // because CORS_ORIGIN should be set to the real domain.
            callback(null, origin || '*');
          },
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

  // 6. Global rate limiter (200 req/min/IP)
  app.use(globalRateLimiter);
}
