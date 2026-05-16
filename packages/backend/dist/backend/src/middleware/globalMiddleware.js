"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalRateLimiter = void 0;
exports.applyGlobalMiddleware = applyGlobalMiddleware;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const cuid2_1 = require("@paralleldrive/cuid2");
// ─── Global Rate Limiter ──────────────────────────────────────────────────────
// 200 requests per minute per IP, in-memory store (no Redis dependency).
exports.globalRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    max: 200,
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Prefer the real IP forwarded by NGINX over the socket address
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            return forwarded.split(',')[0].trim();
        }
        return req.ip ?? 'unknown';
    },
    handler: (req, res) => {
        const requestId = req.id ?? (0, cuid2_1.createId)();
        res.status(429).json({
            error: 'Too many requests',
            code: 'RATE_LIMITED',
            requestId,
        });
    },
    skip: () => false,
});
// ─── Request-ID Middleware ────────────────────────────────────────────────────
function requestIdMiddleware(req, res, next) {
    const id = (0, cuid2_1.createId)();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
}
// ─── HTTPS Redirect Middleware ────────────────────────────────────────────────
// Only active when FORCE_HTTPS=true. Disabled by default when behind Cloudflare
// (Cloudflare handles HTTPS at the edge).
function httpsRedirect(req, res, next) {
    if (process.env.FORCE_HTTPS === 'true' &&
        req.headers['x-forwarded-proto'] !== 'https') {
        const httpsUrl = `https://${req.headers.host ?? ''}${req.originalUrl}`;
        res.redirect(301, httpsUrl);
        return;
    }
    next();
}
// ─── applyGlobalMiddleware ────────────────────────────────────────────────────
function applyGlobalMiddleware(app) {
    // 1. Security headers
    app.use((0, helmet_1.default)());
    // 2. CORS — origin controlled via environment variable
    app.use((0, cors_1.default)({
        origin: process.env.CORS_ORIGIN ?? '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
        credentials: true,
    }));
    // 3. HTTPS redirect (production only)
    app.use(httpsRedirect);
    // 4. Body parsers
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: true }));
    // 5. Request-ID injection
    app.use(requestIdMiddleware);
    // 6. Global rate limiter (in-memory, 200 req/min/IP)
    app.use(exports.globalRateLimiter);
}
//# sourceMappingURL=globalMiddleware.js.map