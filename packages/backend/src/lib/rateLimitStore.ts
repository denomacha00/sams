import type { Request } from 'express';
import type { Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redis } from './redis';

function configuredRateLimitStore(): 'memory' | 'redis' | 'auto' {
  const value = (process.env.RATE_LIMIT_STORE ?? 'auto').toLowerCase();
  return value === 'memory' || value === 'redis' || value === 'auto' ? value : 'auto';
}

export function getClientIp(req: Request): string {
  const cloudflareIp = req.headers['cf-connecting-ip'];
  if (typeof cloudflareIp === 'string' && cloudflareIp.trim()) {
    return cloudflareIp.trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.ip ?? 'unknown';
}

export function createRateLimitStore(prefix: string): Store | undefined {
  const mode = configuredRateLimitStore();
  if (process.env.NODE_ENV === 'test' || mode === 'memory') {
    return undefined;
  }
  if (mode === 'auto' && process.env.NODE_ENV !== 'production') {
    return undefined;
  }

  return new RedisStore({
    prefix,
    sendCommand: async (...args: string[]): Promise<RedisReply> => {
      const [command, ...commandArgs] = args;
      return redis.call(command, ...commandArgs) as Promise<RedisReply>;
    },
  });
}

export function skipOperationalProbe(req: Request): boolean {
  return req.path === '/metrics' || req.path === '/health' || req.path.startsWith('/health/');
}
