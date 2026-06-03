const DEFAULT_DEV_BASE = 'http://localhost:5173';

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value || value.trim() === '*') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Prefer explicit frontend URL; fall back to APP_URL / CORS (production VPS often sets only APP_URL). */
export function getAppBaseUrl(): string {
  const candidates = [
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    ...parseCorsOrigins(process.env.CORS_ORIGIN),
  ].filter((v): v is string => Boolean(v && v.trim()));

  const base = (candidates[0] ?? DEFAULT_DEV_BASE).replace(/\/$/, '');
  return normalizePublicBaseUrl(base);
}

/** Use https in production when env still has http:// (common VPS misconfiguration). */
export function normalizePublicBaseUrl(base: string): string {
  if (process.env.NODE_ENV === 'production' && base.startsWith('http://')) {
    return `https://${base.slice('http://'.length)}`;
  }
  return base;
}

/** Public self-registration URL (matches Registration Links page: /register/:token). */
export function buildRegistrationLinkUrl(token: string): string {
  return `${getAppBaseUrl()}/register/${token}`;
}
