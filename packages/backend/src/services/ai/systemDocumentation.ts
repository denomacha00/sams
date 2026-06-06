import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let cachedFullDoc: string | null = null;
let cachedOpsRunbook: string | null = null;
let cachedDeveloperBook: string | null = null;

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

const DEVELOPER_BOOK_PATHS = [
  () => join(process.cwd(), 'docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md'),
  () => join(process.cwd(), '..', '..', 'docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md'),
  () =>
    join(__dirname, '..', '..', '..', '..', '..', 'docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md'),
];

const DEFAULT_MAX_CHARS = 6_000;
const SUPER_ADMIN_RUNBOOK_MAX_CHARS = 5_000;
const SUPER_ADMIN_DEVBOOK_MAX_CHARS = 7_000;
const SUPER_ADMIN_PLATFORM_DOC_MAX_CHARS = 5_000;
const SUPER_ADMIN_TOTAL_MAX_CHARS = 18_000;

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

function loadDeveloperBook(): string {
  if (cachedDeveloperBook !== null) return cachedDeveloperBook;

  for (const resolve of DEVELOPER_BOOK_PATHS) {
    const path = resolve();
    if (!existsSync(path)) continue;
    try {
      cachedDeveloperBook = readFileSync(path, 'utf8');
      return cachedDeveloperBook;
    } catch {
      continue;
    }
  }

  cachedDeveloperBook = '';
  return '';
}

function truncateExcerpt(raw: string, limit: number, label: string): string {
  if (!raw) return '';
  return raw.length <= limit
    ? raw
    : `${raw.slice(0, limit)}\n\n[${label} truncated for context length.]`;
}

/**
 * Ops runbook excerpt for Super Admin AI troubleshooting context.
 */
export function getOpsRunbookExcerpt(maxChars?: number): string {
  const limit = maxChars ?? SUPER_ADMIN_RUNBOOK_MAX_CHARS;
  return truncateExcerpt(loadOpsRunbook(), limit, 'Ops runbook');
}

/**
 * Developer & operations book excerpt for Super Admin AI (deep troubleshooting).
 */
export function getDeveloperBookExcerpt(maxChars?: number): string {
  const limit = maxChars ?? SUPER_ADMIN_DEVBOOK_MAX_CHARS;
  return truncateExcerpt(loadDeveloperBook(), limit, 'Developer ops book');
}

/**
 * Build Super Admin context: runbook + developer book + platform docs (ops-first).
 */
function buildSuperAdminDocumentationExcerpt(): string {
  const parts: string[] = [];

  const runbook = getOpsRunbookExcerpt();
  if (runbook) {
    parts.push(`# Operations Runbook (troubleshooting — check first)\n\n${runbook}`);
  }

  const devBook = getDeveloperBookExcerpt();
  if (devBook) {
    parts.push(`# Developer & Operations Book (deep reference)\n\n${devBook}`);
  }

  const platformDoc = loadFullDocumentation();
  if (platformDoc) {
    parts.push(
      `# Platform Documentation (features)\n\n${truncateExcerpt(
        platformDoc,
        SUPER_ADMIN_PLATFORM_DOC_MAX_CHARS,
        'Platform documentation',
      )}`,
    );
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Load a truncated excerpt of DOCUMENTATION.md for AI context injection.
 * Super Admin also receives the ops runbook and developer book when available.
 */
export function getSystemDocumentationExcerpt(
  maxChars?: number,
  role?: string,
): string {
  if (role === 'SUPER_ADMIN') {
    const raw = buildSuperAdminDocumentationExcerpt();
    const limit = maxChars ?? SUPER_ADMIN_TOTAL_MAX_CHARS;
    if (!raw) return '';
    return truncateExcerpt(raw, limit, 'Super Admin documentation bundle');
  }

  const limit = maxChars ?? DEFAULT_MAX_CHARS;
  const raw = loadFullDocumentation();
  if (!raw) return '';

  return truncateExcerpt(raw, limit, 'Documentation');
}

/** Reset cache (for tests). */
export function clearSystemDocumentationCache(): void {
  cachedFullDoc = null;
  cachedOpsRunbook = null;
  cachedDeveloperBook = null;
}
