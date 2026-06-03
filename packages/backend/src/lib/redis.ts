import Redis from 'ioredis';

function resolveRedisUrl(): string {
  const raw = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return raw.replace(/^["']+|["']+$/g, '').trim() || 'redis://localhost:6379';
}

/** Shared Redis client — import from here, not from index.ts (avoids circular deps). */
export const redis = new Redis(resolveRedisUrl(), {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err));
