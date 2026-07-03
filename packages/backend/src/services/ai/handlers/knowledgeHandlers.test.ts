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
          createdBy: { role: 'SUPER_ADMIN' },
          OR: expect.any(Array),
        }),
      }),
    );
    expect(result.answer).toContain(longContent);
    expect(result.answer).not.toContain('...');
  });
});
