import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import apiClient from '../services/apiClient';

export interface SuperAdminUser {
  id: string;
  fullName: string;
  email?: string;
  role: string;
}

interface AuthState {
  user: SuperAdminUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  error: string | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

      login: async (identifier: string, password: string) => {
        set({ loading: true, error: null });
        try {
          // Super Admin uses a special schoolCode identifier "SUPERADMIN"
          const { data } = await apiClient.post('/auth/login', {
            schoolCode: 'SUPERADMIN',
            identifier,
            password,
          });

          // Verify the user is actually a SUPER_ADMIN
          if (data.user?.role !== 'SUPER_ADMIN') {
            set({ loading: false, error: 'Access denied. Super Admin role required.' });
            return;
          }

          set({
            user: data.user,
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

      clearError: () => set({ error: null }),
    }),
    {
      name: 'super-auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
