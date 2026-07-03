import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    aIKnowledge: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: prismaMock,
}));

import { findAction } from '../roleActionRegistry';
import { actionIntentDetector } from '../actionIntentDetector';

describe('knowledgeActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searches Super Admin knowledge and returns full matching content', async () => {
    const longContent = 'Denis Macharia is the founder and developer of SAMS. '.repeat(5);
    prismaMock.aIKnowledge.findMany.mockResolvedValue([
      {
        title: 'Developer',
        content: longContent,
        createdBy: { fullName: 'Denis Macharia' },
      },
    ]);

    const action = findAction(UserRole.SUPER_ADMIN, 'search_knowledge')!;
    const result = await action.handler(
      { query: 'developer' },
      { userId: 'super-1', role: UserRole.SUPER_ADMIN, schoolId: 'platform' },
    );

    expect(prismaMock.aIKnowledge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { createdBy: { role: 'SUPER_ADMIN' } },
            expect.objectContaining({ OR: expect.any(Array) }),
          ]),
        }),
      }),
    );
    expect(result.answer).toContain(longContent);
    expect(result.answer).not.toContain('...');
  });

  it('keeps HOD department scope while searching knowledge text', async () => {
    prismaMock.aIKnowledge.findMany.mockResolvedValue([]);

    const action = findAction(UserRole.HOD, 'search_knowledge')!;
    await action.handler(
      { query: 'exam policy' },
      {
        userId: 'hod-1',
        role: UserRole.HOD,
        schoolId: 'school-1',
        departmentId: 'dept-1',
      },
    );

    expect(prismaMock.aIKnowledge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              schoolId: 'school-1',
              OR: [
                { departmentId: null, classId: null },
                { departmentId: 'dept-1' },
              ],
            },
            {
              OR: [
                { title: { contains: 'exam policy', mode: 'insensitive' } },
                { content: { contains: 'exam policy', mode: 'insensitive' } },
                { category: { contains: 'exam policy', mode: 'insensitive' } },
              ],
            },
          ],
        },
        take: 20,
      }),
    );
  });

  it('detects natural knowledge questions for roles with knowledge access', async () => {
    const result = await actionIntentDetector.detect('tell me about exam policy', UserRole.TEACHER);

    expect(result.isAction).toBe(true);
    expect(result.action).toBe('search_knowledge');
    expect(result.params).toMatchObject({ query: 'exam policy' });
  });
});
