import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@sams/shared';

const { prismaMock, knowledgeMock } = vi.hoisted(() => ({
  prismaMock: {
    aIKnowledge: { findMany: vi.fn() },
  },
  knowledgeMock: {
    getForAIContext: vi.fn(),
  },
}));

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../knowledgeService', () => ({ knowledgeService: knowledgeMock }));

import { localQuery } from './localEngine';

describe('handleCustomKnowledge — empty knowledge base falls through to the LLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    knowledgeMock.getForAIContext.mockResolvedValue([]);
    prismaMock.aIKnowledge.findMany.mockResolvedValue([]);
  });

  it('returns unknown (not the "no knowledge added" system message) so AIService uses the LLM', async () => {
    const superAdmin = { sub: 'sa-1', role: UserRole.SUPER_ADMIN, schoolId: 'platform' };
    const r = await localQuery(superAdmin as any, 'tell me about quantum physics');

    // Was previously intent 'custom_knowledge' with a dead-end message. Must now
    // be unknown+empty so the provider chain answers the question.
    expect(r.intent).toBe('unknown');
    expect(r.answer).toBe('');
    expect(r.answer).not.toMatch(/no custom knowledge|has not added|knowledge base page/i);
  });

  it('also falls through for a school user with an empty knowledge base', async () => {
    const teacher = { sub: 't-1', role: UserRole.TEACHER, schoolId: 'school-1', classId: 'class-1' };
    const r = await localQuery(teacher as any, 'tell me about the French revolution');

    expect(r.intent).toBe('unknown');
    expect(r.answer).toBe('');
  });
});
