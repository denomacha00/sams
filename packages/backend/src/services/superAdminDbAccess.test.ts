import { describe, it, expect } from 'vitest';
import { isReadOnlyQuery, assessWriteQuery } from './superAdminDbAccess';

describe('superAdminDbAccess deny-list', () => {
  describe('isReadOnlyQuery', () => {
    it('allows plain SELECT/EXPLAIN queries', () => {
      expect(isReadOnlyQuery('SELECT id, name FROM users LIMIT 10')).toBe(true);
      expect(isReadOnlyQuery('EXPLAIN SELECT * FROM users')).toBe(true);
    });

    it('rejects write/DDL statements', () => {
      expect(isReadOnlyQuery('DELETE FROM users')).toBe(false);
      expect(isReadOnlyQuery('SELECT 1; DROP TABLE users')).toBe(false);
    });

    it('rejects server-side file access / exfiltration functions', () => {
      expect(isReadOnlyQuery("SELECT pg_read_file('/etc/passwd')")).toBe(false);
      expect(isReadOnlyQuery("SELECT lo_export(1, '/tmp/x')")).toBe(false);
      expect(isReadOnlyQuery("SELECT * FROM dblink('x','y')")).toBe(false);
      expect(isReadOnlyQuery("SELECT pg_ls_dir('.')")).toBe(false);
    });

    it('rejects line and block comments that can hide SQL', () => {
      expect(isReadOnlyQuery('SELECT * FROM users -- comment')).toBe(false);
      expect(isReadOnlyQuery('SELECT * /* hidden */ FROM users')).toBe(false);
    });
  });

  describe('assessWriteQuery', () => {
    it('allows a scoped UPDATE with WHERE', () => {
      expect(assessWriteQuery("UPDATE users SET name = 'x' WHERE id = '1'")).toBeNull();
    });

    it('blocks UPDATE/DELETE without WHERE', () => {
      expect(assessWriteQuery('DELETE FROM users')).toMatch(/WHERE/i);
    });

    it('blocks a full-table DELETE that spoofs a WHERE inside a line comment', () => {
      // Without stripping/blocking comments, the naive WHERE check would see the
      // commented-out WHERE and wrongly allow a full-table delete.
      expect(assessWriteQuery('DELETE FROM users -- WHERE id = 1')).not.toBeNull();
    });

    it('blocks DROP/TRUNCATE/ALTER and stacked statements', () => {
      expect(assessWriteQuery('DROP TABLE users')).not.toBeNull();
      expect(assessWriteQuery('TRUNCATE users')).not.toBeNull();
      expect(assessWriteQuery("UPDATE users SET a=1 WHERE id='1'; DELETE FROM logs")).not.toBeNull();
    });
  });
});
