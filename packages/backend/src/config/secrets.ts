const PLACEHOLDER_FRAGMENTS = ['change-me', 'qr-secret-dev', 'default-license-secret'];

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  return value.length < 32 || PLACEHOLDER_FRAGMENTS.some((frag) => lower.includes(frag));
}

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Fail fast in production when critical secrets are missing or still placeholders. */
export function validateProductionSecrets(): void {
  if (!isProductionEnv()) return;

  const required: Array<[string, string | undefined]> = [
    ['JWT_SECRET', process.env.JWT_SECRET],
    ['JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET],
    ['QR_SECRET', process.env.QR_SECRET],
  ];

  for (const [name, value] of required) {
    if (isPlaceholder(value)) {
      throw new Error(
        `[STARTUP] ${name} must be set to a secure random value (64+ chars) in production`,
      );
    }
  }
}

export function getQrSecret(): string {
  const secret = process.env.QR_SECRET;
  if (secret && !isPlaceholder(secret)) return secret;

  if (isProductionEnv()) {
    throw new Error('[STARTUP] QR_SECRET must be configured in production');
  }

  console.warn('[STARTUP] QR_SECRET not set — using dev fallback. Set before production.');
  return secret ?? 'qr-secret-dev';
}

export function getLicenseSecret(): string {
  const secret = process.env.LICENSE_SECRET || process.env.JWT_SECRET;
  if (secret && !isPlaceholder(secret)) return secret;

  if (isProductionEnv()) {
    throw new Error('[STARTUP] LICENSE_SECRET (or JWT_SECRET) must be configured in production');
  }

  return secret ?? 'default-license-secret';
}
