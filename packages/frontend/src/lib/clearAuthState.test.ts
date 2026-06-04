import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../store/authStore';
import {
  AUTH_STORAGE_KEY,
  SESSION_SUSPENDED_FLAG,
  clearAuthState,
  clearSuspendedSessionFlags,
} from './clearAuthState';

const storage = new Map<string, string>();
const session = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => session.get(key) ?? null,
  setItem: (key: string, value: string) => session.set(key, value),
  removeItem: (key: string) => session.delete(key),
  clear: () => session.clear(),
});

describe('clearAuthState', () => {
  beforeEach(() => {
    storage.clear();
    session.clear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      error: null,
      loading: false,
    });
  });

  it('clears localStorage and zustand auth fields', () => {
    storage.set(AUTH_STORAGE_KEY, '{}');
    useAuthStore.setState({
      accessToken: 'a',
      refreshToken: 'r',
      isAuthenticated: true,
    });

    clearAuthState();

    expect(storage.has(AUTH_STORAGE_KEY)).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('sets suspended flag when markSuspended is true', () => {
    clearAuthState({ markSuspended: true });
    expect(session.get(SESSION_SUSPENDED_FLAG)).toBe('1');
  });

  it('clearSuspendedSessionFlags removes suspended flag', () => {
    session.set(SESSION_SUSPENDED_FLAG, '1');
    clearSuspendedSessionFlags();
    expect(session.has(SESSION_SUSPENDED_FLAG)).toBe(false);
  });
});
