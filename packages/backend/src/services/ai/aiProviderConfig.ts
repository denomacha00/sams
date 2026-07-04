import OpenAI from 'openai';

/** Groq decommissioned these IDs — map to current replacements. */
export const DEPRECATED_MODEL_MIGRATIONS: Record<string, string> = {
  'llama3-70b-8192': 'llama-3.3-70b-versatile',
  'llama3-8b-8192': 'llama-3.1-8b-instant',
  'llama-3.1-70b-versatile': 'llama-3.3-70b-versatile',
};

export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
// Fast model for primary chat (8B is ~3x faster than 70B with comparable quality for most queries)
export const DEFAULT_GROQ_CHAT_MODEL = 'llama-3.1-8b-instant';
// Fallback model for complex queries that need more reasoning depth
export const DEFAULT_GROQ_FALLBACK_MODEL = 'llama-3.3-70b-versatile';
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENROUTER_FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
export const DEFAULT_ATOMESUS_BASE_URL = 'https://api.atomesus.com/v1';
export const DEFAULT_ATOMESUS_MODEL = 'cipher';
export const DEFAULT_AI_PROVIDER_TIMEOUT_MS = 45_000;
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

export function resolveAtomesusChatModel(): string {
  return process.env.ATOMESUS_MODEL?.trim() || DEFAULT_ATOMESUS_MODEL;
}

/**
 * Atomesus vision is opt-in because not every Atomesus model/account may accept
 * OpenAI-style image_url content. Set this only after the provider confirms it.
 */
export function resolveAtomesusVisionModel(): string | null {
  return process.env.ATOMESUS_VISION_MODEL?.trim() || null;
}

/** True when the value looks like a real provider key (not .env.example placeholders). */
export function isRealProviderKey(value: string | undefined): boolean {
  const val = value?.trim();
  if (!val) return false;
  if (val.includes('your-')) return false;
  if (val.startsWith('gsk_your')) return false;
  if (val.startsWith('sk-or-v1-your')) return false;
  if (val.startsWith('atms_sk_YOUR')) return false;
  return true;
}

export function hasPrimaryAIKey(): boolean {
  return isRealProviderKey(process.env.OPENAI_API_KEY);
}

export function hasFallbackAIKey(): boolean {
  return isRealProviderKey(process.env.OPENAI_FALLBACK_KEY);
}

export function hasAtomesusAIKey(): boolean {
  return isRealProviderKey(process.env.ATOMESUS_API_KEY);
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
  atomesusKey: boolean;
  baseURL: string;
  model: string;
  fallbackModel: string;
  atomesusModel: string;
  atomesusVisionModel: string | null;
  modelMismatch: boolean;
  secretsFilesHint: string;
}

export function getAIHealthSummary(): AIHealthSummary {
  return {
    configured: hasPrimaryAIKey() || hasFallbackAIKey() || hasAtomesusAIKey(),
    primaryKey: hasPrimaryAIKey(),
    fallbackKey: hasFallbackAIKey(),
    atomesusKey: hasAtomesusAIKey(),
    baseURL: getPrimaryBaseURL(),
    model: resolveChatModel(),
    fallbackModel: resolveFallbackChatModel(),
    atomesusModel: resolveAtomesusChatModel(),
    atomesusVisionModel: resolveAtomesusVisionModel(),
    modelMismatch: isModelProviderMismatch(),
    secretsFilesHint: 'secrets/providers.env or packages/backend/.env.secrets',
  };
}

/**
 * Minimal live probe (one short completion). Use sparingly — rate limits apply.
 */
