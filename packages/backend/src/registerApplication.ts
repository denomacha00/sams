import express, { type Request, type Response, type NextFunction } from 'express';
import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
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
import { superAdminFeaturesRouter } from './routes/superAdminFeatures';
import { departmentsRouter, classesRouter } from './routes/departments';
import { aiRouter } from './routes/ai';
import { biometricRouter } from './routes/biometric';
import { notificationsRouter } from './routes/notifications';
import { knowledgeRouter } from './routes/knowledge';
import { guardiansRouter } from './routes/guardians';
import { examsRouter } from './routes/exams';
import { teacherSubjectsRouter } from './routes/teacherSubjects';
import { parentChatRouter } from './routes/parentChat';
import { schemeOfWorkRouter } from './routes/schemeOfWork';
import { registerSocketServer } from './lib/socket';
import { setupAttendanceSocket } from './sockets/attendanceSocket';
import { setupTypingSocket } from './sockets/typingSocket';
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

const PUBLIC_ATTENDANCE_LINK_PATHS = [
  { method: 'GET', pattern: /^\/api\/v1\/attendance\/link\/[^/]+\/info$/ },
];

function isPublicPath(path: string, method?: string): boolean {
  if (PUBLIC_PATHS.some((pub) => path === pub || path.startsWith(pub + '/'))) {
    return true;
  }
  return [...PUBLIC_REGISTRATION_LINK_PATHS, ...PUBLIC_ATTENDANCE_LINK_PATHS].some(
    (p) => (!method || p.method === method) && p.pattern.test(path),
  );
}

let io: SocketIOServer | null = null;
const PROCESS_STARTED_AT = new Date();

export function getIo(): SocketIOServer {
  if (!io) {
    throw new Error('[SAMS] Socket.io not initialized');
  }
  return io;
}

function runtimeSnapshot() {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    startedAt: PROCESS_STARTED_AT.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
    },
  };
}

function prometheusMetrics(): string {
  const memory = process.memoryUsage();
  const ready = isApiReady() ? 1 : 0;
  return [
    '# HELP sams_api_ready Whether the SAMS API has connected dependencies.',
    '# TYPE sams_api_ready gauge',
    `sams_api_ready ${ready}`,
    '# HELP sams_api_uptime_seconds Process uptime in seconds.',
    '# TYPE sams_api_uptime_seconds counter',
    `sams_api_uptime_seconds ${process.uptime().toFixed(0)}`,
    '# HELP sams_api_memory_rss_bytes Resident set size in bytes.',
    '# TYPE sams_api_memory_rss_bytes gauge',
    `sams_api_memory_rss_bytes ${memory.rss}`,
    '# HELP sams_api_memory_heap_used_bytes V8 heap used in bytes.',
    '# TYPE sams_api_memory_heap_used_bytes gauge',
    `sams_api_memory_heap_used_bytes ${memory.heapUsed}`,
    '# HELP sams_api_process_start_time_seconds Unix timestamp when the process started.',
    '# TYPE sams_api_process_start_time_seconds gauge',
    `sams_api_process_start_time_seconds ${Math.floor(PROCESS_STARTED_AT.getTime() / 1000)}`,
    '',
  ].join('\n');
}

function setupSocketRedisAdapter(socketServer: SocketIOServer): void {
  if (process.env.NODE_ENV === 'test' || process.env.SOCKET_IO_REDIS_ADAPTER === 'false') {
    return;
  }

  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  pubClient.on('error', (err) => console.error('[Socket] Redis pub adapter error:', err));
  subClient.on('error', (err) => console.error('[Socket] Redis sub adapter error:', err));

  void Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      socketServer.adapter(createAdapter(pubClient, subClient));
      console.log('[Socket] Redis adapter enabled for multi-worker broadcasts');
    })
    .catch((err) => {
      console.error('[Socket] Redis adapter disabled; socket broadcasts are local to this worker:', err);
      pubClient.disconnect();
      subClient.disconnect();
    });
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
  app.use('/api/v1/guardians', guardiansRouter);
  app.use('/api/v1/exams', examsRouter);
  app.use('/api/v1/super', superAdminRouter);
  app.use('/api/v1/super', superAdminFeaturesRouter);
  app.use('/api/v1/teacher-subjects', teacherSubjectsRouter);
  app.use('/api/v1/parent-chat', parentChatRouter);
  app.use('/api/v1/schemes', schemeOfWorkRouter);

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN ?? '*',
      methods: ['GET', 'POST'],
    },
  });

  setupSocketRedisAdapter(io);
  registerSocketServer(io);
  setupAttendanceSocket(io);
  setupTypingSocket(io);

  app.get('/health/live', (_req, res) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      runtime: runtimeSnapshot(),
    });
  });

  app.get('/health/ready', (_req, res) => {
    const ready = isApiReady();
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'starting',
      timestamp: new Date().toISOString(),
      checks: { apiReady: ready },
      runtime: runtimeSnapshot(),
    });
  });

  app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(prometheusMetrics());
  });

  app.get('/health', async (_req, res) => {
    if (!isApiReady()) {
      res.status(503).json({
        status: 'starting',
        timestamp: new Date().toISOString(),
        checks: { database: false, redis: false },
        runtime: runtimeSnapshot(),
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
      runtime: runtimeSnapshot(),
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
