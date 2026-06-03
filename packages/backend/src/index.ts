import './config/loadEnv';
import express from 'express';
import { createServer } from 'http';
import { validateProductionSecrets } from './config/secrets';
import { isSmsConfigured } from './config/africasTalking';
import { isEmailConfigured } from './config/email';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { setApiReady } from './apiState';

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT ?? 3001;

async function connectDependencies(): Promise<void> {
  await redis.connect();
  await prisma.$connect();
  setApiReady(true);
  console.log('[SAMS] Database and Redis connected — API ready');

  const { getNotificationService } = await import('./services/notificationService');
  getNotificationService();

  if (!process.env.CONVERSATION_MASTER_KEY || process.env.CONVERSATION_MASTER_KEY.length < 32) {
    console.warn('[STARTUP] CONVERSATION_MASTER_KEY not set or too short. Conversation memory will be disabled.');
  }

  const {
    DEPRECATED_MODEL_MIGRATIONS,
    hasPrimaryAIKey,
    resolveChatModel,
  } = await import('./services/ai/aiProviderConfig');
  const { isConversationMemoryEnabled } = await import('./services/ai/roleActionsPrompt');
  if (!isConversationMemoryEnabled()) {
    console.warn(
      '[STARTUP] Encrypted conversation memory disabled — set CONVERSATION_MASTER_KEY (32+ chars).',
    );
  }

  if (!hasPrimaryAIKey()) {
    console.warn('[STARTUP] AI chat disabled — set OPENAI_API_KEY (see packages/backend/.env.example).');
  } else {
    const configuredModel = process.env.OPENAI_MODEL?.trim();
    if (configuredModel && configuredModel in DEPRECATED_MODEL_MIGRATIONS) {
      console.warn(
        `[STARTUP] OPENAI_MODEL=${configuredModel} is decommissioned; runtime will use ${resolveChatModel()} instead.`,
      );
    }
  }
  if (!isSmsConfigured()) {
    console.warn('[STARTUP] SMS disabled — set AT_API_KEY and AT_USERNAME in .env to enable Africa\'s Talking.');
  }
  if (!isEmailConfigured()) {
    console.warn('[STARTUP] Email disabled — set SMTP_USER and SMTP_PASS in .env to enable SMTP.');
  }

  const { startQRRefreshJob } = await import('./jobs/qrRefresh');
  const { startNotificationJob } = await import('./jobs/notifications');
  startQRRefreshJob();
  startNotificationJob();

  if (process.send) {
    process.send('ready');
  }
}

/** Start HTTP server and background jobs. Call from pm2-start.js or when run as main. */
export async function boot(): Promise<void> {
  try {
    validateProductionSecrets();

    console.log(`[SAMS] Binding port ${PORT}...`);
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(PORT, () => {
        console.log(`[SAMS] Bound port ${PORT} — accepting connections`);
        console.log(`[SAMS] API listening on port ${PORT}`);
        resolve();
      });
      httpServer.once('error', reject);
    });

    const { registerApplication } = await import('./registerApplication');
    registerApplication(app, httpServer);

    void connectDependencies().catch((err) => {
      console.error('[SAMS] Failed to connect dependencies:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('[SAMS] Failed to start server:', err);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[SAMS] Received ${signal}. Shutting down gracefully...`);

  const { stopQRRefreshJob } = await import('./jobs/qrRefresh');
  const { stopNotificationJob } = await import('./jobs/notifications');
  stopQRRefreshJob();
  stopNotificationJob();

  httpServer.close(async () => {
    console.log('[SAMS] HTTP server closed.');

    try {
      await redis.quit();
      console.log('[Redis] Disconnected.');
    } catch (err) {
      console.error('[Redis] Error during disconnect:', err);
    }

    try {
      await prisma.$disconnect();
      console.log('[Prisma] Disconnected.');
    } catch (err) {
      console.error('[Prisma] Error during disconnect:', err);
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.error('[SAMS] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 8000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app, httpServer as server, prisma, redis };
export { getIo as io } from './registerApplication';

if (require.main === module) {
  void boot();
}
