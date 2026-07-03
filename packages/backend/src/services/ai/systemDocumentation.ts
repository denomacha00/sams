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

const RUNBOOK_PRIORITY_HEADINGS = [
  /^## 8\. AI not working\b/i,
  /^## 18\. Load this runbook into Super Admin AI\b/i,
];

const DEVBOOK_PRIORITY_HEADINGS = [
  /^## 9\. Super Admin AI\b/i,
  /^## 15\. Security & rotation\b/i,
  /^### 16\.3 Super Admin AI context loading\b/i,
];

const PLATFORM_DOC_PRIORITY_HEADINGS = [
  /^## 8\. AI Assistant\b/i,
  /^## 10\. Security\b/i,
];

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

function extractPrioritySections(raw: string, headingPatterns: RegExp[]): string {
  if (!raw || headingPatterns.length === 0) return '';

  const lines = raw.split(/\r?\n/);
  const sections: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matched = headingPatterns.some((pattern) => pattern.test(line));
    if (!matched) continue;

    const headingLevel = line.match(/^(#+)\s/)?.[1].length ?? 2;
    const collected: string[] = [line];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor];
      const nextLevel = next.match(/^(#+)\s/)?.[1].length;
      if (nextLevel && nextLevel <= headingLevel) break;
      collected.push(next);
    }
    sections.push(collected.join('\n').trim());
  }

  return sections.filter(Boolean).join('\n\n---\n\n');
}

function buildPrioritizedExcerpt(
  raw: string,
  limit: number,
  label: string,
  headingPatterns: RegExp[],
): string {
  if (!raw) return '';

  const priority = extractPrioritySections(raw, headingPatterns);
  if (!priority) return truncateExcerpt(raw, limit, label);

  const introBudget = Math.max(0, limit - priority.length - 80);
  const intro = introBudget > 250 ? truncateExcerpt(raw, introBudget, `${label} intro`) : '';
  const combined = intro ? `${priority}\n\n---\n\n${intro}` : priority;
  return truncateExcerpt(combined, limit, label);
}

/**
 * Ops runbook excerpt for Super Admin AI troubleshooting context.
 */
export function getOpsRunbookExcerpt(maxChars?: number): string {
  const limit = maxChars ?? SUPER_ADMIN_RUNBOOK_MAX_CHARS;
  return buildPrioritizedExcerpt(
    loadOpsRunbook(),
    limit,
    'Ops runbook',
    RUNBOOK_PRIORITY_HEADINGS,
  );
}

/**
 * Developer & operations book excerpt for Super Admin AI (deep troubleshooting).
 */
export function getDeveloperBookExcerpt(maxChars?: number): string {
  const limit = maxChars ?? SUPER_ADMIN_DEVBOOK_MAX_CHARS;
  return buildPrioritizedExcerpt(
    loadDeveloperBook(),
    limit,
    'Developer ops book',
    DEVBOOK_PRIORITY_HEADINGS,
  );
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
      `# Platform Documentation (features)\n\n${buildPrioritizedExcerpt(
        platformDoc,
        SUPER_ADMIN_PLATFORM_DOC_MAX_CHARS,
        'Platform documentation',
        PLATFORM_DOC_PRIORITY_HEADINGS,
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
