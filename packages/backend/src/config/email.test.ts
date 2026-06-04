import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  EMAIL_NOT_CONFIGURED_MESSAGE,
  getSmtpConfig,
  isEmailConfigured,
} from './email';

describe('email config', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  afterEach(() => {
    process.env = env;
  });

  it('isEmailConfigured is false without SMTP credentials', () => {
    expect(isEmailConfigured()).toBe(false);
    expect(getSmtpConfig()).toBeNull();
  });

  it('exposes a stable not-configured message for API responses', () => {
    expect(EMAIL_NOT_CONFIGURED_MESSAGE).toContain('Email is not configured');
  });
});
