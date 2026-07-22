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
// and slots get skipped for capacity reasons — that keeps the assignment
// assertions deterministic (there is NO wildcard fallback; unregistered
// subjects/teachers are simply never scheduled).
const HIGH_CAP = 1000;

interface MockSetup {
  classes: { id: string; name: string; departmentId: string }[];
  teachers: { id: string; fullName: string; departmentId: string | null }[];
  teacherSubjects: { teacherId: string; subject: string }[];
  // Subjects present in the department only via historical timetable entries
  // (i.e. no teacher registered them).
  historicalSubjects?: string[];
  // Rooms already occupied school-wide by other classes not being regenerated.
  occupiedRooms?: { room: string; dayOfWeek: number; startTime: string }[];
}

/**
 * Wire the prisma mocks for a preview run. The generator issues:
 *  - class.findMany            → classes
 *  - user.findMany             → teachers
 *  - loadSubjectCatalog: timetableEntry.findMany (select.class) + teacherSubject.findMany (select.teacher)
 *  - existing bookings: timetableEntry.findMany  (empty — our class is a target)
 *  - knowledge: teacherSubject.findMany (teacherId+subject) + timetableEntry.findMany distinct
 */
function wireMocks({ classes, teachers, teacherSubjects, historicalSubjects = [], occupiedRooms = [] }: MockSetup): void {
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
    // loadOccupiedRooms query selects room + slot for school-wide clash avoidance.
    if (args?.select?.room) {
      return Promise.resolve(occupiedRooms);
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

  it('matches registered subjects case- and whitespace-insensitively', async () => {
    // A teacher who registered "  mathematics " (messy case + spaces) must still
    // own the Mathematics slots. Before normalization the exact-string match
    // failed and no qualified teacher was found. The subject catalog is built
    // ONLY from TeacherSubject rows, so the display subject reflects the
    // registered value (trimmed) — matching is what we assert here.
    wireMocks({
      classes: [{ id: 'c1', name: 'Form 1', departmentId: DEPT }],
      teachers: [
        { id: 'tMath', fullName: 'Math Teacher', departmentId: DEPT },
        { id: 'tAny', fullName: 'Relief Teacher', departmentId: DEPT },
      ],
      // Registered with messy casing/spacing.
      teacherSubjects: [{ teacherId: 'tMath', subject: '  mathematics ' }],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
    });

    expect(result.slots.length).toBeGreaterThan(0);
    // Every slot is Mathematics (case-insensitive) and owned by the registered
    // teacher — the unregistered teacher must never be guessed onto it.
    expect(result.slots.every((s) => s.subject.trim().toLowerCase() === 'mathematics')).toBe(true);
    expect(result.slots.every((s) => s.teacherId === 'tMath')).toBe(true);
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

  it('never schedules a subject that no teacher registered (no wildcard fallback)', async () => {
    // "History" existed only as a historical timetable entry — nobody registered
    // it via TeacherSubject. The generator must NOT resurrect it, and must NOT
    // assign an unregistered "relief" teacher to cover it. Guessing was removed
    // deliberately (commit: "remove all guessing - only use TeacherSubject").
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

    // History was never registered → it must not appear at all.
    expect(result.slots.some((s) => s.subject === 'History')).toBe(false);
    // tMath only ever teaches its registered subject.
    expect(result.slots.every((s) => s.teacherId === 'tMath' && s.subject === 'Mathematics')).toBe(true);
    // The unregistered teacher is never used as a wildcard.
    expect(result.slots.some((s) => s.teacherId === 'tAny')).toBe(false);
  });

  it('varies rooms across periods and never double-books a room in the same slot', async () => {
    // Several classes + several teachers so each period fills multiple classes.
    // With per-slot room assignment, no two classes in the same (day, startTime)
    // may share a room, and a single class must NOT sit in the same room every
    // period (the old global round-robin bug).
    wireMocks({
      classes: [
        { id: 'c1', name: 'Form 1', departmentId: DEPT },
        { id: 'c2', name: 'Form 2', departmentId: DEPT },
        { id: 'c3', name: 'Form 3', departmentId: DEPT },
      ],
      teachers: [
        { id: 't1', fullName: 'Teacher A', departmentId: DEPT },
        { id: 't2', fullName: 'Teacher B', departmentId: DEPT },
        { id: 't3', fullName: 'Teacher C', departmentId: DEPT },
      ],
      teacherSubjects: [
        { teacherId: 't1', subject: 'Mathematics' },
        { teacherId: 't2', subject: 'English' },
        { teacherId: 't3', subject: 'Biology' },
      ],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
      rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4'],
    });

    const withRoom = result.slots.filter((s) => s.room);
    expect(withRoom.length).toBeGreaterThan(0);

    // 1) No two classes share a room within the same day + startTime.
    const slotRooms = new Map<string, Set<string>>();
    for (const s of withRoom) {
      const key = `${s.dayOfWeek}|${s.startTime}`;
      const used = slotRooms.get(key) ?? new Set<string>();
      expect(used.has(s.room!)).toBe(false); // no double-book
      used.add(s.room!);
      slotRooms.set(key, used);
    }

    // 2) At least one class uses more than one distinct room across its lessons
    //    (rooms actually change, not pinned to one).
    const roomsByClass = new Map<string, Set<string>>();
    for (const s of withRoom) {
      const set = roomsByClass.get(s.classId) ?? new Set<string>();
      set.add(s.room!);
      roomsByClass.set(s.classId, set);
    }
    const someClassVaries = [...roomsByClass.values()].some((set) => set.size > 1);
    expect(someClassVaries).toBe(true);
  });

  it('rotates rooms for a single class even when room count divides the period step', async () => {
    // Regression: the old offset keyed room choice on the period START TIME. Period
    // times step by the period duration (40 min), so `startMinutes % roomCount`
    // was constant whenever roomCount divided 40 (here 4 rooms) — every period
    // picked the same starting room and a lone class sat in ONE room all day.
    // With ONE class + one multi-subject teacher, that class fills the whole day,
    // so its rooms MUST still cycle through several distinct rooms.
    wireMocks({
      classes: [{ id: 'c1', name: 'Form 1', departmentId: DEPT }],
      teachers: [{ id: 't1', fullName: 'Teacher A', departmentId: DEPT }],
      teacherSubjects: [
        { teacherId: 't1', subject: 'Mathematics' },
        { teacherId: 't1', subject: 'English' },
        { teacherId: 't1', subject: 'Biology' },
      ],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
      periodDuration: 40, // step that the old bug divided evenly by roomCount
      rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4'], // 4 divides 40
    });

    // The bug was WITHIN a single day: every period that day picked the same
    // starting room, so the class sat in one room all day. Assert that on at
    // least one day the class occupies more than one distinct room.
    const roomsByDay = new Map<number, Set<string>>();
    for (const s of result.slots) {
      if (!s.room) continue;
      const set = roomsByDay.get(s.dayOfWeek) ?? new Set<string>();
      set.add(s.room);
      roomsByDay.set(s.dayOfWeek, set);
    }
    const anyDayVaries = [...roomsByDay.values()].some((set) => set.size > 1);
    expect(anyDayVaries).toBe(true);
  });

  it('never reuses a room already booked by another department in the same slot', async () => {
    // Only one room exists, and it is already taken school-wide on Monday 08:00
    // by another department's class (not being regenerated). The generator must
    // NOT place any lesson in that room at Mon 08:00.
    wireMocks({
      classes: [{ id: 'c1', name: 'Form 1', departmentId: DEPT }],
      teachers: [{ id: 't1', fullName: 'Teacher A', departmentId: DEPT }],
      teacherSubjects: [{ teacherId: 't1', subject: 'Mathematics' }],
      occupiedRooms: [{ room: 'Lab A', dayOfWeek: 0, startTime: '08:00' }],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
      rooms: ['Lab A'],
    });

    // No lesson may occupy Lab A at Mon 08:00 — it's booked elsewhere in school.
    const clash = result.slots.some(
      (s) => s.room === 'Lab A' && s.dayOfWeek === 0 && s.startTime === '08:00',
    );
    expect(clash).toBe(false);
  });

  it('treats differently-typed room names as the same physical room', async () => {
    // Another department booked the room as "LAB1" on Mon 08:00. An admin here
    // lists the same room as "Lab 1". These must be recognised as ONE room, so
    // "Lab 1" cannot be scheduled at Mon 08:00 despite the different spelling.
    wireMocks({
      classes: [{ id: 'c1', name: 'Form 1', departmentId: DEPT }],
      teachers: [{ id: 't1', fullName: 'Teacher A', departmentId: DEPT }],
      teacherSubjects: [{ teacherId: 't1', subject: 'Mathematics' }],
      occupiedRooms: [{ room: 'LAB1', dayOfWeek: 0, startTime: '08:00' }],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
      rooms: ['Lab 1'],
    });

    // "Lab 1" == "LAB1" — must not be reused at the occupied slot.
    const clash = result.slots.some(
      (s) => s.room === 'Lab 1' && s.dayOfWeek === 0 && s.startTime === '08:00',
    );
    expect(clash).toBe(false);
  });

  it('collapses duplicate room spellings so they are not counted as extra rooms', async () => {
    // The admin accidentally lists the same room five ways. The generator must
    // treat them as ONE room — so within any single (day, period) at most one
    // class can be placed in it, never several "different" rooms.
    wireMocks({
      classes: [
        { id: 'c1', name: 'Form 1', departmentId: DEPT },
        { id: 'c2', name: 'Form 2', departmentId: DEPT },
      ],
      teachers: [
        { id: 't1', fullName: 'Teacher A', departmentId: DEPT },
        { id: 't2', fullName: 'Teacher B', departmentId: DEPT },
      ],
      teacherSubjects: [
        { teacherId: 't1', subject: 'Mathematics' },
        { teacherId: 't2', subject: 'English' },
      ],
    });

    const result = await timetableGeneratorService.generatePreview({
      schoolId: SCHOOL, departmentId: DEPT, maxLessonsPerTeacherPerDay: HIGH_CAP,
      rooms: ['Lab 1', 'Lab1', 'Lab   1', 'LAB1', 'LAB 1'],
    });

    // All five spellings are one room → at most one roomed lesson per slot.
    const perSlot = new Map<string, number>();
    for (const s of result.slots) {
      if (!s.room) continue;
      const key = `${s.dayOfWeek}|${s.startTime}`;
      perSlot.set(key, (perSlot.get(key) ?? 0) + 1);
    }
    expect([...perSlot.values()].every((n) => n <= 1)).toBe(true);
  });
});
