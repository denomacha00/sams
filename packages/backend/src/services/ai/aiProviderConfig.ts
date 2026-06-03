import OpenAI from 'openai';

/** Groq decommissioned these IDs — map to current replacements. */
export const DEPRECATED_MODEL_MIGRATIONS: Record<string, string> = {
  'llama3-70b-8192': 'llama-3.3-70b-versatile',
  'llama3-8b-8192': 'llama-3.1-8b-instant',
  'llama-3.1-70b-versatile': 'llama-3.3-70b-versatile',
};

export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile';
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENROUTER_FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';

export function getPrimaryBaseURL(): string {
  return process.env.OPENAI_BASE_URL?.trim() || DEFAULT_GROQ_BASE_URL;
}

export function isGroqBaseURL(baseURL: string): boolean {
  return baseURL.includes('groq.com');
}

/**
 * Resolve chat model from env, with deprecated-ID migration and provider-aware defaults.
 */
export function resolveChatModel(): string {
  const configured = process.env.OPENAI_MODEL?.trim();
  if (!configured) {
    return isGroqBaseURL(getPrimaryBaseURL())
      ? DEFAULT_GROQ_CHAT_MODEL
      : DEFAULT_OPENAI_CHAT_MODEL;
  }
  return DEPRECATED_MODEL_MIGRATIONS[configured] ?? configured;
}

export function resolveFallbackChatModel(): string {
  const configured = process.env.OPENAI_FALLBACK_MODEL?.trim();
  if (!configured) return DEFAULT_OPENROUTER_FALLBACK_MODEL;
  return DEPRECATED_MODEL_MIGRATIONS[configured] ?? configured;
}

export function hasPrimaryAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getMissingAIKeyMessage(): string {
  return (
    'AI chat is not configured on this server. Your administrator must set OPENAI_API_KEY in the backend .env. ' +
    'For Groq (free tier): OPENAI_BASE_URL=https://api.groq.com/openai/v1 and OPENAI_MODEL=llama-3.3-70b-versatile. ' +
    'Optional backup: OPENAI_FALLBACK_KEY with OPENAI_FALLBACK_URL=https://openrouter.ai/api/v1.'
  );
}

/**
 * Turn provider/API errors into a short message safe to show in the chat UI.
 */
export function formatProviderError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('openai_api_key') || lower.includes('api key is not set')) {
    return getMissingAIKeyMessage();
  }
  if (lower.includes('decommissioned') || lower.includes('model_decommissioned') || lower.includes('model_not_found')) {
    return (
      'The configured AI model is no longer available. On the server, set OPENAI_MODEL=llama-3.3-70b-versatile for Groq ' +
      '(or gpt-4o-mini for OpenAI), then restart the backend.'
    );
  }
  if (lower.includes('incorrect api key') || lower.includes('invalid_api_key') || lower.includes('401')) {
    return 'The AI API key is invalid or expired. Update OPENAI_API_KEY in the server .env and restart the backend.';
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('rate_limit')) {
    return 'The AI service is rate-limited. Wait a moment and try again, or ask your administrator to add OPENAI_FALLBACK_KEY (OpenRouter).';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('econnrefused')) {
    return 'The AI service did not respond in time. Check OPENAI_BASE_URL and network access from the server, then try again.';
  }

  return 'The AI service is temporarily unavailable. Please try again in a moment.';
}

export function getOpenAIClient(options?: { timeoutMs?: number }): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }
  return new OpenAI({
    apiKey,
    baseURL: getPrimaryBaseURL(),
    ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
}

export function getFallbackClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_FALLBACK_KEY?.trim();
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_FALLBACK_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL;
  return new OpenAI({ apiKey, baseURL });
}
