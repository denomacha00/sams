import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let cachedFullDoc: string | null = null;

const CANDIDATE_PATHS = [
  () => join(process.cwd(), 'DOCUMENTATION.md'),
  () => join(process.cwd(), '..', '..', 'DOCUMENTATION.md'),
  () => join(__dirname, '..', '..', '..', '..', '..', 'DOCUMENTATION.md'),
];

const DEFAULT_MAX_CHARS = 8_000;
const SUPER_ADMIN_MAX_CHARS = 12_000;

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

/**
 * Load a truncated excerpt of DOCUMENTATION.md for AI context injection.
 * Full file is cached after first successful read; excerpt length varies by role.
 */
export function getSystemDocumentationExcerpt(
  maxChars?: number,
  role?: string,
): string {
  const limit =
    maxChars ?? (role === 'SUPER_ADMIN' ? SUPER_ADMIN_MAX_CHARS : DEFAULT_MAX_CHARS);
  const raw = loadFullDocumentation();
  if (!raw) return '';

  return raw.length <= limit
    ? raw
    : `${raw.slice(0, limit)}\n\n[Documentation truncated for context length.]`;
}

/** Reset cache (for tests). */
export function clearSystemDocumentationCache(): void {
  cachedFullDoc = null;
}
