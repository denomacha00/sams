import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const SUPER_AUTH_STORAGE_KEY = 'super-auth-storage';

function readSuperAccessToken(): string | null {
  try {
    const stored = localStorage.getItem(SUPER_AUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { state?: { accessToken?: string } };
    return parsed?.state?.accessToken ?? null;
  } catch {
    return null;
  }
}

function readSuperRefreshToken(): string | null {
  try {
    const stored = localStorage.getItem(SUPER_AUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { state?: { refreshToken?: string } };
    return parsed?.state?.refreshToken ?? null;
  } catch {
    return null;
  }
}

function writeSuperTokens(accessToken: string, refreshToken: string): void {
  try {
    const stored = localStorage.getItem(SUPER_AUTH_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : { state: {} };
    parsed.state = { ...parsed.state, accessToken, refreshToken };
    localStorage.setItem(SUPER_AUTH_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Inject Authorization header from localStorage; let axios set multipart boundaries for FormData
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (config.data instanceof FormData && config.headers) {
    delete config.headers['Content-Type'];
  }
  const accessToken = readSuperAccessToken();
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
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

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
        const refreshToken = readSuperRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post(
          `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/auth/refresh`,
          { refreshToken },
        );

        const newAccessToken = data.accessToken;
        const newRefreshToken = data.refreshToken;

        writeSuperTokens(newAccessToken, newRefreshToken);

        processQueue(null, newAccessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('super-auth-storage');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
