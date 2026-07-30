import { prisma } from '../lib/prisma';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DbTableInfo {
  tableName: string;
  rowCount: number;
  columns: Array<{ name: string; type: string }>;
}

interface DbQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
  executionMs: number;
}

// ─── Allowlisted read-only SQL patterns ─────────────────────────────────────

const READ_ONLY_SQL_RE = /^\s*(SELECT|EXPLAIN|DESCRIBE|SHOW)\s/i;
const DANGEROUS_PATTERNS = [
  /\b(DELETE|DROP|TRUNCATE|ALTER|UPDATE|INSERT|CREATE|GRANT|REVOKE)\b/i,
  /;\s*(DELETE|DROP|TRUNCATE|ALTER|UPDATE|INSERT|CREATE)\b/i,
  /\bpg_sleep\b/i,
  /\bCOPY\b/i,
  // Server-side file & large-object access can read arbitrary files / exfiltrate data.
  /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink)\b/i,
  /\/\*/i,  // block comments (can hide malicious SQL)
  /--/,     // line comments (can hide SQL or spoof a fake WHERE clause)
];

export function isReadOnlyQuery(sql: string): boolean {
  const trimmed = sql.trim();
  if (!READ_ONLY_SQL_RE.test(trimmed)) return false;
  return !DANGEROUS_PATTERNS.some((p) => p.test(trimmed));
}

// ─── Write access (opt-in, Super Admin only) ────────────────────────────────
// Off by default. Turned on with SAMS_AI_SQL_WRITE=1 on the server — the same
// deliberate flag pattern as SAMS_AI_SHELL. Even when on, a few catastrophic
// operations stay blocked so a single hallucinated statement can't wipe the
// platform. The owner runs those from a real psql session, not from chat.
const WRITE_SQL_RE = /^\s*(INSERT|UPDATE|DELETE)\s/i;
const CATASTROPHIC_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bDROP\b/i, reason: 'DROP is never allowed from AI chat' },
  { re: /\bTRUNCATE\b/i, reason: 'TRUNCATE wipes whole tables' },
  { re: /\bALTER\b/i, reason: 'schema changes must be a migration, not AI chat' },
  { re: /\bGRANT\b|\bREVOKE\b/i, reason: 'permission changes are not allowed from AI chat' },
  { re: /\bCREATE\b/i, reason: 'CREATE must be a migration, not AI chat' },
  // UPDATE/DELETE with no WHERE = touches every row. Almost always a mistake.
  { re: /^\s*(UPDATE|DELETE)\b(?![\s\S]*\bWHERE\b)/i, reason: 'UPDATE/DELETE without a WHERE clause affects every row' },
  { re: /;\s*\S/, reason: 'multiple statements in one query are not allowed' },
  { re: /\/\*/, reason: 'block comments can hide malicious SQL' },
  { re: /--/, reason: 'line comments can hide SQL or spoof a fake WHERE clause' },
];

export function isSqlWriteEnabled(): boolean {
  return process.env.SAMS_AI_SQL_WRITE === '1';
}

/** Screen a write statement. Returns a block reason, or null when it's allowed. */
export function assessWriteQuery(sql: string): string | null {
  const trimmed = sql.trim();
  if (!WRITE_SQL_RE.test(trimmed)) {
    return 'Only INSERT, UPDATE, and DELETE writes are supported here.';
  }
  const hit = CATASTROPHIC_PATTERNS.find((p) => p.re.test(trimmed));
  return hit ? hit.reason : null;
}

/**
 * Run a write statement (INSERT/UPDATE/DELETE) — Super Admin, opt-in only.
 * Returns the number of affected rows. Callers MUST have already gated on role
 * and confirmation; this layer only enforces the flag + catastrophic deny-list.
 */
