import { useAuthStore } from '../store/authStore';

export const AUTH_STORAGE_KEY = 'auth-storage';
export const SESSION_SUSPENDED_FLAG = 'sams-school-suspended';

export type AuthRedirectReason = 'school_suspended' | 'session_expired';

/** Wipe persisted and in-memory auth so suspend/unsuspend cannot leave a half-logged-in shell. */
export function clearAuthState(options?: { markSuspended?: boolean }): void {
  if (options?.markSuspended) {
    sessionStorage.setItem(SESSION_SUSPENDED_FLAG, '1');
  } else {
    sessionStorage.removeItem(SESSION_SUSPENDED_FLAG);
  }

  localStorage.removeItem(AUTH_STORAGE_KEY);
  useAuthStore.persist?.clearStorage?.();

  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    error: null,
    loading: false,
  });
}

/** Clear auth and hard-navigate to login with a user-visible reason (full reload). */
export function forceAuthRedirect(reason: AuthRedirectReason): void {
  clearAuthState({ markSuspended: reason === 'school_suspended' });
  const params = new URLSearchParams({ reason });
  window.location.replace(`/login?${params.toString()}`);
}

/** Call after a successful login so an earlier suspension flag does not linger. */
export function clearSuspendedSessionFlags(): void {
  sessionStorage.removeItem(SESSION_SUSPENDED_FLAG);
}
