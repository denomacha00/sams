import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    class: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from './prisma';
import { resolveTeacherClassId } from './teacherScope';

describe('resolveTeacherClassId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns token classId when present', async () => {
    const id = await resolveTeacherClassId('teacher-1', 'class-a');
    expect(id).toBe('class-a');
    expect(prisma.class.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to class where user is class teacher', async () => {
    (prisma.class.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'class-b' });
    const id = await resolveTeacherClassId('teacher-1', null);
    expect(id).toBe('class-b');
    expect(prisma.class.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classTeacherId: 'teacher-1' } }),
    );
  });

  it('returns null when no assignment', async () => {
    (prisma.class.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const id = await resolveTeacherClassId('teacher-1', undefined);
    expect(id).toBeNull();
  });
});
