import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import apiClient from '../services/apiClient';
import { UserRole } from '@sams/shared';

export interface AuthUser {
  id: string;
  fullName: string;
  email?: string;
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
          const user = {
            id: tokenPayload.sub,
            fullName: identifier,
            email: identifier.includes('@') ? identifier : undefined,
            role: tokenPayload.role,
            schoolId: tokenPayload.schoolId,
            departmentId: tokenPayload.departmentId,
            classId: tokenPayload.classId,
          };
          set({
            user,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            isAuthenticated: true,
            loading: false,
            error: null,
          });
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
