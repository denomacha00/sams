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

/** User must sign in (or refresh session) before school-data AI works. */
const AI_AUTH_INTENTS = new Set(['auth_required', 'session_expired']);

export function isAiUnavailableIntent(intent?: string): boolean {
  return Boolean(intent && AI_UNAVAILABLE_INTENTS.has(intent));
}

export function isAiAuthIntent(intent?: string): boolean {
  return Boolean(intent && AI_AUTH_INTENTS.has(intent));
}

export function getAiAuthHint(intent?: string): string | null {
  if (intent === 'session_expired') {
    return 'Your session expired. Sign out, sign in again, or wait a moment and retry.';
  }
  if (intent === 'auth_required') {
    return 'Sign in to use school data in AI. If you are already signed in, sign out and back in.';
  }
  return null;
}

export function getAiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as {
    response?: { data?: { answer?: string; error?: string; intent?: string } };
  };
  const data = axiosErr.response?.data;
  if (data?.answer) return data.answer;
  if (data?.error) return data.error;
  const authHint = getAiAuthHint(data?.intent);
  if (authHint) return authHint;
  return fallback;
}
