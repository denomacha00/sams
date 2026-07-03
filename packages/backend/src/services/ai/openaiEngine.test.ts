import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@sams/shared';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    guardian: { findMany: vi.fn() },
    class: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    school: { findFirst: vi.fn(), count: vi.fn() },
    attendanceSession: { findMany: vi.fn(), count: vi.fn() },
    attendanceRecord: { count: vi.fn(), findMany: vi.fn() },
    riskScore: { findMany: vi.fn() },
    aIKnowledge: { findMany: vi.fn() },
  },
}));

vi.mock('../../lib/teacherScope', () => ({
  resolveTeacherTeachingClassIds: vi.fn().mockResolvedValue(['class-1']),
}));

vi.mock('../../lib/hodScope', () => ({
  resolveHodDepartmentId: vi.fn().mockResolvedValue('dept-1'),
}));

import { prisma } from '../../lib/prisma';
import { dispatchFunctionCall, sanitizeLlmOutput } from './openaiEngine';

const teacherUser = {
  sub: 'teacher-1',
  schoolId: 'school-1',
  role: UserRole.TEACHER,
  classId: 'class-1',
  iat: 0,
  exp: 9999999999,
};

const schoolAdminUser = {
  sub: 'admin-1',
  schoolId: 'school-1',
  role: UserRole.SCHOOL_ADMIN,
  iat: 0,
  exp: 9999999999,
};

describe('sanitizeLlmOutput', () => {
  it('rewrites provider identity drift to a short SAMS identity answer', () => {
    const answer = sanitizeLlmOutput('I am an AI assistant from Indus Valley built by Atomesus.');

    expect(answer).toBe("I'm SAMS AI. Denis Macharia built me, and Denis is my boss.");
    expect(answer).not.toMatch(/Indus|Atomesus|OpenAI|Groq|OpenRouter/i);
  });
});

describe('dispatchFunctionCall role scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.school.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.attendanceSession.findMany).mockResolvedValue([]);
    vi.mocked(prisma.attendanceRecord.count).mockResolvedValue(0);
  });

  it('scopes school lookup for non-super-admin users to their own school', async () => {
    await dispatchFunctionCall(
      'lookup_school',
      JSON.stringify({ name: 'Other School' }),
      teacherUser as never,
    );

    expect(prisma.school.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'school-1',
          name: { contains: 'Other School', mode: 'insensitive' },
        },
      }),
    );
  });

  it('combines user search with teacher-visible users instead of leaking all users', async () => {
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: 'student-1' }] as never)
      .mockResolvedValueOnce([] as never);

    await dispatchFunctionCall(
      'lookup_user',
      JSON.stringify({ search: 'Jane' }),
      teacherUser as never,
    );

    const lookupCall = vi.mocked(prisma.user.findMany).mock.calls[1]?.[0] as any;
    expect(lookupCall.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schoolId: 'school-1',
          OR: expect.arrayContaining([
            { id: 'teacher-1' },
            { id: { in: ['student-1'] } },
          ]),
        }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            { fullName: { contains: 'Jane', mode: 'insensitive' } },
          ]),
        }),
      ]),
    );
  });

  it('blocks raw SQL tools for non-super-admin users', async () => {
    const result = await dispatchFunctionCall(
      'query_database',
      JSON.stringify({ sql: 'SELECT * FROM "User"' }),
      schoolAdminUser as never,
      { restrictSqlToSuperAdmin: true },
    );

    expect(JSON.parse(result)).toEqual({ error: 'Only Super Admins can run raw SQL queries.' });
  });

  it('denies student reports outside a teacher scope', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: 'student-1' }] as never);

    const result = await dispatchFunctionCall(
      'query_reports',
      JSON.stringify({ scope: 'student', targetId: 'student-2' }),
      teacherUser as never,
    );

    expect(JSON.parse(result)).toEqual({ error: 'Student is outside your scope.' });
    expect(prisma.attendanceRecord.count).not.toHaveBeenCalled();
  });
});
