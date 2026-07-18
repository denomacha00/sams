const AI_THREAD_STORAGE_KEY = 'sams-ai-thread-id';

export const AI_QUERY_TIMEOUT_MS = 45_000;
export const AI_IMAGE_TIMEOUT_MS = 90_000;

export interface AiThreadOwner {
  userId?: string | null;
  schoolId?: string | null;
  role?: string | null;
}

export interface AiThreadRecord {
  id: string;
  message: string;
  response: string;
  createdAt: string;
}

export interface AiThreadHistory {
  records: AiThreadRecord[];
  total: number;
  skippedCount?: number;
  memoryStatus?: 'ok' | 'partial' | 'unreadable' | 'empty';
  memoryNotice?: string;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isSystemNotice?: boolean;
}

export interface AiDownloadAction {
  kind: 'report';
  endpoint: string;
  filename: string;
  label: string;
}

export interface AiActionData {
  download?: AiDownloadAction;
}

export interface AiApiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Expand server thread records into alternating user/assistant chat messages. */
export function threadRecordsToMessages(records: AiThreadRecord[]): AiChatMessage[] {
  const messages: AiChatMessage[] = [];
  for (const record of records) {
    if (record.message?.trim()) {
      messages.push({
        id: `${record.id}-u`,
        role: 'user',
        content: record.message,
        timestamp: new Date(record.createdAt),
      });
    }
    if (record.response?.trim()) {
      messages.push({
        id: `${record.id}-a`,
        role: 'assistant',
        content: record.response,
        timestamp: new Date(record.createdAt),
      });
    }
  }
  return messages;
}

/** Build a system notice message when encrypted history could not be fully loaded. */
export function buildMemoryNoticeMessage(notice: string): AiChatMessage {
  return {
    id: `memory-notice-${Date.now()}`,
    role: 'assistant',
    content: notice,
    timestamp: new Date(),
    isSystemNotice: true,
  };
}

/** Persist server thread id so refresh keeps the same encrypted conversation. */
export function aiThreadStorageKey(owner?: AiThreadOwner | null): string {
  const userId = owner?.userId?.trim();
  const schoolId = owner?.schoolId?.trim();
  if (!userId) return AI_THREAD_STORAGE_KEY;
  return `${AI_THREAD_STORAGE_KEY}:${schoolId || 'school'}:${userId}`;
}

/** Build a compact client-side fallback history for the next AI request. */
export function messagesToAiHistory(
  messages: Array<Pick<AiChatMessage, 'id' | 'role' | 'content' | 'isSystemNotice'>>,
  maxMessages = 12,
): AiApiHistoryMessage[] {
  return messages
    .filter((message) => !message.isSystemNotice)
    .filter((message) => message.id !== 'welcome')
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 2_000),
    }))
    .slice(-maxMessages);
}

export function loadAiThreadId(owner?: AiThreadOwner | null): string | null {
  try {
    const scopedKey = aiThreadStorageKey(owner);
    const scopedValue = localStorage.getItem(scopedKey);
    if (scopedValue) return scopedValue;
    if (scopedKey !== AI_THREAD_STORAGE_KEY) {
      return localStorage.getItem(AI_THREAD_STORAGE_KEY);
    }
    return scopedValue;
  } catch {
    return null;
  }
}

export function saveAiThreadId(
  threadId: string | null | undefined,
  owner?: AiThreadOwner | null,
): void {
  try {
    const scopedKey = aiThreadStorageKey(owner);
    if (threadId) {
      localStorage.setItem(scopedKey, threadId);
    } else {
      localStorage.removeItem(scopedKey);
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
    message?: string;
    code?: string;
    response?: {
      status?: number;
      data?: { answer?: string; error?: string; intent?: string; code?: string };
    };
  };
  const status = axiosErr.response?.status;
  const data = axiosErr.response?.data;

  if (data?.answer) return data.answer;
  if (data?.error) return data.error;

  const authHint = getAiAuthHint(data?.intent);
  if (authHint) return authHint;

  if (data?.code === 'SESSION_EXPIRED' || status === 401) {
    return getAiAuthHint('session_expired') ?? fallback;
  }
  if (status === 413) {
    return 'Could not send that photo. Try again or use a screenshot.';
  }
  if (status === 429 || data?.code === 'RATE_LIMITED') {
    return 'Too many requests. Wait a moment and try again.';
  }
  if (status === 503) {
    return 'The server is starting or temporarily unavailable. Try again in a moment.';
  }
  if (!axiosErr.response) {
    if (axiosErr.code === 'ECONNABORTED' || axiosErr.message?.toLowerCase().includes('timeout')) {
      return 'The request timed out. Check your connection and try again.';
    }
    if (axiosErr.message?.toLowerCase().includes('network')) {
      return 'Network error — check your connection and try again.';
    }
  }

  return fallback;
}

/** Upload rejected (size/type/count) — show as system error, not a normal AI reply. */
export function isAiUploadErrorIntent(intent?: string): boolean {
  return intent === 'upload_error';
}

/** True when a 200 vision/query response still indicates a provider or config failure. */
export function isAiVisionFailureIntent(intent?: string): boolean {
  return intent === 'image_analysis_error' || intent === 'ai_not_configured';
}
