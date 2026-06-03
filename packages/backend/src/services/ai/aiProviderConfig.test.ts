import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GROQ_CHAT_MODEL,
  DEPRECATED_MODEL_MIGRATIONS,
  formatProviderError,
  getMissingAIKeyMessage,
  resolveChatModel,
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
});
