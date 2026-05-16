"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.errorHandler = errorHandler;
// ─── AppError ─────────────────────────────────────────────────────────────────
// Structured application error that carries an HTTP status code, a machine-
// readable code, and optional extra details. Throw this anywhere in the
// request lifecycle; the global `errorHandler` will serialise it correctly.
class AppError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        // Restore prototype chain (required when extending built-ins in TypeScript)
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.AppError = AppError;
// ─── errorHandler ─────────────────────────────────────────────────────────────
// Global Express error-handling middleware. Must be registered AFTER all routes.
// Serialises AppError instances into a consistent JSON envelope; falls back to
// 500 for unexpected errors so internal details are never leaked to clients.
function errorHandler(err, req, res, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
_next) {
    const requestId = req.id ?? 'unknown';
    if (err instanceof AppError) {
        const body = {
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
//# sourceMappingURL=errors.js.map