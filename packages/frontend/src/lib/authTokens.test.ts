import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../store/authStore';
import { readAccessToken, readRefreshToken, writeTokens } from './authTokens';

const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
});

describe('authTokens', () => {
  beforeEach(() => {
    storage.clear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      error: null,
      loading: false,
    });
  });

  it('prefers in-memory access token over localStorage', () => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({ state: { accessToken: 'from-storage', refreshToken: 'r1' } }),
    );
    useAuthStore.setState({ accessToken: 'from-store' });
    expect(readAccessToken()).toBe('from-store');
  });

  it('falls back to localStorage when store has no token', () => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({ state: { accessToken: 'stored-token', refreshToken: 'r1' } }),
    );
    expect(readAccessToken()).toBe('stored-token');
    expect(readRefreshToken()).toBe('r1');
  });

  it('writeTokens updates Zustand state', () => {
    writeTokens('new-access', 'new-refresh');
    expect(useAuthStore.getState().accessToken).toBe('new-access');
    expect(useAuthStore.getState().refreshToken).toBe('new-refresh');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
