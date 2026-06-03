import { describe, expect, it } from 'vitest';
import { formatDepartmentStatsAnswer } from './departmentStatsQuery';

describe('formatDepartmentStatsAnswer', () => {
  it('includes teachers, students, and classes', () => {
    const answer = formatDepartmentStatsAnswer({
      teacherCount: 3,
      studentCount: 42,
      classCount: 2,
      departmentId: 'dept-1',
    });

    expect(answer).toContain('Teachers: 3');
    expect(answer).toContain('Students: 42');
    expect(answer).toContain('Classes: 2');
    expect(answer).toMatch(/Department Stats/i);
  });
});
