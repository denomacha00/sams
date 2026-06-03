import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let cachedExcerpt: string | null = null;

const CANDIDATE_PATHS = [
  () => join(process.cwd(), 'DOCUMENTATION.md'),
  () => join(process.cwd(), '..', '..', 'DOCUMENTATION.md'),
  () => join(__dirname, '..', '..', '..', '..', '..', 'DOCUMENTATION.md'),
];

/**
 * Load a truncated excerpt of DOCUMENTATION.md for AI context injection.
 * Cached after first successful read.
 */
export function getSystemDocumentationExcerpt(maxChars = 10_000): string {
  if (cachedExcerpt !== null) return cachedExcerpt;

  for (const resolve of CANDIDATE_PATHS) {
    const path = resolve();
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf8');
      const excerpt = raw.length <= maxChars ? raw : `${raw.slice(0, maxChars)}\n\n[Documentation truncated for context length.]`;
      cachedExcerpt = excerpt;
      return excerpt;
    } catch {
      continue;
    }
  }

  cachedExcerpt = '';
  return '';
}

/** Reset cache (for tests). */
export function clearSystemDocumentationCache(): void {
  cachedExcerpt = null;
}
