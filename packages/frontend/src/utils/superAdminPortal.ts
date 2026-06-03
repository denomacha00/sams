import { UserRole } from '@sams/shared';

/** School app roles only — Super Admin uses the separate super-admin panel. */
export const SCHOOL_APP_ROLES: UserRole[] = [
  UserRole.SCHOOL_ADMIN,
  UserRole.HOD,
  UserRole.TEACHER,
  UserRole.STUDENT,
];

export function getSuperAdminPortalUrl(): string {
  const fromEnv = import.meta.env.VITE_SUPER_ADMIN_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://localhost:3002';
  return '';
}

export function redirectToSuperAdminPortal(): void {
  const url = getSuperAdminPortalUrl();
  if (url) window.location.href = url;
}
