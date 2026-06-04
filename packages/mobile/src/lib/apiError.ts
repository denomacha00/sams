/** Extract a human-readable API error message from axios failures. */
export function getApiErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (typeof err !== 'object' || err === null) return fallback;

  const response = (err as { response?: { data?: unknown } }).response;
  const data = response?.data;

  if (typeof data === 'object' && data !== null) {
    const body = data as {
      error?: string;
      message?: string;
      code?: string;
      details?: Record<string, string[] | undefined>;
    };

    if (body.error) return body.error;
    if (body.message) return body.message;

    if (body.details && typeof body.details === 'object') {
      const firstField = Object.values(body.details).find((v) => Array.isArray(v) && v.length > 0);
      if (firstField?.[0]) return firstField[0];
    }

    if (body.code) return body.code.replace(/_/g, ' ').toLowerCase();
  }

  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
