import { describe, expect, it, beforeEach } from 'vitest';
import {
  aiThreadStorageKey,
  buildMemoryNoticeMessage,
  getAiErrorMessage,
  isAiVisionFailureIntent,
  loadAiThreadId,
  saveAiThreadId,
  threadRecordsToMessages,
} from './aiChat';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    clear: () => {
      store = {};
    },
    getItem: (key: string) => store[key] ?? null,
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

describe('aiChat', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('prefers server answer from error responses', () => {
    const msg = getAiErrorMessage(
      { response: { status: 500, data: { answer: 'Vision model unavailable' } } },
      'fallback',
    );
    expect(msg).toBe('Vision model unavailable');
  });

  it('maps 413 to a short upload message', () => {
    const msg = getAiErrorMessage({ response: { status: 413, data: {} } }, 'fallback');
    expect(msg).toContain('photo');
    expect(msg).not.toContain('5 MB');
  });

  it('maps session expired responses', () => {
    const msg = getAiErrorMessage(
      { response: { status: 401, data: { intent: 'session_expired' } } },
      'fallback',
    );
    expect(msg).toContain('session');
  });

  it('detects vision failure intents', () => {
    expect(isAiVisionFailureIntent('image_analysis_error')).toBe(true);
    expect(isAiVisionFailureIntent('image_analysis')).toBe(false);
  });

  it('expands thread records into user/assistant messages', () => {
    const messages = threadRecordsToMessages([
      { id: 'r1', message: 'Hi', response: 'Hello', createdAt: '2026-06-01T10:00:00Z' },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('builds memory notice system messages', () => {
    const msg = buildMemoryNoticeMessage('Key rotated');
    expect(msg.isSystemNotice).toBe(true);
    expect(msg.content).toBe('Key rotated');
  });

  it('scopes remembered thread ids per signed-in account', () => {
    saveAiThreadId('thread-teacher', { userId: 'teacher-1', schoolId: 'school-1' });
    saveAiThreadId('thread-student', { userId: 'student-1', schoolId: 'school-1' });

    expect(loadAiThreadId({ userId: 'teacher-1', schoolId: 'school-1' })).toBe('thread-teacher');
    expect(loadAiThreadId({ userId: 'student-1', schoolId: 'school-1' })).toBe('thread-student');
    expect(localStorage.getItem(aiThreadStorageKey({ userId: 'teacher-1', schoolId: 'school-1' }))).toBe('thread-teacher');
  });
});
