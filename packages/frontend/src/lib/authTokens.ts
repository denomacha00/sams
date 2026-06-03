import { useAuthStore } from '../store/authStore';

const AUTH_STORAGE_KEY = 'auth-storage';

/** Read access token from Zustand first, then persisted localStorage (same key as persist middleware). */
export function readAccessToken(): string | null {
  const fromStore = useAuthStore.getState().accessToken;
  if (fromStore) return fromStore;

  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { state?: { accessToken?: string } };
    return parsed?.state?.accessToken ?? null;
  } catch {
    return null;
  }
}

/** Read refresh token from Zustand first, then persisted localStorage. */
export function readRefreshToken(): string | null {
  const fromStore = useAuthStore.getState().refreshToken;
  if (fromStore) return fromStore;

  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { state?: { refreshToken?: string } };
    return parsed?.state?.refreshToken ?? null;
  } catch {
    return null;
  }
}

/** Keep Zustand and localStorage in sync after a silent refresh (apiClient interceptor). */
export function writeTokens(accessToken: string, refreshToken: string): void {
  useAuthStore.setState({ accessToken, refreshToken, isAuthenticated: true });
}
