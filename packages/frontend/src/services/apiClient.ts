import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { readAccessToken, readRefreshToken, writeTokens } from '../lib/authTokens';
import { clearAuthState, forceAuthRedirect, type AuthRedirectReason } from '../lib/clearAuthState';

/** Refresh failures that mean the user must sign in again (not transient server/network errors). */
const REFRESH_SESSION_END_CODES = new Set([
  'INVALID_REFRESH_TOKEN',
  'REFRESH_TOKEN_EXPIRED',
  'ACCOUNT_LOCKED',
  'USER_NOT_FOUND',
]);

function refreshFailureRedirectReason(error: AxiosError): AuthRedirectReason | null {
  const code = (error.response?.data as { code?: string } | undefined)?.code;
  if (code === 'SCHOOL_SUSPENDED') return 'school_suspended';
  if (error.response?.status === 401 && code && REFRESH_SESSION_END_CODES.has(code)) {
    return 'session_expired';
  }
  return null;
}

export interface SamApiRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  /** When true, failed refresh clears auth locally without hard-redirect (login session probe). */
  skipAuthRedirect?: boolean;
}

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Inject Authorization from Zustand (then localStorage); let axios set multipart boundaries for FormData
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (config.data instanceof FormData && config.headers) {
    const headers = config.headers;
    if (typeof headers.delete === 'function') {
      headers.delete('Content-Type');
      headers.delete('content-type');
    } else {
      delete (headers as Record<string, unknown>)['Content-Type'];
      delete (headers as Record<string, unknown>)['content-type'];
    }
  }
  const accessToken = readAccessToken();
  if (accessToken && config.headers) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Track if we're already refreshing to avoid infinite loops
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
};

// 401 interceptor — auto-refresh token flow
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as SamApiRequestConfig;
    const responseCode = (error.response?.data as { code?: string } | undefined)?.code;

    if (error.response?.status === 403 && responseCode === 'SCHOOL_SUSPENDED') {
      forceAuthRedirect('school_suspended');
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              resolve(apiClient(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = readRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post(
          `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/auth/refresh`,
          { refreshToken }
        );

        const newAccessToken = data.accessToken;
        const newRefreshToken = data.refreshToken;

        writeTokens(newAccessToken, newRefreshToken);

        processQueue(null, newAccessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        const refreshAxios = refreshError as AxiosError;
        const redirectReason = refreshFailureRedirectReason(refreshAxios);

        if (originalRequest.skipAuthRedirect || !redirectReason) {
          clearAuthState();
          return Promise.reject(refreshError);
        }

        forceAuthRedirect(redirectReason);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
