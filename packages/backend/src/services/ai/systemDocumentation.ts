import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let cachedFullDoc: string | null = null;
let cachedOpsRunbook: string | null = null;

const CANDIDATE_PATHS = [
  () => join(process.cwd(), 'DOCUMENTATION.md'),
  () => join(process.cwd(), '..', '..', 'DOCUMENTATION.md'),
  () => join(__dirname, '..', '..', '..', '..', '..', 'DOCUMENTATION.md'),
];

const RUNBOOK_PATHS = [
  () => join(process.cwd(), 'docs/SAMS-OPS-RUNBOOK.md'),
  () => join(process.cwd(), '..', '..', 'docs/SAMS-OPS-RUNBOOK.md'),
  () => join(__dirname, '..', '..', '..', '..', '..', 'docs/SAMS-OPS-RUNBOOK.md'),
];

const DEFAULT_MAX_CHARS = 8_000;
const SUPER_ADMIN_MAX_CHARS = 12_000;
const SUPER_ADMIN_RUNBOOK_MAX_CHARS = 14_000;

function loadFullDocumentation(): string {
  if (cachedFullDoc !== null) return cachedFullDoc;

  for (const resolve of CANDIDATE_PATHS) {
    const path = resolve();
    if (!existsSync(path)) continue;
    try {
      cachedFullDoc = readFileSync(path, 'utf8');
      return cachedFullDoc;
    } catch {
      continue;
    }
  }

  cachedFullDoc = '';
  return '';
}

function loadOpsRunbook(): string {
  if (cachedOpsRunbook !== null) return cachedOpsRunbook;

  for (const resolve of RUNBOOK_PATHS) {
    const path = resolve();
    if (!existsSync(path)) continue;
    try {
      cachedOpsRunbook = readFileSync(path, 'utf8');
      return cachedOpsRunbook;
    } catch {
      continue;
    }
  }

  cachedOpsRunbook = '';
  return '';
}

/**
 * Ops runbook excerpt for Super Admin AI troubleshooting context.
 */
export function getOpsRunbookExcerpt(maxChars?: number): string {
  const limit = maxChars ?? SUPER_ADMIN_RUNBOOK_MAX_CHARS;
  const raw = loadOpsRunbook();
  if (!raw) return '';

  return raw.length <= limit
    ? raw
    : `${raw.slice(0, limit)}\n\n[Ops runbook truncated for context length.]`;
}

/**
 * Load a truncated excerpt of DOCUMENTATION.md for AI context injection.
 * Super Admin also receives the ops runbook when available.
 */
export function getSystemDocumentationExcerpt(
  maxChars?: number,
  role?: string,
): string {
  const limit =
    maxChars ??
    (role === 'SUPER_ADMIN' && loadOpsRunbook()
      ? 20_000
      : role === 'SUPER_ADMIN'
        ? SUPER_ADMIN_MAX_CHARS
        : DEFAULT_MAX_CHARS);
  let raw = loadFullDocumentation();

  if (role === 'SUPER_ADMIN') {
    const runbook = getOpsRunbookExcerpt();
    if (runbook) {
      raw = raw
        ? `${raw}\n\n---\n\n# Operations Runbook (troubleshooting)\n\n${runbook}`
        : runbook;
    }
  }

  if (!raw) return '';

  return raw.length <= limit
    ? raw
    : `${raw.slice(0, limit)}\n\n[Documentation truncated for context length.]`;
}

/** Reset cache (for tests). */
export function clearSystemDocumentationCache(): void {
  cachedFullDoc = null;
  cachedOpsRunbook = null;
}
