import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import {
  readAccessToken,
  readRefreshToken,
  readStoredUser,
  saveSession,
  clearSession,
  type StoredUser,
} from '../auth/storage';

const baseURL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ||
  'https://app.smart-managment.com/api/v1';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await readAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token!);
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const responseCode = (error.response?.data as { code?: string } | undefined)?.code;

    if (error.response?.status === 403 && responseCode === 'SCHOOL_SUSPENDED') {
      await clearSession();
      onUnauthorized?.();
      return Promise.reject(error);
    }

    if (error.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            if (original.headers) original.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(original));
          },
          reject,
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = await readRefreshToken();
      if (!refreshToken) throw new Error('No refresh token');

      const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
      const user = await readStoredUser();
      if (user) {
        await saveSession(data.accessToken, data.refreshToken, user);
      }
      processQueue(null, data.accessToken);
      if (original.headers) original.headers.Authorization = `Bearer ${data.accessToken}`;
      return apiClient(original);
    } catch (refreshError) {
      processQueue(refreshError, null);
      await clearSession();
      onUnauthorized?.();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export interface LoginPayload {
  schoolCode: string;
  identifier: string;
  password: string;
}

export interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  requiresOtp?: boolean;
  otpChallenge?: string;
  delivery?: { email?: string | null; phone?: string | null };
  error?: string;
  code?: string;
}

export async function loginRequest(payload: LoginPayload): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', {
    schoolCode: payload.schoolCode.trim().toUpperCase(),
    identifier: payload.identifier.trim(),
    password: payload.password,
  });
  return data;
}

export async function fetchMe(): Promise<{
  id: string;
  fullName: string;
  username?: string;
  role: string;
  schoolId: string;
}> {
  const { data } = await apiClient.get('/users/me');
  return data;
}

export async function submitQrAttendance(
  qrToken: string,
  gpsCoords?: { lat: number; lng: number },
): Promise<void> {
  await apiClient.post('/attendance/qr', { qrToken, gpsCoords });
}

export interface ActiveSessionInfo {
  id: string;
  classId: string;
  className?: string;
  isActive: boolean;
}

export async function fetchActiveTeacherSession(
  teacherId?: string,
): Promise<ActiveSessionInfo | null> {
  const params: Record<string, string> = { isActive: 'true' };
  if (teacherId) params.teacherId = teacherId;

  const { data } = await apiClient.get<ActiveSessionInfo[]>('/sessions', { params });
  const active = Array.isArray(data)
    ? data.filter((s) => s.isActive !== false)
    : [];
  return active[0] ?? null;
}

export async function checkBiometricFeatureAccess(): Promise<boolean> {
  try {
    await apiClient.get('/biometric/templates/check-access');
    return true;
  } catch {
    return false;
  }
}

export interface BiometricMatchPayload {
  descriptor: number[];
  classId?: string;
  sessionId: string;
}

export interface BiometricMatchResult {
  matched: boolean;
  studentName: string;
  confidence: number;
}

export async function submitBiometricMatch(
  payload: BiometricMatchPayload,
): Promise<BiometricMatchResult> {
  const { data } = await apiClient.post<{
    matched?: boolean;
    match?: boolean;
    studentName?: string;
    confidence?: number;
  }>('/biometric/match', payload);

  const matched = data.matched === true || data.match === true;
  return {
    matched,
    studentName: data.studentName ?? 'Student',
    confidence: data.confidence ?? 0,
  };
}

export function userFromToken(accessToken: string, fallbackName: string): StoredUser {
  const payload = JSON.parse(atob(accessToken.split('.')[1] ?? '')) as {
    sub: string;
    role: string;
    schoolId: string;
  };
  return {
    id: payload.sub,
    fullName: fallbackName,
    role: payload.role,
    schoolId: payload.schoolId,
  };
}

export function getApiBaseUrl(): string {
  return baseURL;
}
