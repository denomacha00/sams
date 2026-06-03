import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRegistrationLinkUrl,
  getAppBaseUrl,
  normalizePublicBaseUrl,
} from './registrationLinkUrl';

const ENV_KEYS = ['FRONTEND_URL', 'APP_URL', 'CORS_ORIGIN', 'NODE_ENV'] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const val = snapshot[key];
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
}

describe('registrationLinkUrl', () => {
  const envSnapshot = saveEnv();

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('prefers FRONTEND_URL over APP_URL', () => {
    process.env.FRONTEND_URL = 'https://frontend.example/';
    process.env.APP_URL = 'https://app.example.com';
    expect(getAppBaseUrl()).toBe('https://frontend.example');
    expect(buildRegistrationLinkUrl('tok-1')).toBe('https://frontend.example/register/tok-1');
  });

  it('falls back to APP_URL when FRONTEND_URL is unset', () => {
    delete process.env.FRONTEND_URL;
    process.env.APP_URL = 'https://app.smart-managment.com';
    expect(buildRegistrationLinkUrl('abc123')).toBe(
      'https://app.smart-managment.com/register/abc123',
    );
  });

  it('falls back to CORS_ORIGIN when FRONTEND_URL and APP_URL are unset', () => {
    delete process.env.FRONTEND_URL;
    delete process.env.APP_URL;
    process.env.CORS_ORIGIN = 'https://app.smart-managment.com';
    expect(buildRegistrationLinkUrl('x')).toBe('https://app.smart-managment.com/register/x');
  });

  it('upgrades http to https in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_URL;
    process.env.APP_URL = 'http://app.smart-managment.com';
    expect(buildRegistrationLinkUrl('t')).toBe('https://app.smart-managment.com/register/t');
  });

  it('keeps http in non-production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.FRONTEND_URL;
    process.env.APP_URL = 'http://localhost:5173';
    expect(normalizePublicBaseUrl('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('defaults to local dev when no env is set', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(buildRegistrationLinkUrl('dev')).toBe('http://localhost:5173/register/dev');
  });
});
