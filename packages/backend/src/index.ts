import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { applyGlobalMiddleware } from './middleware/globalMiddleware';
import { authenticate } from './middleware/auth';
import { enforceSchoolScope } from './middleware/rbac';
import { errorHandler } from './middleware/errors';
import { authRouter } from './routes/auth';
import { activationRouter } from './routes/activation';
import { usersRouter, registrationLinksRouter } from './routes/users';
import { timetableRouter } from './routes/timetable';
import { sessionsRouter } from './routes/sessions';
import { attendanceRouter } from './routes/attendance';
import { paymentsRouter } from './routes/payments';
import { reportsRouter } from './routes/reports';
import { riskScoresRouter } from './routes/riskScores';
import { superAdminRouter } from './routes/superAdmin';
import { departmentsRouter, classesRouter } from './routes/departments';
import { aiRouter } from './routes/ai';
import { biometricRouter } from './routes/biometric';
import { notificationsRouter } from './routes/notifications';
import { setupAttendanceSocket } from './sockets/attendanceSocket';
import { startQRRefreshJob, stopQRRefreshJob } from './jobs/qrRefresh';
import { startNotificationJob, stopNotificationJob } from './jobs/notifications';

// ─── App & HTTP Server ────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);

// ─── Global Middleware ────────────────────────────────────────────────────────

applyGlobalMiddleware(app);

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

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((pub) => path === pub || path.startsWith(pub + '/') || path.startsWith(pub));
}

app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
  if (isPublicPath(req.baseUrl + req.path)) {
    next();
    return;
  }
  authenticate(req, res, () => enforceSchoolScope(req, res, next));
});

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/activate', activationRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/registration-links', registrationLinksRouter);
app.use('/api/v1/timetable', timetableRouter);
app.use('/api/v1/sessions', sessionsRouter);
app.use('/api/v1/attendance', attendanceRouter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/risk-scores', riskScoresRouter);
app.use('/api/v1/departments', departmentsRouter);
app.use('/api/v1/classes', classesRouter);
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/biometric', biometricRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/super', superAdminRouter);

// ─── Socket.io ────────────────────────────────────────────────────────────────

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST'],
  },
});

// Set up attendance socket handlers (auth, session:join, qr:subscribe)
setupAttendanceSocket(io);

// ─── Redis Client ─────────────────────────────────────────────────────────────

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err));

// ─── Prisma Client ────────────────────────────────────────────────────────────

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3001;

async function start(): Promise<void> {
  try {
    await redis.connect();
    await prisma.$connect();

    httpServer.listen(PORT, () => {
      console.log(`[SAMS] API listening on port ${PORT}`);

      // Conversation memory encryption check
      if (!process.env.CONVERSATION_MASTER_KEY || process.env.CONVERSATION_MASTER_KEY.length < 32) {
        console.warn('[STARTUP] CONVERSATION_MASTER_KEY not set or too short. Conversation memory will be disabled.');
      }

      startQRRefreshJob();
      startNotificationJob();
    });
  } catch (err) {
    console.error('[SAMS] Failed to start server:', err);
    process.exit(1);
  }
}

// ─── Graceful Shutdown (PM2-compatible) ───────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[SAMS] Received ${signal}. Shutting down gracefully...`);

  // Stop cron jobs
  stopQRRefreshJob();
  stopNotificationJob();

  // Stop accepting new connections
  httpServer.close(async () => {
    console.log('[SAMS] HTTP server closed.');

    try {
      // Disconnect Redis
      await redis.quit();
      console.log('[Redis] Disconnected.');
    } catch (err) {
      console.error('[Redis] Error during disconnect:', err);
    }

    try {
      // Disconnect Prisma
      await prisma.$disconnect();
      console.log('[Prisma] Disconnected.');
    } catch (err) {
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

app.use(errorHandler);

// ─── Exports ──────────────────────────────────────────────────────────────────

export { app, httpServer as server, io, redis, prisma };

// Start the server (skip when imported in tests)
if (require.main === module) {
  void start();
}
