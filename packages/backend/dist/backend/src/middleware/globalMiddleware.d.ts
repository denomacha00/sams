import { type Express } from 'express';
declare global {
    namespace Express {
        interface Request {
            id: string;
        }
    }
}
export declare const globalRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare function applyGlobalMiddleware(app: Express): void;
//# sourceMappingURL=globalMiddleware.d.ts.map