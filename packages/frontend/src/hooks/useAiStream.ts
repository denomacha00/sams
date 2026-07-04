import { useRef, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { readAccessToken } from '../lib/authTokens';
import { AiApiHistoryMessage } from '../lib/aiChat';

const AI_STREAM_TIMEOUT_MS = 20_000;

export interface StreamCallbacks {
  onStart?: () => void;
  onToken?: (text: string) => void;
  onDone?: (fullText: string, intent?: string, engine?: string) => void;
  onError?: (error: string) => void;
}

/**
 * Hook to stream AI responses token-by-token via Server-Sent Events.
 * Uses fetch under the hood since axios doesn't support streaming well.
 * Falls back to the standard /ai/query endpoint when SSE is not available.
 */
export function useAiStream() {
  const abortRef = useRef<AbortController | null>(null);

  const streamQuery = useCallback(async (
    question: string,
    callbacks: StreamCallbacks,
    options?: {
      threadId?: string | null;
      history?: AiApiHistoryMessage[];
    },
  ): Promise<string> => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let completed = false;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      if (!completed) {
        timedOut = true;
        controller.abort();
      }
    }, AI_STREAM_TIMEOUT_MS);

    const token = readAccessToken();
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

    callbacks.onStart?.();

    try {
      const response = await fetch(`${baseUrl}/ai/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question,
          threadId: options?.threadId ?? null,
          history: options?.history ?? [],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let intent: string | undefined;
      let engine: string | undefined;
      let sawDone = false;

      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.start) {
              // Stream started
              continue;
            }
            if (data.text) {
              fullText += data.text;
              callbacks.onToken?.(data.text);
            }
            if (data.done) {
              intent = data.intent;
              engine = data.engine;
              sawDone = true;
              break;
            }
            if (data.error) {
              callbacks.onError?.(data.text || 'Connection error');
              return data.text || 'Connection error';
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      if (!sawDone) {
        throw new Error('AI stream closed before finishing');
      }
      completed = true;
      callbacks.onDone?.(fullText, intent, engine);
      return fullText;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (!timedOut) return '';
        const errorMsg = 'AI response timed out';
        callbacks.onError?.(errorMsg);
        return errorMsg;
      }
      const errorMsg = err instanceof Error ? err.message : 'Streaming failed';
      callbacks.onError?.(errorMsg);
      return errorMsg;
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { streamQuery, cancelStream };
}
