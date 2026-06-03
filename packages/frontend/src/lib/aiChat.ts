/** Backend intents that indicate the LLM provider is unavailable or misconfigured. */
const AI_UNAVAILABLE_INTENTS = new Set(['ai_error', 'ai_not_configured']);

export function isAiUnavailableIntent(intent?: string): boolean {
  return Boolean(intent && AI_UNAVAILABLE_INTENTS.has(intent));
}

export function getAiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { answer?: string } } };
  if (axiosErr.response?.data?.answer) {
    return axiosErr.response.data.answer;
  }
  return fallback;
}
