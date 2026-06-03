/**
 * Africa's Talking SMS configuration.
 * Set AT_API_KEY + AT_USERNAME in packages/backend/.env (never commit real keys).
 *
 * Sandbox: AT_USERNAME=sandbox and your sandbox API key (often starts with atsk_).
 * Production: AT_USERNAME = your app username from the AT dashboard.
 */
export interface AfricasTalkingConfig {
  apiKey: string;
  username: string;
  senderId: string;
  sandbox: boolean;
}

export function getAfricasTalkingConfig(): AfricasTalkingConfig | null {
  const apiKey = process.env.AT_API_KEY?.trim() ?? '';
  const username = (process.env.AT_USERNAME?.trim() || 'sandbox').toLowerCase();
  const senderId = process.env.AT_SENDER_ID?.trim() || 'SAMS';

  if (!apiKey || apiKey === 'your-africastalking-api-key') {
    return null;
  }

  return {
    apiKey,
    username,
    senderId,
    sandbox: username === 'sandbox',
  };
}

export function isSmsConfigured(): boolean {
  return getAfricasTalkingConfig() !== null;
}

/** Human-readable AT mode for health checks and admin UI (no secrets). */
export function getAtSmsMode(
  cfg: AfricasTalkingConfig | null,
): 'unconfigured' | 'sandbox' | 'production' {
  if (!cfg) return 'unconfigured';
  return cfg.sandbox ? 'sandbox' : 'production';
}

/** E.164-style normalization for Kenya (+254). */
export function normalizeSmsPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}
