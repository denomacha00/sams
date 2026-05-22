/** Extract a user-visible message from a failed super-admin API call. */
export function getSuperAdminApiError(err: unknown, fallback: string): string {
  const ax = err as { response?: { data?: { message?: string; error?: string; code?: string } } };
  const code = ax.response?.data?.code;
  const msg = ax.response?.data?.message ?? ax.response?.data?.error;
  if (code === 'HOST_NOT_ALLOWED') {
    return (
      msg ??
      'Super Admin API blocked: open super.smart-managment.com and set SUPER_ADMIN_HOST=super.smart-managment.com on the API server.'
    );
  }
  if (code === 'FORBIDDEN') {
    return msg ?? 'Access denied. Sign in with a Super Admin account.';
  }
  return msg ?? fallback;
}
