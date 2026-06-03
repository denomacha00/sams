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
/** OpenRouter / Groq multimodal model (must differ from text-only chat models). */
export const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

export function getPrimaryBaseURL(): string {
  return process.env.OPENAI_BASE_URL?.trim() || DEFAULT_GROQ_BASE_URL;
}

export function isGroqBaseURL(baseURL: string): boolean {
  return baseURL.includes('groq.com');
}

export function isOpenRouterBaseURL(baseURL: string): boolean {
  return baseURL.includes('openrouter.ai');
}

export function resolveVisionModel(): string {
  const configured = process.env.VISION_MODEL?.trim();
  return configured || DEFAULT_VISION_MODEL;
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

/** True when the value looks like a real provider key (not .env.example placeholders). */
export function isRealProviderKey(value: string | undefined): boolean {
  const val = value?.trim();
  if (!val) return false;
  if (val.includes('your-')) return false;
  if (val.startsWith('gsk_your')) return false;
  if (val.startsWith('sk-or-v1-your')) return false;
  return true;
}

export function hasPrimaryAIKey(): boolean {
  return isRealProviderKey(process.env.OPENAI_API_KEY);
}

export function hasFallbackAIKey(): boolean {
  return isRealProviderKey(process.env.OPENAI_FALLBACK_KEY);
}

/** gpt-4o-mini (and other OpenAI IDs) fail on Groq — common VPS misconfiguration. */
export function isModelProviderMismatch(): boolean {
  const model = process.env.OPENAI_MODEL?.trim();
  if (!model) return false;
  const openAiOnlyModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini'];
  if (!openAiOnlyModels.some((m) => model === m || model.startsWith(`${m}-`))) {
    return false;
  }
  return isGroqBaseURL(getPrimaryBaseURL());
}

export interface AIHealthSummary {
  configured: boolean;
  primaryKey: boolean;
  fallbackKey: boolean;
  baseURL: string;
  model: string;
  fallbackModel: string;
  modelMismatch: boolean;
  secretsFilesHint: string;
}

export function getAIHealthSummary(): AIHealthSummary {
  return {
    configured: hasPrimaryAIKey(),
    primaryKey: hasPrimaryAIKey(),
    fallbackKey: hasFallbackAIKey(),
    baseURL: getPrimaryBaseURL(),
    model: resolveChatModel(),
    fallbackModel: resolveFallbackChatModel(),
    modelMismatch: isModelProviderMismatch(),
    secretsFilesHint: 'secrets/providers.env or packages/backend/.env.secrets',
  };
}

/**
 * Minimal live probe (one short completion). Use sparingly — rate limits apply.
 */
export async function probeAIProvider(timeoutMs = 15000): Promise<{
  ok: boolean;
  provider: 'primary' | 'fallback' | 'none';
  model?: string;
  error?: string;
}> {
  if (!hasPrimaryAIKey()) {
    return { ok: false, provider: 'none', error: 'OPENAI_API_KEY missing or placeholder' };
  }
  if (isModelProviderMismatch()) {
    return {
      ok: false,
      provider: 'none',
      error: `OPENAI_MODEL=${process.env.OPENAI_MODEL} is not valid for Groq — use llama-3.3-70b-versatile`,
    };
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'user', content: 'Reply with exactly: ok' },
  ];

  try {
    const client = getOpenAIClient({ timeoutMs });
    const response = await client.chat.completions.create({
      model: resolveChatModel(),
      messages,
      max_tokens: 8,
      temperature: 0,
    });
    const text = response.choices[0]?.message?.content?.trim();
    if (text) {
      return { ok: true, provider: 'primary', model: resolveChatModel() };
    }
  } catch (err) {
    const primaryMsg = (err as Error).message;
    const fallback = getFallbackClient();
    if (fallback) {
      try {
        const fb = await fallback.chat.completions.create({
          model: resolveFallbackChatModel(),
          messages,
          max_tokens: 8,
          temperature: 0,
        });
        const text = fb.choices[0]?.message?.content?.trim();
        if (text) {
          return { ok: true, provider: 'fallback', model: resolveFallbackChatModel() };
        }
      } catch (fallbackErr) {
        return {
          ok: false,
          provider: 'primary',
          error: `${primaryMsg}; fallback: ${(fallbackErr as Error).message}`,
        };
      }
    }
    return { ok: false, provider: 'primary', error: primaryMsg };
  }

  return { ok: false, provider: 'primary', error: 'Empty response from provider' };
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
  if (
    lower.includes('image') ||
    lower.includes('vision') ||
    lower.includes('multimodal') ||
    lower.includes('does not support')
  ) {
    return (
      'Image analysis failed: the configured vision model may not support images on this provider. ' +
      'Set VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct with OpenRouter as primary or fallback, then restart the API.'
    );
  }

  return 'The AI service is temporarily unavailable. Please try again in a moment.';
}

export interface VisionClientConfig {
  client: OpenAI;
  model: string;
  label: 'primary' | 'fallback';
}

/**
 * Pick the client that can run multimodal (vision) requests.
 * Groq text chat models do not accept images — when primary is Groq, use OpenRouter fallback if configured.
 */
export function getVisionClientConfigs(options?: { timeoutMs?: number }): VisionClientConfig[] {
  const model = resolveVisionModel();
  const timeout = options?.timeoutMs;
  const configs: VisionClientConfig[] = [];

  const primaryUrl = getPrimaryBaseURL();
  const fallbackUrl = process.env.OPENAI_FALLBACK_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL;
  const fallbackKey = process.env.OPENAI_FALLBACK_KEY?.trim();
  const primaryIsGroq = isGroqBaseURL(primaryUrl);
  const fallbackIsOpenRouter = Boolean(fallbackKey) && isOpenRouterBaseURL(fallbackUrl);

  const makeFallbackClient = (): OpenAI =>
    new OpenAI({
      apiKey: fallbackKey!,
      baseURL: fallbackUrl,
      ...(timeout ? { timeout } : {}),
    });

  // Groq chat models are text-only — prefer OpenRouter for vision when configured as fallback.
  if (primaryIsGroq && fallbackIsOpenRouter) {
    configs.push({ client: makeFallbackClient(), model, label: 'fallback' });
  }

  if (hasPrimaryAIKey() && (!primaryIsGroq || configs.length === 0)) {
    configs.push({
      client: getOpenAIClient(timeout ? { timeoutMs: timeout } : undefined),
      model,
      label: 'primary',
    });
  }

  if (configs.length === 0 && hasPrimaryAIKey()) {
    configs.push({
      client: getOpenAIClient(timeout ? { timeoutMs: timeout } : undefined),
      model,
      label: 'primary',
    });
  }

  return configs;
}

type VisionMessageContent = OpenAI.Chat.Completions.ChatCompletionContentPart[];

/**
 * Run a vision chat completion, trying primary then OpenRouter fallback when configured.
 */
export async function runVisionChatCompletion(
  content: VisionMessageContent,
  options?: { timeoutMs?: number },
): Promise<string> {
  const configs = getVisionClientConfigs(options);
  if (configs.length === 0) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  let lastErr: unknown;
  for (const { client, model, label } of configs) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content }],
        max_tokens: 1024,
      });
      const answer = response.choices[0]?.message?.content;
      if (answer) return answer;
    } catch (err) {
      lastErr = err;
      console.error(`[AI/Vision/${label}] Error with model ${model}:`, (err as Error).message);
    }
  }

  throw lastErr ?? new Error('Vision request failed');
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
