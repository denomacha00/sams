export function resolveAvatarUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  // In production nginx serves /uploads from the app host. In local/dev or split-host
  // deployments, the API origin also serves the same static upload path.
  if (url.startsWith('/uploads') && (base.startsWith('http://') || base.startsWith('https://'))) {
    return `${new URL(base).origin}${url}`;
  }
  if (url.startsWith('/uploads')) {
    return `${window.location.origin}${url}`;
  }
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${new URL(base).origin}${url}`;
  }
  return `${window.location.origin}${url}`;
}
