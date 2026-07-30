import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';
import { getClientIp } from './rateLimitStore';

/**
 * getClientIp underpins every per-IP rate limiter (login, OTP, global,
 * guest-AI). These tests pin the spoofing defense: proxy-supplied IP headers
 * must only be honored when a trusted proxy is declared in front.
 */
function makeReq(headers: Record<string, string>, ip = '203.0.113.9'): Request {
  return { headers, ip } as unknown as Request;
}

describe('getClientIp', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.TRUST_PROXY_HOPS;
    delete process.env.TRUST_PROXY_HEADERS;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('ignores spoofable IP headers when no trusted proxy is configured', () => {
    const req = makeReq(
      {
        'cf-connecting-ip': '1.1.1.1',
        'x-real-ip': '2.2.2.2',
        'x-forwarded-for': '3.3.3.3',
      },
      '203.0.113.9',
    );
    // Attacker-controlled headers must NOT win; the real socket IP does.
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  it('trusts CF-Connecting-IP when TRUST_PROXY_HOPS is set', () => {
    process.env.TRUST_PROXY_HOPS = '1';
    const req = makeReq({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' });
    expect(getClientIp(req)).toBe('1.1.1.1');
  });

  it('falls back to X-Real-IP when CF header is absent behind a proxy', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    const req = makeReq({ 'x-real-ip': '2.2.2.2' });
    expect(getClientIp(req)).toBe('2.2.2.2');
  });

  it('does not hand-parse X-Forwarded-For even when trusted (relies on req.ip)', () => {
    process.env.TRUST_PROXY_HOPS = '1';
    const req = makeReq({ 'x-forwarded-for': '3.3.3.3' }, '203.0.113.9');
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  it('ignores a non-positive TRUST_PROXY_HOPS value', () => {
    process.env.TRUST_PROXY_HOPS = '0';
    const req = makeReq({ 'cf-connecting-ip': '1.1.1.1' }, '203.0.113.9');
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  it('returns "unknown" when no IP is resolvable', () => {
    const req = { headers: {} } as unknown as Request;
    expect(getClientIp(req)).toBe('unknown');
  });
});
