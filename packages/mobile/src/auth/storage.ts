import * as SecureStore from 'expo-secure-store';

const KEYS = {
  accessToken: 'sams_access_token',
  refreshToken: 'sams_refresh_token',
  userJson: 'sams_user_json',
  schoolCode: 'sams_school_code',
} as const;

export interface StoredUser {
  id: string;
  fullName: string;
  username?: string;
  role: string;
  schoolId: string;
}

export async function saveSession(
  accessToken: string,
  refreshToken: string,
  user: StoredUser,
  schoolCode?: string,
): Promise<void> {
  await SecureStore.setItemAsync(KEYS.accessToken, accessToken);
  await SecureStore.setItemAsync(KEYS.refreshToken, refreshToken);
  await SecureStore.setItemAsync(KEYS.userJson, JSON.stringify(user));
  if (schoolCode) {
    await SecureStore.setItemAsync(KEYS.schoolCode, schoolCode.toUpperCase());
  }
}

export async function readAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.accessToken);
}

export async function readRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.refreshToken);
}

export async function readStoredUser(): Promise<StoredUser | null> {
  const raw = await SecureStore.getItemAsync(KEYS.userJson);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export async function readSchoolCode(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.schoolCode);
}

export async function clearSession(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((key) => SecureStore.deleteItemAsync(key).catch(() => undefined)),
  );
}
