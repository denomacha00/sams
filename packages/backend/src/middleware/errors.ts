import { type Request, type Response, type NextFunction } from 'express';

// ─── AppError ─────────────────────────────────────────────────────────────────
// Structured application error that carries an HTTP status code, a machine-
// readable code, and optional extra details. Throw this anywhere in the
// request lifecycle; the global `errorHandler` will serialise it correctly.

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Restore prototype chain (required when extending built-ins in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Type guard that works across module boundaries and Vitest module isolation.
   * Prefer this over `instanceof AppError` in tests and cross-module error handling.
   */
  static isAppError(err: unknown): err is AppError {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as AppError).name === 'AppError' &&
      typeof (err as AppError).statusCode === 'number' &&
      typeof (err as AppError).code === 'string'
    );
  }
}

// ─── errorHandler ─────────────────────────────────────────────────────────────
// Global Express error-handling middleware. Must be registered AFTER all routes.
// Serialises AppError instances into a consistent JSON envelope; falls back to
// 500 for unexpected errors so internal details are never leaked to clients.

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId: string = (req as Request & { id?: string }).id ?? 'unknown';

  if (AppError.isAppError(err)) {
    const body: {
      error: string;
      code: string;
      requestId: string;
      details?: unknown;
    } = {
      error: err.message,
      code: err.code,
      requestId,
    };

    if (err.details !== undefined) {
      body.details = err.details;
    }

    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected / unhandled error — log it but do not expose internals
  console.error('[errorHandler] Unhandled error:', err);

  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId,
  });
}
