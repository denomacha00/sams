import { describe, it, expect, vi, beforeEach } from 'vitest';
import { timetableGeneratorService } from './timetableGeneratorService';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: {
    class: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    timetableEntry: { findMany: vi.fn() },
    teacherSubject: { findMany: vi.fn() },
  },
}));

const SCHOOL = 'school-1';
const DEPT = 'dept-1';
// Give teachers a high daily cap so a registered teacher never hits the limit
// and overflows to the wildcard pool — that keeps the preference assertions
// deterministic (the fallback behaviour is exercised explicitly in its own test).
const HIGH_CAP = 1000;

interface MockSetup {
  classes: { id: string; name: string; departmentId: string }[];
  teachers: { id: string; fullName: string; departmentId: string | null }[];
  teacherSubjects: { teacherId: string; subject: string }[];
  // Subjects present in the department only via historical timetable entries
  // (i.e. no teacher registered them).
  historicalSubjects?: string[];
}

/**
 * Wire the prisma mocks for a preview run. The generator issues:
 *  - class.findMany            → classes
 *  - user.findMany             → teachers
 *  - loadSubjectCatalog: timetableEntry.findMany (select.class) + teacherSubject.findMany (select.teacher)
 *  - existing bookings: timetableEntry.findMany  (empty — our class is a target)
 *  - knowledge: teacherSubject.findMany (teacherId+subject) + timetableEntry.findMany distinct
 */
function wireMocks({ classes, teachers, teacherSubjects, historicalSubjects = [] }: MockSetup): void {
  (prisma.class.findMany as any).mockResolvedValue(classes);
  (prisma.user.findMany as any).mockResolvedValue(teachers);

  const deptOf = new Map(teachers.map((t) => [t.id, t.departmentId]));

  (prisma.teacherSubject.findMany as any).mockImplementation((args: any) => {
    if (args?.select?.teacher) {
      return Promise.resolve(
        teacherSubjects.map((r) => ({ subject: r.subject, teacher: { departmentId: deptOf.get(r.teacherId) ?? null } })),
      );
    }
    return Promise.resolve(teacherSubjects.map((r) => ({ teacherId: r.teacherId, subject: r.subject })));
  });

  (prisma.timetableEntry.findMany as any).mockImplementation((args: any) => {
    // Catalog query selects the class relation — inject historical subjects here
    // so they land in the department catalog without any teacher registering them.
    if (args?.select?.class) {
      return Promise.resolve(
        historicalSubjects.map((subject) => ({ subject, class: { departmentId: DEPT } })),
      );
    }
    // Existing bookings + distinct known-subjects: none.
    return Promise.resolve([]);
  });
}

describe('timetableGeneratorService.generatePreview — teacher subject assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns registered subjects only to the teachers who registered them', async () => {
    wireMocks({
      classes: [{ id: 'c1', name: 'Form 1', departmentId: DEPT }],
      teachers: [
        { id: 'tMath', fullName: 'Math Teacher', departmentId: DEPT },
        { id: 'tEng', fullName: 'English Teacher', departmentId: DEPT },
      ],
      teacherSubjects: [
        { teacherId: 'tMath', subject: 'Mathematics' },
        { teacherId: 'tEng', subject: 'English' },
      ],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
    });

    for (const slot of result.slots) {
      if (slot.subject === 'Mathematics') expect(slot.teacherId).toBe('tMath');
      if (slot.subject === 'English') expect(slot.teacherId).toBe('tEng');
    }
    const mathSlots = result.slots.filter((s) => s.teacherId === 'tMath');
    const engSlots = result.slots.filter((s) => s.teacherId === 'tEng');
    expect(mathSlots.length).toBeGreaterThan(0);
    expect(engSlots.length).toBeGreaterThan(0);
    expect(mathSlots.every((s) => s.subject === 'Mathematics')).toBe(true);
    expect(engSlots.every((s) => s.subject === 'English')).toBe(true);
  });

  it('prefers a registered teacher over an unconstrained one for that subject', async () => {
    // tMath registered Mathematics; tAny registered nothing (wildcard).
    wireMocks({
      classes: [{ id: 'c1', name: 'Form 1', departmentId: DEPT }],
      teachers: [
        { id: 'tMath', fullName: 'Math Teacher', departmentId: DEPT },
        { id: 'tAny', fullName: 'Relief Teacher', departmentId: DEPT },
      ],
      teacherSubjects: [{ teacherId: 'tMath', subject: 'Mathematics' }],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
    });

    const mathSlots = result.slots.filter((s) => s.subject === 'Mathematics');
    expect(mathSlots.length).toBeGreaterThan(0);
    // The wildcard teacher must never get Mathematics while the registered
    // Math teacher is free (and with a high cap they are always free).
    expect(mathSlots.every((s) => s.teacherId === 'tMath')).toBe(true);
    expect(result.slots.some((s) => s.teacherId === 'tAny')).toBe(false);
  });

  it('does NOT inject hardcoded default subjects when teachers registered real ones', async () => {
    // Only Mathematics is registered. The generator must never schedule any of
    // the hardcoded DEFAULT_SUBJECTS (English, Chemistry, Physics, ...) that no
    // teacher registered — that was the "guessing" bug.
    wireMocks({
      classes: [{ id: 'c1', name: 'Form 1', departmentId: DEPT }],
      teachers: [{ id: 'tMath', fullName: 'Math Teacher', departmentId: DEPT }],
      teacherSubjects: [{ teacherId: 'tMath', subject: 'Mathematics' }],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
    });

    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.slots.every((s) => s.subject === 'Mathematics')).toBe(true);
  });

  it('falls back to an unconstrained teacher only when no registered teacher exists', async () => {
    // "History" exists in the department (historical entry) but nobody registered
    // it — only the wildcard teacher can cover it.
    wireMocks({
      classes: [{ id: 'c1', name: 'Form 1', departmentId: DEPT }],
      teachers: [
        { id: 'tMath', fullName: 'Math Teacher', departmentId: DEPT },
        { id: 'tAny', fullName: 'Relief Teacher', departmentId: DEPT },
      ],
      teacherSubjects: [{ teacherId: 'tMath', subject: 'Mathematics' }],
      historicalSubjects: ['History'],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
    });

    // tMath (registered only for Mathematics) must never teach anything else.
    const mathTeacherSlots = result.slots.filter((s) => s.teacherId === 'tMath');
    expect(mathTeacherSlots.every((s) => s.subject === 'Mathematics')).toBe(true);
    // History has no registered teacher, so the wildcard covers it.
    const historySlots = result.slots.filter((s) => s.subject === 'History');
    expect(historySlots.length).toBeGreaterThan(0);
    expect(historySlots.every((s) => s.teacherId === 'tAny')).toBe(true);
  });
});
