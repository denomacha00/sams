import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { findAction } from '../roleActionRegistry';

vi.mock('../departmentStatsQuery', () => ({
  fetchDepartmentStats: vi.fn().mockResolvedValue({
    teacherCount: 1,
    studentCount: 15,
    classCount: 2,
    departmentId: 'dept-1',
  }),
  formatDepartmentStatsAnswer: vi.fn(
    (stats: { teacherCount: number; studentCount: number; classCount: number }) =>
      `Teachers: ${stats.teacherCount}, Students: ${stats.studentCount}, Classes: ${stats.classCount}`,
  ),
}));

describe('view_department_stats handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns teacher, student, and class counts for HOD scope', async () => {
    const actionDef = findAction(UserRole.HOD, 'view_department_stats');
    expect(actionDef).toBeDefined();

    const result = await actionDef!.handler(
      {},
      {
        userId: 'hod-1',
        role: UserRole.HOD,
        schoolId: 'school-1',
        departmentId: 'dept-1',
      },
    );

    expect(result.answer).toContain('Students: 15');
    expect(result.answer).toContain('Teachers: 1');
    expect(result.answer).toContain('Classes: 2');
    expect(result.data).toMatchObject({
      teacherCount: 1,
      studentCount: 15,
      classCount: 2,
      departmentId: 'dept-1',
    });
  });

  it('reports missing department on HOD account', async () => {
    const actionDef = findAction(UserRole.HOD, 'view_department_stats')!;
    const result = await actionDef.handler(
      {},
      { userId: 'hod-1', role: UserRole.HOD, schoolId: 'school-1' },
    );
    expect(result.answer).toMatch(/not associated with a department/i);
  });
});
