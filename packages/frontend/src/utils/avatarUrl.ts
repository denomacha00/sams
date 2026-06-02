export function resolveAvatarUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  const origin = window.location.origin;
  if (base.startsWith('http://') || base.startsWith('https://')) {
    const apiOrigin = new URL(base).origin;
    return `${apiOrigin}${url}`;
  }
  return `${origin}${url}`;
}
