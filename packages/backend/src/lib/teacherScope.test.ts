import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    class: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from './prisma';
import { resolveTeacherClassId } from './teacherScope';

describe('resolveTeacherClassId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers classTeacherId over stale JWT hint', async () => {
    (prisma.class.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'class-live' });
    const id = await resolveTeacherClassId('teacher-1', 'class-stale-jwt');
    expect(id).toBe('class-live');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('uses DB user.classId when not class teacher on record', async () => {
    (prisma.class.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ classId: 'class-db' });
    const id = await resolveTeacherClassId('teacher-1', 'class-stale-jwt');
    expect(id).toBe('class-db');
  });

  it('falls back to JWT hint when DB has no class', async () => {
    (prisma.class.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ classId: null });
    const id = await resolveTeacherClassId('teacher-1', 'class-hint');
    expect(id).toBe('class-hint');
  });

  it('returns null when no assignment', async () => {
    (prisma.class.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ classId: null });
    const id = await resolveTeacherClassId('teacher-1', undefined);
    expect(id).toBeNull();
  });
});
