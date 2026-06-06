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
