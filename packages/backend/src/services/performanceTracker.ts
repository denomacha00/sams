import { type Request, type Response, type NextFunction } from 'express';
import { superAdminFeaturesService } from './superAdminFeaturesService';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PerformanceTrackerOptions {
  /** Skip tracking for these paths (e.g., health/ready endpoints) */
  skipPaths?: RegExp[];
  /** Record every Nth request (default: 1 = every request). Use sampling in high-traffic environments */
  sampleRate?: number;
}

// ─── Default Options ────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: PerformanceTrackerOptions = {
  skipPaths: [
    /^\/health/,
    /^\/metrics/,
    /^\/uploads\//,
  ],
  sampleRate: 1,
};

// ─── Counter ────────────────────────────────────────────────────────────────

let requestCounter = 0;

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Express middleware that tracks API performance metrics.
 * Records duration, status code, path, and method for every request
 * (or sampled requests) after the response finishes.
 *
 * Usage: app.use(trackApiPerformance());
 */
export function trackApiPerformance(options?: PerformanceTrackerOptions) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip excluded paths
    if (opts.skipPaths?.some((pattern) => pattern.test(req.path))) {
      next();
      return;
    }

    // Sampling: skip requests that don't match the sample rate
    requestCounter++;
    if (opts.sampleRate && requestCounter % opts.sampleRate !== 0) {
      next();
      return;
    }

    const start = Date.now();

    // Listen for the response finish event
    res.on('finish', () => {
      const durationMs = Date.now() - start;

      // Extract schoolId from request if available (set by auth middleware)
      const schoolId = (req as any).schoolId ?? (req as any).user?.schoolId ?? (req as any).query?.schoolId ?? undefined;

      // Record the metric (fire-and-forget — never block the response)
      superAdminFeaturesService
        .recordApiMetric(req.path, req.method, res.statusCode, durationMs, schoolId)
        .catch((err) => {
          console.error('[PerformanceTracker] Failed to record API metric:', err);
        });
    });

    next();
  };
}

/**
 * Convenience export: the default middleware instance.
 * You can also call `trackApiPerformance({ sampleRate: 10 })` for custom config.
 */
export default trackApiPerformance;