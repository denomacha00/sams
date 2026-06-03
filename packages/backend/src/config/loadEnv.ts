import { existsSync, readFileSync } from 'fs';
import path from 'path';

const PLACEHOLDER_FRAGMENTS = ['change-me', 'qr-secret-dev', 'default-license-secret'];

function isWeakEnvValue(value: string | undefined): boolean {
  if (value === undefined || value === '') return true;
  const lower = value.toLowerCase();
  return value.length < 32 || PLACEHOLDER_FRAGMENTS.some((frag) => lower.includes(frag));
}

/** Keys PM2 env_file often sets to empty/placeholder — always prefer .env file values. */
const FORCE_FROM_FILE = new Set(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'QR_SECRET', 'DATABASE_URL']);

/** Load packages/backend/.env — fills missing, empty, or weak vars (PM2 env_file often breaks secrets). */
function loadEnvFile(): void {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === '') continue;

    const existing = process.env[key];
    const useFile =
      FORCE_FROM_FILE.has(key)
        ? isWeakEnvValue(existing)
        : existing === undefined || existing === '';
    if (!useFile) continue;

    process.env[key] = value;
  }
}

loadEnvFile();
