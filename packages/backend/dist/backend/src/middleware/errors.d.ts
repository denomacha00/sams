import { type Request, type Response, type NextFunction } from 'express';
export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: unknown;
    constructor(statusCode: number, code: string, message: string, details?: unknown);
    /**
     * Type guard that works across module boundaries and Vitest module isolation.
     * Prefer this over `instanceof AppError` in tests and cross-module error handling.
     */
    static isAppError(err: unknown): err is AppError;
}
export declare function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void;
//# sourceMappingURL=errors.d.ts.map