import { afterEach, describe, expect, it } from 'vitest';
import { getAfricasTalkingConfig, getAtSmsMode, isSmsConfigured } from './africasTalking';

describe('africasTalking config', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('detects sandbox from AT_USERNAME', () => {
    process.env.AT_API_KEY = 'atsk_test_key';
    process.env.AT_USERNAME = 'sandbox';
    const cfg = getAfricasTalkingConfig();
    expect(cfg?.sandbox).toBe(true);
    expect(getAtSmsMode(cfg)).toBe('sandbox');
  });

  it('detects production from live username', () => {
    process.env.AT_API_KEY = 'prod_key_example';
    process.env.AT_USERNAME = 'MyLiveApp';
    const cfg = getAfricasTalkingConfig();
    expect(cfg?.sandbox).toBe(false);
    expect(cfg?.username).toBe('myliveapp');
    expect(getAtSmsMode(cfg)).toBe('production');
  });

  it('returns unconfigured when API key is placeholder', () => {
    process.env.AT_API_KEY = 'your-africastalking-api-key';
    process.env.AT_USERNAME = 'liveapp';
    expect(getAfricasTalkingConfig()).toBeNull();
    expect(isSmsConfigured()).toBe(false);
    expect(getAtSmsMode(null)).toBe('unconfigured');
  });

  it('defaults username to sandbox when unset', () => {
    process.env.AT_API_KEY = 'atsk_test';
    delete process.env.AT_USERNAME;
    const cfg = getAfricasTalkingConfig();
    expect(cfg?.sandbox).toBe(true);
  });
});