export async function runWriteQuery(sql: string): Promise<{ affectedRows: number; executionMs: number }> {
  if (!isSqlWriteEnabled()) {
    throw new Error('SQL writes are disabled. Set SAMS_AI_SQL_WRITE=1 on the server to enable them.');
  }
  const blockReason = assessWriteQuery(sql);
  if (blockReason) throw new Error(`Blocked: ${blockReason}.`);

  const trimmed = sql.trim();
  if (trimmed.length > 2000) throw new Error('Query too long. Maximum 2000 characters.');

  const start = Date.now();
  try {
    const affectedRows = await prisma.$executeRawUnsafe(trimmed);
    return { affectedRows, executionMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Write failed: ${message}`);
  }
}

// ─── Services ────────────────────────────────────────────────────────────────

/**
 * Run a raw SQL query against the database. ONLY SELECT/EXPLAIN/DESCRIBE/SHOW
 * statements are allowed. All mutations are blocked.
 */
export async function runRawQuery(
  sql: string,
  limit = 200,
): Promise<DbQueryResult> {
  const trimmed = sql.trim();

  if (!isReadOnlyQuery(trimmed)) {
    throw new Error(
      'Only SELECT, EXPLAIN, DESCRIBE, and SHOW queries are allowed. ' +
      'Mutations (INSERT, UPDATE, DELETE, DROP, ALTER, etc.) are blocked.',
    );
  }

  // Add LIMIT if SELECT and no LIMIT clause present
  let finalSql = trimmed;
  if (/^\s*SELECT\b/i.test(trimmed) && !/\bLIMIT\b/i.test(trimmed)) {
    finalSql = `${trimmed.replace(/;\s*$/, '')} LIMIT ${limit}`;
  }

  // Safety: cap at 2000 chars
  if (finalSql.length > 2000) {
    throw new Error('Query too long. Maximum 2000 characters.');
  }

  const start = Date.now();
  try {
    const raw: unknown = await prisma.$queryRawUnsafe(finalSql);
    const rows = (raw as Record<string, unknown>[]) ?? [];
    const total = rows.length;
    const truncated = total > limit;

    const displayRows = rows.slice(0, limit);
    const columns =
      displayRows.length > 0 ? Object.keys(displayRows[0]!) : [];

    return {
      columns,
      rows: displayRows,
      totalRows: total,
      truncated,
      executionMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Query failed: ${message}`);
  }
}

/**
 * List all user-defined tables in the public schema with row counts and column info.
 */
export async function listAllTables(): Promise<DbTableInfo[]> {
  const tableRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
      t.table_name,
      (SELECT reltuples::bigint FROM pg_class WHERE oid = (quote_ident(t.table_name)::regclass)) AS row_count
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name`,
  );

  const result: DbTableInfo[] = [];

  for (const row of tableRows) {
    const tableName = row.table_name as string;
    const colRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      tableName,
    );

    result.push({
      tableName,
      rowCount: Number(row.row_count ?? 0),
      columns: colRows.map((c) => ({
        name: c.column_name as string,
        type: c.data_type as string,
      })),
    });
  }

  return result;
}

/**
 * Find a row by any value across all columns in a table (fuzzy search).
 * Useful for "find the school's email" style queries.
 */
export async function findInTable(
  tableName: string,
  searchValue: string,
  limit = 10,
): Promise<DbQueryResult> {
  // Validate table name (alphanumeric + underscore only)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  // Get all columns for this table
  const colRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    tableName,
  );

  const textColumns = colRows
    .filter(
      (c) =>
        (c.data_type as string).includes('char') ||
        (c.data_type as string).includes('text') ||
        (c.data_type as string) === 'uuid' ||
        (c.data_type as string) === 'json' ||
        (c.data_type as string) === 'jsonb',
    )
    .map((c) => c.column_name as string);

  if (textColumns.length === 0) {
    throw new Error(`No searchable text columns in table "${tableName}"`);
  }

  // Build WHERE clause: OR across all text columns using ILIKE
  const conditions = textColumns
    .map((col) => `"${col}"::text ILIKE $1`)
    .join(' OR ');

  const searchPattern = `%${searchValue.replace(/[%_]/g, '\\$&')}%`;
  const sql = `SELECT * FROM "${tableName}" WHERE ${conditions} LIMIT ${limit}`;

  const start = Date.now();
  const raw: unknown = await prisma.$queryRawUnsafe(sql, searchPattern);
  const rows = (raw as Record<string, unknown>[]) ?? [];

  return {
    columns: rows.length > 0 ? Object.keys(rows[0]!) : [],
    rows,
    totalRows: rows.length,
    truncated: rows.length >= limit,
    executionMs: Date.now() - start,
  };
}