export async function probeAIProvider(timeoutMs = 15000): Promise<{
  ok: boolean;
  provider: 'primary' | 'fallback' | 'atomesus' | 'none';
  model?: string;
  error?: string;
}> {
  if (!hasPrimaryAIKey() && !hasFallbackAIKey() && !hasAtomesusAIKey()) {
    return { ok: false, provider: 'none', error: 'No AI provider key configured' };
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
  const errors: string[] = [];

  if (hasPrimaryAIKey()) {
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
      errors.push('primary: empty response');
    } catch (err) {
      errors.push(`primary: ${(err as Error).message}`);
    }
  }

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
      errors.push('fallback: empty response');
    } catch (fallbackErr) {
      errors.push(`fallback: ${(fallbackErr as Error).message}`);
    }
  }

  const atomesus = getAtomesusClient(timeoutMs);
  if (atomesus) {
    try {
      const at = await atomesus.chat.completions.create({
        model: resolveAtomesusChatModel(),
        messages,
        max_tokens: 8,
        temperature: 0,
      });
      const text = at.choices[0]?.message?.content?.trim();
      if (text) {
        return { ok: true, provider: 'atomesus', model: resolveAtomesusChatModel() };
      }
      errors.push('atomesus: empty response');
    } catch (atomesusErr) {
      errors.push(`atomesus: ${(atomesusErr as Error).message}`);
    }
  }

  return { ok: false, provider: 'none', error: errors.join('; ') || 'Empty response from provider' };
}

export function getMissingAIKeyMessage(): string {
  const hasAtomesus = process.env.ATOMESUS_API_KEY?.trim();
  if (hasAtomesus && hasAtomesus.length > 10) {
    return (
      'AI chat is not configured on this server. The ATOMESUS_API_KEY is present but may be invalid or the Atomesus service is unreachable. ' +
      'Please run **@diagnose-ai** or check the server logs.'
    );
  }
  return (
    'AI chat is not configured on this server. Your administrator must set OPENAI_API_KEY in the backend .env. ' +
    'For Groq (free tier): OPENAI_BASE_URL=https://api.groq.com/openai/v1 and OPENAI_MODEL=llama-3.3-70b-versatile. ' +
    'Optional backup: OPENAI_FALLBACK_KEY with OPENAI_FALLBACK_URL=https://openrouter.ai/api/v1. ' +
    'You can also use ATOMESUS_API_KEY as the primary provider.'
  );
}

/** Collect message, HTTP status, and provider code from OpenAI SDK / fetch errors. */
export function extractProviderErrorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;

  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    const apiErr = err as Error & {
      status?: number;
      code?: string;
      type?: string;
      error?: { message?: string; code?: string; type?: string };
    };
    if (apiErr.status) parts.push(String(apiErr.status));
    if (apiErr.code) parts.push(apiErr.code);
    if (apiErr.type) parts.push(apiErr.type);
    if (apiErr.error?.message) parts.push(apiErr.error.message);
    if (apiErr.error?.code) parts.push(apiErr.error.code);
    if (apiErr.error?.type) parts.push(apiErr.error.type);
  } else {
    parts.push(String(err));
  }

  return parts.filter(Boolean).join(' ');
}

/**
 * Turn provider/API errors into a short message safe to show in the chat UI.
 * Pass multiple errors (primary + fallback) to classify the most specific failure.
 */
