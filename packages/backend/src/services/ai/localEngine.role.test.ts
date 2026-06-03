import { describe, expect, it } from 'vitest';
import { UserRole } from '@sams/shared';
import { localQuery } from './localEngine';

describe('localQuery role gating', () => {
  const teacher = {
    sub: 'teacher-1',
    schoolId: 'school-1',
    role: UserRole.TEACHER,
    classId: 'class-1',
    iat: 0,
    exp: 9999999999,
  };

  it('denies platform system_stats to non-super-admin', async () => {
    const result = await localQuery(teacher, 'how many schools on the platform?');
    expect(result.intent).toBe('system_stats');
    expect(result.answer).toMatch(/Super Admin/i);
  });

  it('denies super_admin_help to non-super-admin', async () => {
    const result = await localQuery(teacher, 'how to generate a license');
    expect(result.intent).toBe('super_admin_help');
    expect(result.answer).toMatch(/Super Admin/i);
  });
});
