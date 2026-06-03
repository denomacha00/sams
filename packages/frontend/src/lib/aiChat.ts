const AI_THREAD_STORAGE_KEY = 'sams-ai-thread-id';

/** Persist server thread id so refresh keeps the same encrypted conversation. */
export function loadAiThreadId(): string | null {
  try {
    return localStorage.getItem(AI_THREAD_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveAiThreadId(threadId: string | null | undefined): void {
  try {
    if (threadId) {
      localStorage.setItem(AI_THREAD_STORAGE_KEY, threadId);
    } else {
      localStorage.removeItem(AI_THREAD_STORAGE_KEY);
    }
  } catch {
    // private mode / quota — memory still works server-side via latest thread
  }
}

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
