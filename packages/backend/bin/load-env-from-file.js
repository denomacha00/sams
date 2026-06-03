'use strict';

const fs = require('fs');
const path = require('path');

const PLACEHOLDER_FRAGMENTS = ['change-me', 'qr-secret-dev', 'default-license-secret'];

/** @type {Set<string>} */
const FORCE_FROM_FILE = new Set(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'QR_SECRET', 'DATABASE_URL']);

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isWeakEnvValue(value) {
  if (value === undefined || value === '') return true;
  const lower = value.toLowerCase();
  return value.length < 32 || PLACEHOLDER_FRAGMENTS.some((frag) => lower.includes(frag));
}

/** Resolve packages/backend/.env from bin/, repo root cwd, or backend cwd. */
function resolveEnvFilePath() {
  const candidates = [
    path.resolve(__dirname, '../.env'),
    path.resolve(process.cwd(), 'packages/backend/.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) return envPath;
  }
  return null;
}

/** Gitignored provider secrets — loaded after .env; never deployed from git. */
function resolveSecretsFilePaths() {
  const root = path.resolve(__dirname, '../../..');
  const candidates = [
    path.resolve(__dirname, '../.env.secrets'),
    path.resolve(process.cwd(), 'packages/backend/.env.secrets'),
    path.join(root, 'secrets/providers.env'),
    path.resolve(process.cwd(), 'secrets/providers.env'),
    '/var/www/sams/secrets/providers.env',
    // Legacy AI-only file (migrate to providers.env)
    path.join(root, 'secrets/ai.env'),
    path.resolve(process.cwd(), 'secrets/ai.env'),
    '/var/www/sams/secrets/ai.env',
  ];
  const seen = new Set();
  /** @type {string[]} */
  const paths = [];
  for (const p of candidates) {
    const norm = path.normalize(p);
    if (seen.has(norm) || !fs.existsSync(norm)) continue;
    seen.add(norm);
    paths.push(norm);
  }
  return paths;
}

/**
 * @param {string} envPath
 * @param {{ override?: boolean }} [opts]
 */
function applyEnvFile(envPath, opts = {}) {
  const override = opts.override === true;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
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

    if (override) {
      process.env[key] = value;
      continue;
    }

    if (FORCE_FROM_FILE.has(key)) {
      if (!isWeakEnvValue(value)) {
        process.env[key] = value;
      } else if (isWeakEnvValue(existing)) {
        process.env[key] = value;
      }
      continue;
    }

    if (existing === undefined || existing === '') {
      process.env[key] = value;
    }
  }
}

/** Load .env then secrets overlays into process.env (PM2-safe). @returns {string | null} primary .env path */
function loadEnvFromFile() {
  const envPath = resolveEnvFilePath();
  if (envPath) applyEnvFile(envPath);
  for (const secretsPath of resolveSecretsFilePaths()) {
    applyEnvFile(secretsPath, { override: true });
  }
  return envPath;
}

module.exports = {
  FORCE_FROM_FILE,
  isWeakEnvValue,
  resolveEnvFilePath,
  resolveSecretsFilePaths,
  applyEnvFile,
  loadEnvFromFile,
};
