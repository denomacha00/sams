import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  clearSession,
  readAccessToken,
  readRefreshToken,
  readStoredUser,
  saveSession,
  type StoredUser,
} from './storage';
import {
  apiClient,
  fetchMe,
  loginRequest,
  setUnauthorizedHandler,
  userFromToken,
} from '../api/client';
import { getApiErrorMessage } from '../lib/apiError';

interface AuthContextValue {
  user: StoredUser | null;
  loading: boolean;
  bootstrapping: boolean;
  login: (schoolCode: string, identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loading, setLoading] = useState(false);

  const logout = useCallback(async () => {
    const refreshToken = await readRefreshToken();
    try {
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken });
      }
    } catch {
      // ignore
    }
    await clearSession();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
    });
    (async () => {
      const token = await readAccessToken();
      const stored = await readStoredUser();
      if (token && stored) {
        setUser(stored);
        try {
          const me = await fetchMe();
          setUser({
            id: me.id,
            fullName: me.fullName,
            username: me.username,
            role: me.role,
            schoolId: me.schoolId,
          });
        } catch {
          await clearSession();
          setUser(null);
        }
      }
      setBootstrapping(false);
    })();
  }, []);

  const login = useCallback(async (schoolCode: string, identifier: string, password: string) => {
    setLoading(true);
    try {
      const data = await loginRequest({ schoolCode, identifier, password });
      if (data.requiresOtp) {
        throw new Error(
          'This account requires a login verification code. Use the web app at app.smart-managment.com for OTP login.',
        );
      }
      if (!data.accessToken || !data.refreshToken) {
        throw new Error(data.error || 'Login failed. Please check your credentials.');
      }
      let profile = userFromToken(data.accessToken, identifier);
      await saveSession(data.accessToken, data.refreshToken, profile, schoolCode);
      try {
        const me = await fetchMe();
        profile = {
          id: me.id,
          fullName: me.fullName,
          username: me.username,
          role: me.role,
          schoolId: me.schoolId,
        };
        await saveSession(data.accessToken, data.refreshToken, profile, schoolCode);
      } catch {
        // non-fatal
      }
      setUser(profile);
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Login failed. Please check your credentials.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, bootstrapping, login, logout }),
    [user, loading, bootstrapping, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
