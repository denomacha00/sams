"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const shared_1 = require("@sams/shared");
// ─── authenticate middleware ──────────────────────────────────────────────────
// Verifies the `Authorization: Bearer <token>` header, decodes the JWT using
// JWT_SECRET, and attaches the decoded payload to `req.user`.
// Returns 401 on missing, expired, or invalid tokens.
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
    }
    const token = authHeader.slice(7); // strip "Bearer "
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        // Misconfiguration — treat as server error but surface as 401 to avoid leaking internals
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, secret);
        // Validate that the payload has the required fields
        if (typeof payload.sub !== 'string' ||
            typeof payload.schoolId !== 'string' ||
            !Object.values(shared_1.UserRole).includes(payload.role)) {
            res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
            return;
        }
        req.user = {
            sub: payload.sub,
            schoolId: payload.schoolId,
            role: payload.role,
            departmentId: payload.departmentId,
            classId: payload.classId,
            iat: payload.iat,
            exp: payload.exp,
        };
        next();
    }
    catch {
        // Covers TokenExpiredError, JsonWebTokenError, NotBeforeError
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
}
//# sourceMappingURL=auth.js.map