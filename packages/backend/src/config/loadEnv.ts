import { existsSync, readFileSync } from 'fs';
import path from 'path';

/** Load packages/backend/.env when not already set (PM2 does not read this file by default). */
function loadEnvFile(): void {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();
