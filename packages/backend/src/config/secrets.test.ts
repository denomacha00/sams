import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLicenseSecret, validateProductionSecrets } from './secrets';

const originalEnv = process.env;
const strongSecret = 'a'.repeat(64);

function setBaseProductionEnv() {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    JWT_SECRET: strongSecret,
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    QR_SECRET: 'c'.repeat(64),
    LICENSE_SECRET: 'd'.repeat(64),
  };
}

describe('production secret validation', () => {
  beforeEach(() => {
    setBaseProductionEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('requires LICENSE_SECRET in production', () => {
    delete process.env.LICENSE_SECRET;

    expect(() => validateProductionSecrets()).toThrow(/LICENSE_SECRET/);
  });

  it('does not allow license signing to fall back to JWT_SECRET in production', () => {
    delete process.env.LICENSE_SECRET;

    expect(() => getLicenseSecret()).toThrow(/LICENSE_SECRET/);
  });

  it('accepts distinct strong production secrets', () => {
    expect(() => validateProductionSecrets()).not.toThrow();
    expect(getLicenseSecret()).toBe('d'.repeat(64));
  });

  it('keeps the JWT fallback available outside production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
      JWT_SECRET: 'dev-jwt-secret',
    };

    expect(getLicenseSecret()).toBe('dev-jwt-secret');
  });
});
