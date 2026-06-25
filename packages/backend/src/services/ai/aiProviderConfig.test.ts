import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GROQ_CHAT_MODEL,
  DEFAULT_VISION_MODEL,
  DEPRECATED_MODEL_MIGRATIONS,
  formatProviderError,
  getMissingAIKeyMessage,
  getVisionClientConfigs,
  hasPrimaryAIKey,
  isModelProviderMismatch,
  isRealProviderKey,
  resolveAtomesusVisionModel,
  resolveChatModel,
  resolveVisionModel,
} from './aiProviderConfig';

describe('aiProviderConfig', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('migrates decommissioned Groq model IDs', () => {
    expect(DEPRECATED_MODEL_MIGRATIONS['llama3-70b-8192']).toBe('llama-3.3-70b-versatile');
    process.env.OPENAI_MODEL = 'llama3-70b-8192';
    expect(resolveChatModel()).toBe('llama-3.3-70b-versatile');
  });

  it('defaults to llama-3.3-70b-versatile when Groq base URL and no model set', () => {
    delete process.env.OPENAI_MODEL;
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    expect(resolveChatModel()).toBe(DEFAULT_GROQ_CHAT_MODEL);
  });

  it('formats decommissioned model errors for users', () => {
    const msg = formatProviderError(
      new Error('400 The model `llama3-70b-8192` has been decommissioned'),
    );
    expect(msg).toContain('llama-3.3-70b-versatile');
  });

  it('includes setup hints when API key is missing', () => {
    expect(getMissingAIKeyMessage()).toContain('OPENAI_API_KEY');
  });

  it('rejects placeholder API keys', () => {
    expect(isRealProviderKey('gsk_your-groq-api-key')).toBe(false);
    expect(isRealProviderKey('sk-or-v1-your-openrouter-key')).toBe(false);
    expect(isRealProviderKey('gsk_realKey123')).toBe(true);
    process.env.OPENAI_API_KEY = 'gsk_your-groq-api-key';
    expect(hasPrimaryAIKey()).toBe(false);
  });

  it('detects gpt-4o-mini on Groq as mismatch', () => {
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    expect(isModelProviderMismatch()).toBe(true);
    expect(formatProviderError(new Error('model_not_found')).toLowerCase()).toContain('groq');
  });

  it('defaults vision model to llama-4-scout', () => {
    delete process.env.VISION_MODEL;
    expect(resolveVisionModel()).toBe(DEFAULT_VISION_MODEL);
    process.env.VISION_MODEL = 'custom/vision-model';
    expect(resolveVisionModel()).toBe('custom/vision-model');
  });

  it('does not use placeholder OpenRouter key for vision fallback', () => {
    process.env.OPENAI_API_KEY = 'gsk_test';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.OPENAI_FALLBACK_KEY = 'sk-or-v1-your-openrouter-key';
    process.env.OPENAI_FALLBACK_URL = 'https://openrouter.ai/api/v1';

    const configs = getVisionClientConfigs();
    expect(configs.every((c) => c.label === 'fallback')).toBe(false);
    expect(configs[0]?.label).toBe('primary');
  });

  it('uses OpenRouter fallback client for vision when primary is Groq', () => {
    process.env.OPENAI_API_KEY = 'gsk_test';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.OPENAI_MODEL = 'llama-3.3-70b-versatile';
    process.env.OPENAI_FALLBACK_KEY = 'sk-or-test';
    process.env.OPENAI_FALLBACK_URL = 'https://openrouter.ai/api/v1';
    delete process.env.VISION_MODEL;

    const configs = getVisionClientConfigs();
    expect(configs[0]?.label).toBe('fallback');
  });

  it('uses primary client for vision when primary is OpenRouter', () => {
    process.env.OPENAI_API_KEY = 'sk-or-test';
    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.OPENAI_FALLBACK_KEY = 'gsk_test';
    process.env.OPENAI_FALLBACK_URL = 'https://api.groq.com/openai/v1';

    const configs = getVisionClientConfigs();
    expect(configs[0]?.label).toBe('primary');
    expect(configs.some((c) => c.label === 'fallback')).toBe(false);
  });

  it('adds Atomesus as a vision backup only when a vision model is configured', () => {
    process.env.ATOMESUS_API_KEY = 'atms_sk_real_key_1234567890';
    process.env.ATOMESUS_VISION_MODEL = 'cipher-vision';

    expect(resolveAtomesusVisionModel()).toBe('cipher-vision');
    const configs = getVisionClientConfigs();
    expect(configs.some((c) => c.label === 'atomesus' && c.model === 'cipher-vision')).toBe(true);
  });

  it('does not treat Atomesus text backup as image-capable without ATOMESUS_VISION_MODEL', () => {
    process.env.ATOMESUS_API_KEY = 'atms_sk_real_key_1234567890';
    delete process.env.ATOMESUS_VISION_MODEL;

    expect(resolveAtomesusVisionModel()).toBeNull();
    const configs = getVisionClientConfigs();
    expect(configs.some((c) => c.label === 'atomesus')).toBe(false);
  });

  it('formats vision-related provider errors', () => {
    const msg = formatProviderError(new Error('Model does not support image input'));
    expect(msg).toContain('VISION_MODEL');
    expect(msg).toContain('ATOMESUS_VISION_MODEL');
  });

  it('extracts HTTP status from API errors', () => {
    const err = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    expect(formatProviderError(err)).toContain('rate-limited');
  });

  it('classifies provider downtime (503)', () => {
    const msg = formatProviderError(new Error('503 Service Unavailable'));
    expect(msg.toLowerCase()).toContain('temporarily down');
  });

  it('uses fallback error when primary error is generic', () => {
    const msg = formatProviderError(
      new Error('Connection reset'),
      Object.assign(new Error('Too many requests'), { status: 429 }),
    );
    expect(msg.toLowerCase()).toContain('rate-limited');
  });

  it('logs unclassified errors and returns generic message', () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = formatProviderError(new Error('xyzzy unknown failure'));
    expect(msg).toContain('temporarily unavailable');
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
