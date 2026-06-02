import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import apiClient from '../services/apiClient';
import { UserRole } from '@sams/shared';

export interface AuthUser {
  id: string;
  username?: string;
  fullName: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  /** Client-only timestamp to bust avatar image cache after re-upload. */
  avatarVersion?: number;
  role: UserRole;
  schoolId: string;
  departmentId?: string;
  classId?: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  error: string | null;
  loading: boolean;
  login: (schoolCode: string, identifier: string, password: string) => Promise<void>;
  setAuth: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  updateUser: (fields: Partial<AuthUser>) => void;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      error: null,
      loading: false,

      setAuth: (user: AuthUser, accessToken: string, refreshToken: string) => {
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          loading: false,
          error: null,
        });
      },

      updateUser: (fields: Partial<AuthUser>) => {
        const current = get().user;
        if (current) {
          set({ user: { ...current, ...fields } });
        }
      },

      refreshProfile: async () => {
        if (!get().isAuthenticated) return;
        try {
          const { data: me } = await apiClient.get('/users/me');
          const current = get().user;
          if (!current) return;
          set({
            user: {
              ...current,
              fullName: me.fullName ?? current.fullName,
              username: me.username ?? current.username,
              email: me.email ?? current.email,
              phone: me.phone ?? current.phone,
              avatarUrl: me.avatarUrl ?? undefined,
            },
          });
        } catch {
          // Non-fatal — profile refresh is best-effort.
        }
      },

      login: async (schoolCode: string, identifier: string, password: string) => {
        set({ loading: true, error: null });
        try {
          const { data } = await apiClient.post('/auth/login', {
            schoolCode,
            identifier,
            password,
          });
          // Decode user info from JWT
          const tokenPayload = JSON.parse(atob(data.accessToken.split('.')[1]));

          // Build a partial user from the JWT first so the app is immediately usable
          const partialUser = {
            id: tokenPayload.sub,
            fullName: identifier, // temporary — will be replaced by the profile fetch below
            email: identifier.includes('@') ? identifier : undefined,
            role: tokenPayload.role,
            schoolId: tokenPayload.schoolId,
            departmentId: tokenPayload.departmentId,
            classId: tokenPayload.classId,
          };

          set({
            user: partialUser,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            isAuthenticated: true,
            loading: false,
            error: null,
          });

          // Fetch the real user profile to get the actual fullName, avatarUrl, etc.
          // This runs after the state is set so the app can render immediately.
          try {
            const { data: me } = await apiClient.get('/users/me');
            set((state) => ({
              user: state.user
                ? {
                    ...state.user,
                    fullName: me.fullName ?? state.user.fullName,
                    username: me.username,
                    email: me.email ?? state.user.email,
                    phone: me.phone,
                    avatarUrl: me.avatarUrl,
                  }
                : state.user,
            }));
          } catch {
            // Profile fetch failure is non-fatal — user is still logged in
          }
        } catch (err: any) {
          const message =
            err.response?.data?.error ||
            err.response?.data?.message ||
            'Login failed. Please try again.';
          set({ loading: false, error: message, isAuthenticated: false });
          throw err;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          if (refreshToken) {
            await apiClient.post('/auth/logout', { refreshToken });
          }
        } catch {
          // ignore logout errors
        } finally {
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            error: null,
          });
        }
      },

      refreshAccessToken: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          set({ isAuthenticated: false, user: null, accessToken: null, refreshToken: null });
          return;
        }
        try {
          const { data } = await apiClient.post('/auth/refresh', { refreshToken });
          set({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
          });
        } catch {
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
          });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
