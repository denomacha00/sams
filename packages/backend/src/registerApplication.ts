import express, { type Request, type Response, type NextFunction } from 'express';
import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { UPLOADS_ROOT } from './config/uploads';
import { getAfricasTalkingConfig, getAtSmsMode, isSmsConfigured } from './config/africasTalking';
import { getSmtpConfig, isEmailConfigured } from './config/email';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { applyGlobalMiddleware } from './middleware/globalMiddleware';
import { authenticate } from './middleware/auth';
import { enforceSchoolScope } from './middleware/rbac';
import { licenseGuard } from './middleware/licenseGuard';
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
import { knowledgeRouter } from './routes/knowledge';
import { registerSocketServer } from './lib/socket';
import { setupAttendanceSocket } from './sockets/attendanceSocket';
import { isApiReady } from './apiState';
import { getAIHealthSummary, probeAIProvider } from './services/ai/aiProviderConfig';

const PUBLIC_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/verify-otp',
  '/api/v1/auth/forgot-password-otp',
  '/api/v1/auth/reset-password-otp',
  '/api/v1/auth/webauthn/authenticate/options',
  '/api/v1/auth/webauthn/authenticate/verify',
  '/api/v1/activate',
  '/api/v1/payments/callback',
  '/api/v1/ai/query',
  '/api/v1/ai/query-with-image',
  '/api/v1/ai/generate-image',
  '/api/v1/ai/voice',
];

const PUBLIC_REGISTRATION_LINK_PATHS = [
  { method: 'GET', pattern: /^\/api\/v1\/registration-links\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/v1\/registration-links\/[^/]+\/register$/ },
];

function isPublicPath(path: string, method?: string): boolean {
  if (PUBLIC_PATHS.some((pub) => path === pub || path.startsWith(pub + '/'))) {
    return true;
  }
  return PUBLIC_REGISTRATION_LINK_PATHS.some(
    (p) => (!method || p.method === method) && p.pattern.test(path),
  );
}

let io: SocketIOServer | null = null;

export function getIo(): SocketIOServer {
  if (!io) {
    throw new Error('[SAMS] Socket.io not initialized');
  }
  return io;
}

/** Mount routes, sockets, and full /health after HTTP listen (heavy imports stay out of index.ts). */
export function registerApplication(app: express.Express, httpServer: HttpServer): void {
  applyGlobalMiddleware(app);
  app.use('/uploads', express.static(UPLOADS_ROOT));

  app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
    if (isPublicPath(req.baseUrl + req.path, req.method)) {
      next();
      return;
    }
    authenticate(req, res, () => {
      enforceSchoolScope(req, res, () => {
        void licenseGuard(req, res, next);
      });
    });
  });

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
  app.use('/api/v1/knowledge', knowledgeRouter);
  app.use('/api/v1/super', superAdminRouter);

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN ?? '*',
      methods: ['GET', 'POST'],
    },
  });

  registerSocketServer(io);
  setupAttendanceSocket(io);

  app.get('/health', async (_req, res) => {
    if (!isApiReady()) {
      res.status(503).json({
        status: 'starting',
        timestamp: new Date().toISOString(),
        checks: { database: false, redis: false },
      });
      return;
    }

    const atCfg = isSmsConfigured() ? getAfricasTalkingConfig() : null;
    const smtpCfg = isEmailConfigured() ? getSmtpConfig() : null;

    let dbOk = false;
    let redisOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
    try {
      const pong = await redis.ping();
      redisOk = pong === 'PONG';
    } catch {
      redisOk = false;
    }

    const aiSummary = getAIHealthSummary();
    const aiProbeRequested =
      _req.query.ai_probe === '1' || _req.query.ai_probe === 'true';

    let aiProbe: Awaited<ReturnType<typeof probeAIProvider>> | undefined;
    if (aiProbeRequested && aiSummary.configured && !aiSummary.modelMismatch) {
      try {
        aiProbe = await probeAIProvider(12000);
      } catch (err) {
        aiProbe = { ok: false, provider: 'none', error: (err as Error).message };
      }
    }

    const ready = dbOk && redisOk;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: { database: dbOk, redis: redisOk },
      ai: {
        ...aiSummary,
        ...(aiProbe ? { probe: aiProbe } : {}),
      },
      sms: atCfg
        ? {
            configured: true,
            sandbox: atCfg.sandbox,
            mode: getAtSmsMode(atCfg),
            username: atCfg.username,
            senderId: atCfg.senderId,
          }
        : { configured: false, mode: 'unconfigured' as const },
      email: smtpCfg
        ? { configured: true, host: smtpCfg.host, from: smtpCfg.fromEmail }
        : { configured: false },
      otp: {
        loginEnabled: process.env.OTP_LOGIN_ENABLED === 'true',
        passwordResetEnabled: process.env.OTP_PASSWORD_RESET_ENABLED === 'true',
      },
    });
  });

  app.use(errorHandler);

  console.log('[SAMS] Application routes and sockets registered');
}
