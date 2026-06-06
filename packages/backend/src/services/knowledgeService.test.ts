import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@sams/shared';

const { prismaMock, resolveTeacherClassIdMock, resolveTeacherTeachingClassIdsMock } = vi.hoisted(() => ({
  prismaMock: {
    aIKnowledge: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    class: {
      findFirst: vi.fn(),
    },
  },
  resolveTeacherClassIdMock: vi.fn(),
  resolveTeacherTeachingClassIdsMock: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('../lib/teacherScope', () => ({
  resolveTeacherClassId: resolveTeacherClassIdMock,
  resolveTeacherTeachingClassIds: resolveTeacherTeachingClassIdsMock,
}));

import { KnowledgeService } from './knowledgeService';

describe('KnowledgeService', () => {
  const service = new KnowledgeService();
  const teacher = {
    sub: 'teacher-1',
    role: UserRole.TEACHER,
    schoolId: 'school-1',
    departmentId: 'dept-token',
    classId: 'stale-token-class',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates teacher knowledge with live class and department scope', async () => {
    resolveTeacherClassIdMock.mockResolvedValue('class-live');
    prismaMock.class.findFirst.mockResolvedValue({ departmentId: 'dept-live' });
    prismaMock.aIKnowledge.create.mockResolvedValue({
      id: 'entry-1',
      title: 'Lab safety',
      content: 'Wear goggles.',
      category: 'science',
      schoolId: 'school-1',
      departmentId: 'dept-live',
      classId: 'class-live',
      createdById: 'teacher-1',
      createdBy: { fullName: 'Teacher One', role: UserRole.TEACHER },
      createdAt: new Date('2026-06-01T08:00:00Z'),
      updatedAt: new Date('2026-06-01T08:00:00Z'),
    });

    const entry = await service.create(teacher as any, {
      title: 'Lab safety',
      content: 'Wear goggles.',
      category: 'science',
    });

    expect(resolveTeacherClassIdMock).toHaveBeenCalledWith('teacher-1');
    expect(prismaMock.aIKnowledge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          departmentId: 'dept-live',
          classId: 'class-live',
        }),
      }),
    );
    expect(entry.scopeLevel).toBe('class');
  });

  it('gets entries by id through the same teacher scope used for lists and exports', async () => {
    resolveTeacherTeachingClassIdsMock.mockResolvedValue(['class-visible']);
    prismaMock.aIKnowledge.findFirst.mockResolvedValue({
      id: 'entry-2',
      title: 'Class note',
      content: 'Visible class content.',
      category: 'general',
      schoolId: 'school-1',
      departmentId: 'dept-token',
      classId: 'class-visible',
      createdById: 'admin-1',
      createdBy: { fullName: 'Admin One', role: UserRole.SCHOOL_ADMIN },
      createdAt: new Date('2026-06-01T08:00:00Z'),
      updatedAt: new Date('2026-06-01T08:00:00Z'),
    });

    await service.getById(teacher as any, 'entry-2');

    expect(prismaMock.aIKnowledge.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'entry-2',
          schoolId: 'school-1',
          OR: expect.arrayContaining([
            { departmentId: null, classId: null },
            { departmentId: 'dept-token', classId: null },
            { classId: { in: ['class-visible'] } },
          ]),
        }),
      }),
    );
  });
});
