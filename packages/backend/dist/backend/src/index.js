"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = exports.redis = exports.io = exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const ioredis_1 = __importDefault(require("ioredis"));
const client_1 = require("@prisma/client");
const globalMiddleware_1 = require("./middleware/globalMiddleware");
const auth_1 = require("./middleware/auth");
const rbac_1 = require("./middleware/rbac");
const errors_1 = require("./middleware/errors");
const auth_2 = require("./routes/auth");
const activation_1 = require("./routes/activation");
const users_1 = require("./routes/users");
const timetable_1 = require("./routes/timetable");
const sessions_1 = require("./routes/sessions");
const attendance_1 = require("./routes/attendance");
const payments_1 = require("./routes/payments");
const reports_1 = require("./routes/reports");
const riskScores_1 = require("./routes/riskScores");
const superAdmin_1 = require("./routes/superAdmin");
const departments_1 = require("./routes/departments");
const ai_1 = require("./routes/ai");
const biometric_1 = require("./routes/biometric");
const notifications_1 = require("./routes/notifications");
const knowledge_1 = require("./routes/knowledge");
const attendanceSocket_1 = require("./sockets/attendanceSocket");
const qrRefresh_1 = require("./jobs/qrRefresh");
const notifications_2 = require("./jobs/notifications");
// ─── App & HTTP Server ────────────────────────────────────────────────────────
const app = (0, express_1.default)();
exports.app = app;
const httpServer = (0, http_1.createServer)(app);
exports.server = httpServer;
// ─── Global Middleware ────────────────────────────────────────────────────────
(0, globalMiddleware_1.applyGlobalMiddleware)(app);
// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// ─── Public API routes (no auth required) ────────────────────────────────────
// These are registered before the global auth guard so they remain accessible
// without a Bearer token.
//
//   POST /api/v1/auth/login
//   POST /api/v1/auth/refresh
//   POST /api/v1/activate
//
// Route modules will be mounted here as they are implemented (Task 4.5, 5.2).
// ─── Global auth + school-scope guard for /api/v1 ────────────────────────────
// Every request to /api/v1/* that is NOT one of the public paths above must
// carry a valid Bearer token. `authenticate` verifies the JWT and attaches
// `req.user`; `enforceSchoolScope` copies `req.user.schoolId` → `req.schoolId`
// so all downstream DB queries are automatically tenant-scoped.
//
// Public paths are excluded via a simple path-prefix check so they never reach
// the auth middleware.
const PUBLIC_PATHS = [
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
    '/api/v1/auth/forgot-password',
    '/api/v1/activate',
    '/api/v1/registration-links/',
    '/api/v1/payments/callback',
    '/api/v1/ai/query',
];
function isPublicPath(path) {
    return PUBLIC_PATHS.some((pub) => path === pub || path.startsWith(pub + '/') || path.startsWith(pub));
}
app.use('/api/v1', (req, res, next) => {
    if (isPublicPath(req.baseUrl + req.path)) {
        next();
        return;
    }
    (0, auth_1.authenticate)(req, res, () => (0, rbac_1.enforceSchoolScope)(req, res, next));
});
// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/auth', auth_2.authRouter);
app.use('/api/v1/activate', activation_1.activationRouter);
app.use('/api/v1/users', users_1.usersRouter);
app.use('/api/v1/registration-links', users_1.registrationLinksRouter);
app.use('/api/v1/timetable', timetable_1.timetableRouter);
app.use('/api/v1/sessions', sessions_1.sessionsRouter);
app.use('/api/v1/attendance', attendance_1.attendanceRouter);
app.use('/api/v1/payments', payments_1.paymentsRouter);
app.use('/api/v1/reports', reports_1.reportsRouter);
app.use('/api/v1/risk-scores', riskScores_1.riskScoresRouter);
app.use('/api/v1/departments', departments_1.departmentsRouter);
app.use('/api/v1/classes', departments_1.classesRouter);
app.use('/api/v1/ai', ai_1.aiRouter);
app.use('/api/v1/biometric', biometric_1.biometricRouter);
app.use('/api/v1/notifications', notifications_1.notificationsRouter);
app.use('/api/v1/knowledge', knowledge_1.knowledgeRouter);
app.use('/api/v1/super', superAdmin_1.superAdminRouter);
// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN ?? '*',
        methods: ['GET', 'POST'],
    },
});
exports.io = io;
// Set up attendance socket handlers (auth, session:join, qr:subscribe)
(0, attendanceSocket_1.setupAttendanceSocket)(io);
// ─── Redis Client ─────────────────────────────────────────────────────────────
const redis = new ioredis_1.default(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
});
exports.redis = redis;
redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err));
// ─── Prisma Client ────────────────────────────────────────────────────────────
const prisma = new client_1.PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
exports.prisma = prisma;
// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001;
async function start() {
    try {
        await redis.connect();
        await prisma.$connect();
        httpServer.listen(PORT, () => {
            console.log(`[SAMS] API listening on port ${PORT}`);
            // Conversation memory encryption check
            if (!process.env.CONVERSATION_MASTER_KEY || process.env.CONVERSATION_MASTER_KEY.length < 32) {
                console.warn('[STARTUP] CONVERSATION_MASTER_KEY not set or too short. Conversation memory will be disabled.');
            }
            (0, qrRefresh_1.startQRRefreshJob)();
            (0, notifications_2.startNotificationJob)();
        });
    }
    catch (err) {
        console.error('[SAMS] Failed to start server:', err);
        process.exit(1);
    }
}
// ─── Graceful Shutdown (PM2-compatible) ───────────────────────────────────────
async function shutdown(signal) {
    console.log(`[SAMS] Received ${signal}. Shutting down gracefully...`);
    // Stop cron jobs
    (0, qrRefresh_1.stopQRRefreshJob)();
    (0, notifications_2.stopNotificationJob)();
    // Stop accepting new connections
    httpServer.close(async () => {
        console.log('[SAMS] HTTP server closed.');
        try {
            // Disconnect Redis
            await redis.quit();
            console.log('[Redis] Disconnected.');
        }
        catch (err) {
            console.error('[Redis] Error during disconnect:', err);
        }
        try {
            // Disconnect Prisma
            await prisma.$disconnect();
            console.log('[Prisma] Disconnected.');
        }
        catch (err) {
            console.error('[Prisma] Error during disconnect:', err);
        }
        process.exit(0);
    });
    // Force exit if graceful shutdown takes too long (PM2 kill timeout is 5s by default)
    setTimeout(() => {
        console.error('[SAMS] Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 8000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
// ─── Global Error Handler ─────────────────────────────────────────────────────
// Must be registered after all routes. Catches any AppError (or unexpected
// error) thrown or passed to next(err) in route handlers / middleware.
app.use(errors_1.errorHandler);
// Start the server (skip when imported in tests)
if (require.main === module) {
    void start();
}
//# sourceMappingURL=index.js.map