"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const cuid2_1 = require("@paralleldrive/cuid2");
// ─── loginRateLimiter ─────────────────────────────────────────────────────────
// 20 failed login attempts per 15 minutes per IP, in-memory store (no Redis).
// Successful requests are not counted (`skipSuccessfulRequests: true`).
exports.loginRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            return forwarded.split(',')[0].trim();
        }
        return req.ip ?? 'unknown';
    },
    handler: (req, res) => {
        const requestId = req.id ?? (0, cuid2_1.createId)();
        res.status(429).json({
            error: 'Too many login attempts',
            code: 'RATE_LIMITED',
            requestId,
        });
    },
});
//# sourceMappingURL=loginRateLimiter.js.map