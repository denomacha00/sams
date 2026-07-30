import type { Request } from 'express';
import type { Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redis } from './redis';

function configuredRateLimitStore(): 'memory' | 'redis' | 'auto' {
  const value = (process.env.RATE_LIMIT_STORE ?? 'auto').toLowerCase();
  return value === 'memory' || value === 'redis' || value === 'auto' ? value : 'auto';
}

/**
 * Whether we sit behind a proxy we control (Cloudflare/nginx) that sets the
 * client-IP headers authoritatively. Only then are those headers trustworthy —
 * otherwise any client can spoof them to dodge rate limits. Enabled when
 * TRUST_PROXY_HOPS is a positive number (same signal used for Express's
 * `trust proxy`) or TRUST_PROXY_HEADERS is explicitly "true".
 */
function proxyHeadersTrusted(): boolean {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10);
  if (Number.isFinite(hops) && hops > 0) return true;
  return (process.env.TRUST_PROXY_HEADERS ?? '').trim().toLowerCase() === 'true';
}

export function getClientIp(req: Request): string {
  // Only honor proxy-supplied IP headers when a trusted proxy is in front.
  // Without this guard a guest could rotate X-Forwarded-For on every request
  // and never trip the per-IP rate limiters (login, OTP, global, guest-AI).
  if (proxyHeadersTrusted()) {
    const cloudflareIp = req.headers['cf-connecting-ip'];
    if (typeof cloudflareIp === 'string' && cloudflareIp.trim()) {
      return cloudflareIp.trim();
    }

    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) {
      return realIp.trim();
    }
    // X-Forwarded-For is intentionally NOT parsed by hand here: Express's
    // `trust proxy` setting already derives req.ip from the correct XFF hop,
    // which is spoof-resistant. Fall through to req.ip below.
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
