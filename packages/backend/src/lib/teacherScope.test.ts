import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
    prisma: {
      class: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      timetableEntry: {
        findMany: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
  },
}));

import { prisma } from './prisma';
import {
  resolveTeacherClassId,
  resolveTeacherManagedClassIds,
  resolveTeacherTeachingClassIds,
} from './teacherScope';

describe('resolveTeacherClassId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.class.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.timetableEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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

  it('returns live managed classes and ignores stale JWT hints', async () => {
    (prisma.class.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'managed-1' }]);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ classId: 'managed-2' });

    const ids = await resolveTeacherManagedClassIds('teacher-1', 'stale-jwt-class');

    expect(ids).toEqual(['managed-1', 'managed-2']);
  });

  it('does not include stale JWT hints in teaching visibility', async () => {
    (prisma.class.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ classId: null });
    (prisma.timetableEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const ids = await resolveTeacherTeachingClassIds('teacher-1', 'stale-jwt-class');

    expect(ids).toEqual([]);
  });

  it('includes timetable classes for teaching visibility', async () => {
    (prisma.class.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'managed-1' }]);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ classId: null });
    (prisma.timetableEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { classId: 'taught-1' },
      { classId: 'managed-1' },
    ]);

    const ids = await resolveTeacherTeachingClassIds('teacher-1');

    expect(ids).toEqual(['managed-1', 'taught-1']);
  });
});
