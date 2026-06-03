import { afterEach, describe, expect, it } from 'vitest';
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

  it('formats vision-related provider errors', () => {
    const msg = formatProviderError(new Error('Model does not support image input'));
    expect(msg).toContain('VISION_MODEL');
  });
});
