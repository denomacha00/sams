export function resolveAvatarUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Avatars are served from the app origin (nginx /uploads), not the API subdomain.
  if (url.startsWith('/uploads')) {
    return `${window.location.origin}${url}`;
  }
  const base = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${new URL(base).origin}${url}`;
  }
  return `${window.location.origin}${url}`;
}