export function formatProviderError(...errors: unknown[]): string {
  const combined = errors
    .map(extractProviderErrorText)
    .filter(Boolean)
    .join('; ');
  const lower = combined.toLowerCase();

  if (lower.includes('openai_api_key') || lower.includes('api key is not set')) {
    return getMissingAIKeyMessage();
  }
  if (isModelProviderMismatch()) {
    return (
      `OPENAI_MODEL=${process.env.OPENAI_MODEL} does not work with Groq. Set OPENAI_MODEL=llama-3.3-70b-versatile ` +
      '(or point OPENAI_BASE_URL to OpenRouter/OpenAI), then restart the API.'
    );
  }
  if (lower.includes('decommissioned') || lower.includes('model_decommissioned') || lower.includes('model_not_found')) {
    return (
      'The configured AI model is no longer available. On the server, set OPENAI_MODEL=llama-3.3-70b-versatile for Groq ' +
      '(or gpt-4o-mini for OpenAI), then restart the backend.'
    );
  }
  if (
    lower.includes('incorrect api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication') ||
    /\b401\b/.test(lower)
  ) {
    return 'The AI API key is invalid or expired. Update OPENAI_API_KEY in the server .env and restart the backend.';
  }
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('over_capacity') ||
    lower.includes('over capacity') ||
    lower.includes('too many requests')
  ) {
    return 'The AI service is rate-limited. Wait a moment and try again, or ask your administrator to add OPENAI_FALLBACK_KEY or ATOMESUS_API_KEY.';
  }
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    return 'The AI service did not respond in time. Check OPENAI_BASE_URL and network access from the server, then try again.';
  }
  if (
    /\b503\b/.test(lower) ||
    lower.includes('service unavailable') ||
    lower.includes('temporarily unavailable') ||
    /\b502\b/.test(lower) ||
    lower.includes('bad gateway') ||
    (/\b500\b/.test(lower) && lower.includes('internal'))
  ) {
    return (
      'The AI provider is temporarily down. Wait a moment and try again, or ask your administrator to configure ' +
      'OPENAI_FALLBACK_KEY or ATOMESUS_API_KEY as backup in secrets/providers.env.'
    );
  }
  if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('billing') || lower.includes('credits')) {
    return 'The AI provider quota is exhausted. Update billing or switch OPENAI_BASE_URL / OPENAI_FALLBACK_KEY / ATOMESUS_API_KEY on the server.';
  }
  if (lower.includes('context_length') || lower.includes('maximum context') || lower.includes('token limit')) {
    return 'The AI context was too large for the configured model after loading SAMS docs/history. The server trims this automatically; try again, or ask a shorter follow-up.';
  }
  if (/\b403\b/.test(lower) || lower.includes('forbidden') || lower.includes('permission denied')) {
    return 'The AI provider rejected this request (403). Check OPENAI_API_KEY permissions and OPENAI_BASE_URL on the server.';
  }
  if (
    lower.includes('image') ||
    lower.includes('vision') ||
    lower.includes('multimodal') ||
    lower.includes('does not support')
  ) {
    return (
      'Image analysis failed: the configured vision model may not support images on this provider. ' +
      'Set VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct with OpenRouter as primary/fallback, ' +
      'or set ATOMESUS_VISION_MODEL to a confirmed Atomesus image-capable model, then restart the API.'
    );
  }

  console.error('[AI/ProviderError] Unclassified provider failure:', combined || '(empty)');
  return 'The AI service is temporarily unavailable. Please try again in a moment.';
}

export interface VisionClientConfig {
  client: OpenAI;
  model: string;
  label: 'primary' | 'fallback' | 'atomesus';
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
  const fallbackIsOpenRouter = hasFallbackAIKey() && isOpenRouterBaseURL(fallbackUrl);

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

  const atomesusVisionModel = resolveAtomesusVisionModel();
  const atomesusClient = atomesusVisionModel ? getAtomesusClient(timeout) : null;
  if (atomesusClient && atomesusVisionModel) {
    configs.push({
      client: atomesusClient,
      model: atomesusVisionModel,
      label: 'atomesus',
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
  if (!isRealProviderKey(apiKey)) {
    throw new Error('OPENAI_API_KEY is set to a placeholder value - not a real key. Set a valid OpenAI/Groq/OpenRouter API key or use ATOMESUS_API_KEY instead.');
  }
  return new OpenAI({
    apiKey,
    baseURL: getPrimaryBaseURL(),
    timeout: options?.timeoutMs ?? DEFAULT_AI_PROVIDER_TIMEOUT_MS,
  });
}

export function getFallbackClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_FALLBACK_KEY?.trim();
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_FALLBACK_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL;
  return new OpenAI({ apiKey, baseURL, timeout: DEFAULT_AI_PROVIDER_TIMEOUT_MS });
}

export function getAtomesusClient(timeoutMs?: number): OpenAI | null {
  const apiKey = process.env.ATOMESUS_API_KEY?.trim();
  if (!isRealProviderKey(apiKey)) return null;
  const baseURL = process.env.ATOMESUS_BASE_URL?.trim() || DEFAULT_ATOMESUS_BASE_URL;
  return new OpenAI({
    apiKey: apiKey!,
    baseURL,
    timeout: timeoutMs ?? DEFAULT_AI_PROVIDER_TIMEOUT_MS,
  });
}
