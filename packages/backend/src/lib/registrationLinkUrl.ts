/** Public self-registration URL (matches Registration Links page copy). */
export function buildRegistrationLinkUrl(token: string): string {
  const base = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/register/${token}`;
}
