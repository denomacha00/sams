import { readFile, stat, readdir } from 'fs/promises';
import { join, relative, resolve, extname } from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(join(__dirname, '..', '..', '..', '..')); // goes up to /var/www/sams

// Directories that are safe to read from
const ALLOWED_ROOTS = [
  PROJECT_ROOT,
  join(PROJECT_ROOT, 'packages'),
  join(PROJECT_ROOT, 'packages/backend/src'),
  join(PROJECT_ROOT, 'packages/backend/prisma'),
  join(PROJECT_ROOT, 'packages/frontend/src'),
  join(PROJECT_ROOT, 'packages/super-admin/src'),
  join(PROJECT_ROOT, 'packages/shared/src'),
  join(PROJECT_ROOT, 'scripts'),
  join(PROJECT_ROOT, 'docs'),
  join(PROJECT_ROOT, 'nginx'),
];

// File extensions allowed for reading
const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml',
  '.env.example', '.md', '.sh', '.sql', '.css', '.html',
  '.prisma', '.cjs', '.mjs',
]);

// Directories/files that are NEVER accessible (secrets, env, node_modules, .git)
const BLOCKED_PATTERNS = [
  /\/node_modules\//,
  /\/\.git\//,
  /\/dist\//,
  /\/\.next\//,
  /\/coverage\//,
  /\.env$/,
  /secrets\//,
  /providers\.env/,
  /\.env\.secrets/,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSafePath(absolutePath: string): boolean {
  const resolved = resolve(absolutePath);
  // Must be within project root
  if (!resolved.startsWith(PROJECT_ROOT)) return false;
  // Must be within an allowed root (or subdirectory of one)
  const isInAllowedRoot = ALLOWED_ROOTS.some((root) => resolved.startsWith(root));
  if (!isInAllowedRoot) return false;
  // Must not match blocked patterns
  const relativePath = relative(PROJECT_ROOT, resolved);
  return !BLOCKED_PATTERNS.some((p) => p.test(relativePath));
}

function isReadableFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  // Allow any extension inside packages/backend/src or prisma
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  // Allow files without extension if they're shell scripts
  if (!ext) return true;
  return false;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Services ────────────────────────────────────────────────────────────────

export interface FileReadResult {
  filePath: string;
  relativePath: string;
  content: string;
  size: string;
  lines: number;
  truncated: boolean;
}

export interface FileSearchResult {
  filePath: string;
  relativePath: string;
  matches: Array<{ line: number; content: string }>;
  totalMatches: number;
}

export interface DirectoryListing {
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size?: string;
}

const MAX_FILE_SIZE = 100 * 1024; // 100KB max read
const MAX_FILE_LINES = 1000; // 1000 lines max display
const MAX_SEARCH_RESULTS_PER_FILE = 10;

/**
 * Read a file from the project. Only safe paths are allowed.
 * Pass the path relative to project root, e.g. "packages/backend/src/index.ts"
 */
export async function readProjectFile(relativeFilePath: string): Promise<FileReadResult> {
  const absolutePath = resolve(join(PROJECT_ROOT, relativeFilePath));

  if (!isSafePath(absolutePath)) {
    throw new Error(
      `Access denied: "${relativeFilePath}" is outside allowed directories or matches blocked patterns. ` +
      'Allowed: src/, prisma/, docs/, scripts/, config files. Blocked: .env, secrets/, node_modules/, .git/, dist/',
    );
  }

  if (!isReadableFile(absolutePath)) {
    throw new Error(
      `Cannot read "${relativeFilePath}": file type not supported. ` +
      'Allowed: .ts, .tsx, .js, .jsx, .json, .md, .sh, .sql, .css, .prisma, .yaml, .env.example',
    );
  }

  const fileStat = await stat(absolutePath);

  if (fileStat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${formatFileSize(fileStat.size)}). Maximum: ${formatFileSize(MAX_FILE_SIZE)}. ` +
      'Try searching for specific content instead.',
    );
  }

  const content = await readFile(absolutePath, 'utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;
  const truncated = totalLines > MAX_FILE_LINES;

  return {
    filePath: absolutePath,
    relativePath: relativeFilePath,
    content: truncated ? lines.slice(0, MAX_FILE_LINES).join('\n') : content,
    size: formatFileSize(fileStat.size),
    lines: Math.min(totalLines, MAX_FILE_LINES),
    truncated,
  };
}

/**
 * Search for a string/regex across all files in a directory.
 */
export async function searchInProject(
  searchTerm: string,
  filePattern?: string, // optional file extension filter e.g. ".ts"
  maxResults = 30,
): Promise<FileSearchResult[]> {
  const results: FileSearchResult[] = [];
  const searchRegex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const searchDir = async (dirPath: string) => {
    if (results.length >= maxResults) return;
    if (!isSafePath(dirPath)) return;

    let entries: string[];
    try {
      entries = await readdir(dirPath, { withFileTypes: false });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      const fullPath = join(dirPath, entry);
      if (!isSafePath(fullPath)) continue;

      try {
        const entryStat = await stat(fullPath);
        if (entryStat.isDirectory()) {
          // Skip blocked directories
          const rel = relative(PROJECT_ROOT, fullPath);
          if (BLOCKED_PATTERNS.some((p) => p.test(rel))) continue;
          await searchDir(fullPath);
        } else if (entryStat.isFile() && isReadableFile(fullPath)) {
          if (filePattern && !fullPath.endsWith(filePattern)) continue;
          if (entryStat.size > MAX_FILE_SIZE) continue;

          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          const matches: Array<{ line: number; content: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_SEARCH_RESULTS_PER_FILE) break;
            if (searchRegex.test(lines[i]!)) {
              matches.push({
                line: i + 1,
                content: lines[i]!.trim().slice(0, 200),
              });
            }
          }

          if (matches.length > 0) {
            results.push({
              filePath: fullPath,
              relativePath: relative(PROJECT_ROOT, fullPath),
              matches,
              totalMatches: matches.length,
            });
          }
        }
      } catch {
        continue;
      }
    }
  };

  // Search in allowed roots
  for (const root of ALLOWED_ROOTS) {
    if (results.length >= maxResults) break;
    try {
      await stat(root);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch {
      continue;
    }
    await searchDir(root);
  }

  return results.slice(0, maxResults);
}

/**
 * List files in a directory.
 */
export async function listDirectory(dirPath: string): Promise<DirectoryListing[]> {
  const absolutePath = resolve(join(PROJECT_ROOT, dirPath));

  if (!isSafePath(absolutePath)) {
    throw new Error(`Access denied: "${dirPath}" is outside allowed directories.`);
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const result: DirectoryListing[] = [];

  for (const entry of entries) {
    const fullPath = join(absolutePath, entry.name);
    if (!isSafePath(fullPath)) continue;
    const relPath = relative(PROJECT_ROOT, fullPath);

    if (entry.isFile()) {
      try {
        const fileStat = await stat(fullPath);
        result.push({
          path: relPath,
          relativePath: relPath,
          isDirectory: false,
          size: formatFileSize(fileStat.size),
        });
      } catch {
        result.push({ path: relPath, relativePath: relPath, isDirectory: false });
      }
    } else if (entry.isDirectory()) {
      const rel = relative(PROJECT_ROOT, fullPath);
      if (BLOCKED_PATTERNS.some((p) => p.test(rel))) continue;
      result.push({ path: relPath, relativePath: relPath, isDirectory: true });
    }
  }

  return result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}
