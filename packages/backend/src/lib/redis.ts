import Redis from 'ioredis';

function resolveRedisUrl(): string {
  const raw = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return raw.replace(/^["']+|["']+$/g, '').trim() || 'redis://localhost:6379';
}

/** Shared Redis client — import from here, not from index.ts (avoids circular deps). */
export const redis = new Redis(resolveRedisUrl(), {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 5000,
  commandTimeout: 5000,
  retryStrategy: (times) => Math.min(times * 250, 3000),
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err));

function waitForRedisReady(timeoutMs = 5000): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis did not become ready within ${timeoutMs}ms (status=${redis.status})`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('error', onError);
      redis.off('end', onEnd);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('Redis connection ended before ready'));
    };

    redis.once('ready', onReady);
    redis.once('error', onError);
    redis.once('end', onEnd);
  });
}

export async function ensureRedisConnected(): Promise<void> {
  if (redis.status === 'ready') return;

  if (redis.status === 'wait' || redis.status === 'end') {
    try {
      await redis.connect();
    } catch (err) {
      if (!String((err as Error).message).includes('already connecting/connected')) {
        throw err;
      }
    }
  }

  await waitForRedisReady();
}
