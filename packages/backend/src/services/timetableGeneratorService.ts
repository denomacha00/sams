import { prisma } from '../lib/prisma';
import { UserRole } from '@sams/shared';

// NOTE: there is deliberately NO default/hardcoded unit list here. The generator
// only ever schedules units that teachers explicitly registered via TeacherSubject.
const DEFAULT_DAYS = [0, 1, 2, 3, 4];

export interface GenerateOptions {
  schoolId: string;
  departmentId?: string;
  classIds?: string[];
  remake?: boolean;
  periodDuration?: number;
  startHour?: number;
  breakStart?: string;
  breakEnd?: string;
  lunchStart?: string;
  lunchEnd?: string;
  workingDays?: number[];
  maxLessonsPerTeacherPerDay?: number;
  /** Min free (empty) periods to leave per class per day. Default 0. */
  minFreePeriodsPerDay?: number;
  /** Max free (empty) periods to leave per class per day. Default 2. A random
   *  value in [min, max] is chosen per class per day so timetables have natural,
   *  varied gaps instead of every single period being packed. */
  maxFreePeriodsPerDay?: number;
  rooms?: string[];
  teacherSubjectMapping?: Record<string, string[]>;
}

export interface GenerateResult {
  entriesCreated: number;
  classesProcessed: number;
  teachersUsed: number;
  skippedSlots: number;
  remake: boolean;
  elapsed: number;
  stats: Record<string, number>;
  teacherAssignments: Record<string, number>;
  classNames: string[];
  teacherNames: string[];
  roomsUsed: string[];
  doubleLessons: number;
  warning?: string;
}

/** A single preview slot — same as a TimetableEntry but not yet saved */
export interface PreviewSlot {
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  endTime: string;
  room?: string;
}

/** Result of a dry-run generation (no DB writes) */
export interface PreviewResult {
  slots: PreviewSlot[];
  stats: Record<string, number>;
  teacherAssignments: Record<string, number>;
  classNames: string[];
  teacherNames: string[];
  roomsUsed: string[];
  doubleLessons: number;
  skippedSlots: number;
}

interface TeacherInfo { id: string; fullName: string; departmentId: string | null; }
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
interface ClassInfo { id: string; name: string; departmentId: string; }
interface TimetableSlot {
  schoolId: string; classId: string; teacherId: string; subject: string;
  dayOfWeek: number; startTime: string; endTime: string; room?: string;
}
interface SubjectCatalog { byDepartment: Map<string, string[]>; schoolWide: string[]; }
interface PeriodBlock { startTime: string; endTime: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function t2m(t: string): number { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function m2t(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function uniqueSubjects(ss: string[]): string[] {
  const seen = new Set<string>();
  return ss.filter((s) => { const k = s.trim().toLowerCase(); return s.trim() && !seen.has(k) ? (seen.add(k), true) : false; });
}
function getSubjects(cls: ClassInfo, cat: SubjectCatalog): string[] {
  const s = cat.byDepartment.get(cls.departmentId) ?? cat.schoolWide;
  // NEVER fall back to hardcoded subjects — only use what teachers registered.
  return s;
}
/** Canonical key for subject matching — trim + lowercase so "Mathematics",
 *  "mathematics", and " Math " map to the same teacher pool. Without this the
 *  reverse map lookup misses and the generator falls back to a wildcard teacher
 *  ("guessing"). Display names are preserved separately from the match key. */
function normSubject(s: string): string {
  return s.trim().toLowerCase();
}

/** Canonical key for room matching. Different people type the same physical room
 *  differently — "Lab 1", "Lab1", "Lab   1", "LAB1", "LAB 1" are ALL one room.
 *  We lowercase, collapse every run of whitespace, and also drop the spaces
 *  between a word and its trailing number so "lab 1" and "lab1" collide. Used
 *  ONLY as the clash-detection key; the original display string is preserved. */
function normRoom(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')          // collapse runs of whitespace → single space
    .replace(/(\D)\s+(\d)/g, '$1$2'); // "lab 1" → "lab1", "room  12" → "room12"
}

// ─── Schedule Tracker ─────────────────────────────────────────────────────────

class Tracker {
  private tb = new Map<string, Map<number, Set<string>>>();
  private tl = new Map<string, Map<number, number>>();
  private cb = new Map<string, Map<number, Set<string>>>();
  private cs = new Map<string, Map<number, Set<string>>>();

  teacherFree(id: string, day: number, time: string): boolean { return !(this.tb.get(id)?.get(day)?.has(time) ?? false); }
  teacherUnderLimit(id: string, day: number, max: number): boolean { return (this.tl.get(id)?.get(day) ?? 0) < max; }
  teacherLoad(id: string, day: number): number { return this.tl.get(id)?.get(day) ?? 0; }
  classFree(id: string, day: number, time: string): boolean { return !(this.cb.get(id)?.get(day)?.has(time) ?? false); }
  hasSubject(id: string, day: number, subj: string): boolean { return this.cs.get(id)?.get(day)?.has(subj) ?? false; }
  consecutiveFree(cid: string, tid: string, day: number, t1: string, t2: string): boolean {
    return this.classFree(cid, day, t1) && this.classFree(cid, day, t2) && this.teacherFree(tid, day, t1) && this.teacherFree(tid, day, t2);
  }
  book(tid: string, cid: string, day: number, time: string, subj: string): void {
    if (!this.tb.has(tid)) this.tb.set(tid, new Map());
    if (!this.tb.get(tid)!.has(day)) this.tb.get(tid)!.set(day, new Set());
    this.tb.get(tid)!.get(day)!.add(time);
    if (!this.tl.has(tid)) this.tl.set(tid, new Map());
    this.tl.get(tid)!.set(day, (this.tl.get(tid)!.get(day) ?? 0) + 1);
    if (!this.cb.has(cid)) this.cb.set(cid, new Map());
    if (!this.cb.get(cid)!.has(day)) this.cb.get(cid)!.set(day, new Set());
    this.cb.get(cid)!.get(day)!.add(time);
    if (!this.cs.has(cid)) this.cs.set(cid, new Map());
    if (!this.cs.get(cid)!.has(day)) this.cs.get(cid)!.set(day, new Set());
    this.cs.get(cid)!.get(day)!.add(subj);
  }
  seed(bs: { teacherId: string; classId: string; dayOfWeek: number; startTime: string; subject: string }[]): void {
    for (const b of bs) this.book(b.teacherId, b.classId, b.dayOfWeek, b.startTime, b.subject);
  }
}

// ─── Period Builder ───────────────────────────────────────────────────────────

function buildPeriods(sh: number, dur: number, bs: string, be: string, ls: string, le: string): PeriodBlock[] {
  const ps: PeriodBlock[] = [];
  let cur = sh * 60;
  const bS = t2m(bs), bE = t2m(be), lS = t2m(ls), lE = t2m(le), end = lE + 2 * 60;
  while (cur + dur <= end) {
    if (cur >= bS && cur < bE) { cur = bE; continue; }
    if (cur >= lS && cur < lE) { cur = lE; continue; }
    if (cur + dur > end) break;
    ps.push({ startTime: m2t(cur), endTime: m2t(cur + dur) });
    cur += dur;
  }
  return ps;
}

// ─── Generator ────────────────────────────────────────────────────────────────

function generate(
  schoolId: string, classes: ClassInfo[], teachers: TeacherInfo[],
  existing: { teacherId: string; classId: string; dayOfWeek: number; startTime: string; subject: string }[],
  catalog: SubjectCatalog, periods: PeriodBlock[], days: number[], maxDay: number,
  rooms: string[], tSubj: Map<string, Set<string>>,
  subjectMap: Map<string, TeacherInfo[]>,
  occupiedRooms: Map<string, Set<string>> = new Map(),
  minFree = 0, maxFree = 2,
): { slots: TimetableSlot[]; skipped: number; stats: Record<string, number>; assignments: Record<string, number>; doubles: number } {
  const tr = new Tracker();
  tr.seed(existing);
  const slots: TimetableSlot[] = [];
  let skipped = 0, doubles = 0;
  const stats: Record<string, number> = {}, assignments: Record<string, number> = {};

  // Room assignment: pick a room that is NOT already used by another class in the
  // same (day, period). Rooms are a SCHOOL-WIDE resource — a room busy with any
  // class in any department at this time is unavailable, so we seed usage with
  // `occupiedRooms` (existing timetable entries not being regenerated). A rotating
  // offset per time-slot means consecutive periods start from a different room, so
  // rooms genuinely vary instead of a single global round-robin (which repeats when
  // class count is a multiple of room count).
  //
  // Room identity is matched by normRoom(): "Lab 1", "Lab1", "LAB 1" are one room.
  // We dedupe the supplied room list by that key first so a mis-typed duplicate
  // doesn't inflate the apparent room count.
  const roomList: string[] = [];
  const seenRoomKeys = new Set<string>();
  for (const r of rooms) {
    const k = normRoom(r);
    if (!k || seenRoomKeys.has(k)) continue;
    seenRoomKeys.add(k);
    roomList.push(r);
  }
  // `used` sets hold NORMALIZED room keys, so a room booked elsewhere as "LAB1"
  // still blocks "Lab 1" here.
  const roomUsage = new Map<string, Set<string>>();
  for (const [key, set] of occupiedRooms) roomUsage.set(key, new Set(set));
  // Rotate rooms by each class's LESSON SEQUENCE, not the clock. A class's n-th
  // lesson starts at room (classIndex + n), so every consecutive lesson lands on
  // a different room and the class cycles through all rooms. This avoids the trap
  // of keying the offset on the period start-time: period times form an arithmetic
  // sequence (step = period duration, usually 40 min), so `startMinutes % roomCount`
  // collapses to a constant whenever roomCount divides 40 (2,4,5,8,10,20 rooms) —
  // which made every period start on the same room and "rooms never changed".
  const classIndex = new Map(classes.map((c, i) => [c.id, i]));
  const classLessonCount = new Map<string, number>();
  const pickRoom = (classId: string, day: number, startTime: string): string | undefined => {
    if (roomList.length === 0) return undefined;
    const key = `${day}|${startTime}`;
    let used = roomUsage.get(key);
    if (!used) { used = new Set<string>(); roomUsage.set(key, used); }
    const base = (classIndex.get(classId) ?? 0) + (classLessonCount.get(classId) ?? 0);
    classLessonCount.set(classId, (classLessonCount.get(classId) ?? 0) + 1);
    for (let k = 0; k < roomList.length; k++) {
      const room = roomList[(base + k) % roomList.length];
      const rk = normRoom(room);
      if (!used.has(rk)) { used.add(rk); return room; }
    }
    // Every room is already taken this period (school-wide). Do NOT force a room —
    // double-booking a physical room is impossible. Leave it unassigned ("—") so
    // an admin can resolve it; this means there are genuinely too few rooms.
    return undefined;
  };

  // ─── Strategy: fill every class in every period if possible ──────────────
  // For each day, for each period in order, iterate classes round-robin to
  // assign a teacher+subject. This ensures:
  //   (a) every class gets as many lessons as periods allow
  //   (b) teachers get a fair share of lessons across their subjects
  //   (c) teacher-subject constraints are strictly respected
  //
  // CRITICAL: Teachers are ONLY assigned to subjects they explicitly registered
  // for via TeacherSubject. NO wildcard fallback — if no registered teacher is
  // free, the slot is skipped rather than assigning an unqualified teacher.

  // ─── Free-period planning ────────────────────────────────────────────────
  // A packed timetable (every class, every period, every day) feels unnatural.
  // Real timetables breathe: most days are full-ish, some days are light (one or
  // two lessons), and occasionally a whole day is free — exactly like a real
  // college week. For each (class, day) we pre-pick which periods to leave empty
  // using a weighted random draw:
  //   • ~15% of days are "light/free" days → anywhere from `minFree` up to ALL
  //     periods free (a fully free day with no class is possible).
  //   • the rest are "normal" days → `minFree`..`maxFree` free periods (default 0–2).
  // ANY period is eligible, including the first (8am) — nothing is pinned to a
  // fixed slot. Free periods are SKIPPED during assignment (not counted as
  // "skipped" capacity failures — a gap here is by design).
  const lo = Math.max(0, Math.min(minFree, maxFree));
  const hi = Math.max(lo, Math.max(minFree, maxFree));
  const LIGHT_DAY_CHANCE = 0.15;
  const freeSlots = new Map<string, Set<string>>(); // key `${classId}|${day}` → startTimes
  for (const cls of classes) {
    for (const day of days) {
      const candidates = periods.map((p) => p.startTime); // every period eligible
      const total = candidates.length;
      if (total === 0) continue;
      let n: number;
      if (Math.random() < LIGHT_DAY_CHANCE) {
        // Light/free day: from lo free up to the WHOLE day free (no class).
        n = lo + Math.floor(Math.random() * (total - lo + 1));
      } else {
        // Normal day: lo..hi free periods (mostly full).
        n = lo + Math.floor(Math.random() * (hi - lo + 1));
      }
      n = Math.min(n, total); // allow a fully free day
      if (n <= 0) continue;
      const picked = new Set(shuffle(candidates).slice(0, n));
      freeSlots.set(`${cls.id}|${day}`, picked);
    }
  }
  const isFreeSlot = (classId: string, day: number, time: string): boolean =>
    freeSlots.get(`${classId}|${day}`)?.has(time) ?? false;

  for (const day of days) {
    const orderedPeriods = [...periods];

    for (const p of orderedPeriods) {
      for (const cls of shuffle(classes)) {
        if (!tr.classFree(cls.id, day, p.startTime)) continue;
        // Intentional free period for this class today — leave it empty.
        if (isFreeSlot(cls.id, day, p.startTime)) continue;

        const allSubs = shuffle(getSubjects(cls, catalog));
        const available = allSubs.filter((s) => !tr.hasSubject(cls.id, day, s));
        const subs = available.length > 0 ? available : allSubs;

        // ─── Find the best teacher for this subject slot ─────────────────
        // Only teachers who explicitly registered this subject via TeacherSubject
        // are eligible. If no registered teacher is free, the slot is skipped.
        let best: { teacher: TeacherInfo; subject: string } | null = null;

        const pickLeastLoaded = (pool: TeacherInfo[]): TeacherInfo | null => {
          const free = pool
            .filter((t) => tr.teacherFree(t.id, day, p.startTime) && tr.teacherUnderLimit(t.id, day, maxDay))
            .sort((a, b) => tr.teacherLoad(a.id, day) - tr.teacherLoad(b.id, day));
          return free[0] ?? null;
        };

        for (const subj of subs) {
          // Teachers who registered this subject via TeacherSubject
          // Look up by NORMALIZED key for case-insensitive matching
          const registered = subjectMap.get(normSubject(subj)) ?? [];
          const tch = pickLeastLoaded(registered);
          if (!tch) continue;

          // Prefer the least-loaded teacher for balance
          const better = !best || tr.teacherLoad(tch.id, day) < tr.teacherLoad(best.teacher.id, day);
          if (better) {
            best = { teacher: tch, subject: subj };
          }
        }

        if (!best) {
          skipped++;
          continue;
        }

        const { teacher: tch, subject: subj } = best;
        tr.book(tch.id, cls.id, day, p.startTime, subj);
        slots.push({
          schoolId, classId: cls.id, teacherId: tch.id, subject: subj,
          dayOfWeek: day, startTime: p.startTime, endTime: p.endTime,
          room: pickRoom(cls.id, day, p.startTime),
        });
        (assignments[tch.id] ??= 0);
        assignments[tch.id] += 1;
      }
    }
  }

  for (const cls of classes) {
    let total = 0;
    for (const day of days) {
      total += slots.filter((s) => s.classId === cls.id && s.dayOfWeek === day).length;
    }
    stats[cls.name] = total;
  }

  return { slots, skipped, stats, assignments, doubles };
}

function findTeacher(cand: TeacherInfo[], day: number, p: PeriodBlock, tr: Tracker, max: number): TeacherInfo | null {
  for (const t of shuffle(cand)) {
    if (tr.teacherFree(t.id, day, p.startTime) && tr.teacherUnderLimit(t.id, day, max)) return t;
  }
  return null;
}

function nextPeriod(ps: PeriodBlock[], cur: PeriodBlock): PeriodBlock | null {
  const i = ps.indexOf(cur);
  return i >= 0 && i < ps.length - 1 ? ps[i + 1] : null;
}

function buildTeacherSubjectMap(
  teachers: TeacherInfo[], mapping: Record<string, string[]> | undefined,
  explicitRows: { teacherId: string; subject: string }[],
  historyRows: { teacherId: string; subject: string }[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const explicitTeacherIds = new Set<string>();
  for (const row of explicitRows) {
    explicitTeacherIds.add(row.teacherId);
    if (!m.has(row.teacherId)) m.set(row.teacherId, new Set());
    m.get(row.teacherId)!.add(normSubject(row.subject));
  }
  if (mapping) {
    for (const [key, subs] of Object.entries(mapping)) {
      const t = teachers.find((x) => x.id === key || x.fullName.toLowerCase().includes(key.toLowerCase()));
      if (t) {
        explicitTeacherIds.add(t.id);
        if (!m.has(t.id)) m.set(t.id, new Set());
        for (const s of subs) m.get(t.id)!.add(normSubject(s));
      }
    }
  }
  for (const e of historyRows) {
    if (explicitTeacherIds.has(e.teacherId)) continue;
    if (!m.has(e.teacherId)) m.set(e.teacherId, new Set());
    m.get(e.teacherId)!.add(normSubject(e.subject));
  }
  return m;
}

/** Build reverse map: subject → list of teachers who registered for it.
 *  Teachers are ONLY added under subjects they explicitly registered via
 *  TeacherSubject. Teachers with NO registrations get nothing — they are
 *  never used as wildcards. */
function buildSubjectToTeachersMap(
  teachers: TeacherInfo[],
  tSubj: Map<string, Set<string>>,
): Map<string, TeacherInfo[]> {
  const subjectMap = new Map<string, TeacherInfo[]>();

  for (const teacher of teachers) {
    const subjects = tSubj.get(teacher.id);
    if (!subjects || subjects.size === 0) continue; // skip teachers with no registrations
    for (const subj of subjects) {
      const list = subjectMap.get(subj) ?? [];
      list.push(teacher);
      subjectMap.set(subj, list);
    }
  }

  return subjectMap;
}

async function loadClasses(schoolId: string, departmentId?: string, classIds?: string[]): Promise<ClassInfo[]> {
  const where: Record<string, unknown> = { schoolId };
  if (departmentId) where.departmentId = departmentId;
  if (classIds?.length) where.id = { in: classIds };
  return prisma.class.findMany({ where, select: { id: true, name: true, departmentId: true }, orderBy: { name: 'asc' } });
}

/**
 * Rooms are a school-wide physical resource. Load rooms already occupied by
 * timetable entries that are NOT being regenerated (other departments/classes),
 * keyed by "day|startTime", so the generator never puts two classes in the same
 * room at the same time — even across departments.
 */
async function loadOccupiedRooms(schoolId: string, excludeClassIds: string[]): Promise<Map<string, Set<string>>> {
  const rows = await prisma.timetableEntry.findMany({
    where: { schoolId, classId: { notIn: excludeClassIds }, room: { not: null } },
    select: { room: true, dayOfWeek: true, startTime: true },
  });
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.room) continue;
    const key = `${r.dayOfWeek}|${r.startTime}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(normRoom(r.room)); // normalized so "LAB1" blocks "Lab 1"
  }
  return map;
}

async function loadTeachers(schoolId: string, departmentId?: string): Promise<TeacherInfo[]> {
  return prisma.user.findMany({
    where: { schoolId, role: { in: [UserRole.TEACHER, UserRole.HOD] }, ...(departmentId ? { departmentId } : {}) },
    select: { id: true, fullName: true, departmentId: true },
  });
}

/**
 * Build the subject catalog ONLY from TeacherSubject registrations.
 * NEVER uses DEFAULT_SUBJECTS. NEVER uses timetable history (which could
 * contain subjects from previous broken generations).
 * An empty catalog means teachers haven't registered subjects yet.
 */
async function loadSubjectCatalog(schoolId: string, departmentId?: string): Promise<SubjectCatalog> {
  const teacherSubjectRows = await prisma.teacherSubject.findMany({
    where: { schoolId },
    select: { subject: true, teacher: { select: { departmentId: true, id: true } } },
  });

  const schoolWideSet = new Set<string>();
  const byDeptMap = new Map<string, Set<string>>();

  // TeacherSubject is the SINGLE source of truth for what subjects exist.
  for (const r of teacherSubjectRows) {
    if (!r.subject?.trim()) continue;
    schoolWideSet.add(r.subject.trim());
    const d = r.teacher.departmentId;
    if (d) {
      if (!byDeptMap.has(d)) byDeptMap.set(d, new Set());
      byDeptMap.get(d)!.add(r.subject.trim());
    }
  }

  const cat: SubjectCatalog = {
    schoolWide: [...schoolWideSet].sort(),
    byDepartment: new Map(),
  };
  for (const [d, subs] of byDeptMap) {
    cat.byDepartment.set(d, [...subs].sort());
  }

  return cat;
}

// ─── Public Service ───────────────────────────────────────────────────────────

export const timetableGeneratorService = {
  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const start = Date.now();
    const {
      schoolId, departmentId, classIds, remake = false,
      periodDuration = 40, startHour = 8,
      breakStart = '10:00', breakEnd = '10:20',
      lunchStart = '12:20', lunchEnd = '13:00',
      workingDays = DEFAULT_DAYS, maxLessonsPerTeacherPerDay = 6,
      minFreePeriodsPerDay = 0, maxFreePeriodsPerDay = 2,
      rooms = [], teacherSubjectMapping,
    } = opts;

    const classes = await loadClasses(schoolId, departmentId, classIds);
    if (!classes.length) throw new Error('No classes found' + (departmentId ? ' in your department' : '') + '. Create classes first.');
    const targetIds = classes.map((c) => c.id);

    const teachers = await loadTeachers(schoolId, departmentId);
    if (!teachers.length) throw new Error('No teachers found in the school. Add teachers first.');

    const catalog = await loadSubjectCatalog(schoolId, departmentId);
    if (catalog.schoolWide.length === 0) {
      throw new Error('No subjects found. Register subjects for your teachers in Teacher Subjects first.');
    }

    const existingBookings = !remake ? [] : await prisma.timetableEntry.findMany({
      where: { schoolId, classId: { notIn: targetIds }, ...(departmentId ? { class: { departmentId } } : {}) },
      select: { classId: true, teacherId: true, subject: true, dayOfWeek: true, startTime: true },
    });

    // TeacherSubject is the ONLY source for teacher-subject assignments.
    const dbSubjectRows = await prisma.teacherSubject.findMany({
      where: { schoolId },
      select: { teacherId: true, subject: true },
    });
    const tSubj = buildTeacherSubjectMap(teachers, teacherSubjectMapping, dbSubjectRows, []);

    // Build reverse map: subject → teachers who registered for it
    // Teachers with no registrations are silently dropped — no wildcards.
    let subjectMap = buildSubjectToTeachersMap(teachers, tSubj);

    // Delete existing if remake
    if (remake) {
      // Close any active sessions before entries are deleted (SetNull would orphan them)
      await prisma.attendanceSession.updateMany({
        where: { schoolId, classId: { in: targetIds }, isActive: true },
        data: { isActive: false, endedAt: new Date() },
      });
      await prisma.timetableEntry.deleteMany({ where: { schoolId, classId: { in: targetIds } } });
    } else {
      const cnt = await prisma.timetableEntry.count({ where: { schoolId, classId: { in: targetIds } } });
      if (cnt > 0) throw new Error(`Timetable already exists with ${cnt} entries. Use "Remake" to regenerate.`);
    }

    // Rooms occupied school-wide by classes we are NOT regenerating (other
    // departments). Loaded AFTER the remake delete so freed rooms aren't counted.
    const occupiedRooms = await loadOccupiedRooms(schoolId, targetIds);

    const periods = buildPeriods(startHour, periodDuration, breakStart, breakEnd, lunchStart, lunchEnd);
    const result = generate(
      schoolId, classes, teachers, existingBookings, catalog, periods,
      workingDays, maxLessonsPerTeacherPerDay, rooms, tSubj, subjectMap,
      occupiedRooms, minFreePeriodsPerDay, maxFreePeriodsPerDay,
    );
    if (!result.slots.length) throw new Error('Could not generate any timetable entries. Not enough teachers available.');

    const db = await prisma.timetableEntry.createMany({ data: result.slots });
    const elapsed = (Date.now() - start) / 1000;

    const tMap = new Map(teachers.map((t) => [t.id, t.fullName]));
    const summary: Record<string, number> = {};
    for (const [id, c] of Object.entries(result.assignments)) summary[tMap.get(id) ?? id] = c;

    return {
      entriesCreated: db.count, classesProcessed: classes.length, teachersUsed: teachers.length,
      skippedSlots: result.skipped, remake, elapsed,
      stats: result.stats, teacherAssignments: summary,
      classNames: classes.map((c) => c.name), teacherNames: teachers.map((t) => t.fullName),
      roomsUsed: rooms, doubleLessons: result.doubles,
      warning: result.skipped > 0 ? `${result.skipped} slot(s) could not be filled. Try "Generate Again" for a different result.` : undefined,
    };
  },

  /** Dry-run: generate slots but do NOT write to database. Returns preview with resolved names. */
  async generatePreview(opts: GenerateOptions): Promise<PreviewResult> {
    const {
      schoolId, departmentId, classIds,
      periodDuration = 40, startHour = 8,
      breakStart = '10:00', breakEnd = '10:20',
      lunchStart = '12:20', lunchEnd = '13:00',
      workingDays = DEFAULT_DAYS, maxLessonsPerTeacherPerDay = 6,
      minFreePeriodsPerDay = 0, maxFreePeriodsPerDay = 2,
      rooms = [], teacherSubjectMapping,
    } = opts;

    const classes = await loadClasses(schoolId, departmentId, classIds);
    if (!classes.length) throw new Error('No classes found' + (departmentId ? ' in your department' : '') + '. Create classes first.');
    const targetIds = classes.map((c) => c.id);

    const teachers = await loadTeachers(schoolId, departmentId);
    if (!teachers.length) throw new Error('No teachers found in the school. Add teachers first.');

    const catalog = await loadSubjectCatalog(schoolId, departmentId);
    if (catalog.schoolWide.length === 0) {
      throw new Error('No subjects found. Register subjects for your teachers in Teacher Subjects first.');
    }

    const existing = await prisma.timetableEntry.findMany({
      where: { schoolId, classId: { notIn: targetIds }, ...(departmentId ? { class: { departmentId } } : {}) },
      select: { classId: true, teacherId: true, subject: true, dayOfWeek: true, startTime: true },
    });

    // TeacherSubject is the ONLY source for teacher-subject assignments.
    const dbSubjectRows = await prisma.teacherSubject.findMany({
      where: { schoolId },
      select: { teacherId: true, subject: true },
    });
    const tSubj = buildTeacherSubjectMap(teachers, teacherSubjectMapping, dbSubjectRows, []);

    // Build reverse map: subject → teachers who can teach it (no wildcards)
    let subjectMap = buildSubjectToTeachersMap(teachers, tSubj);

    // Rooms occupied school-wide by classes we are NOT previewing (other depts).
    const occupiedRooms = await loadOccupiedRooms(schoolId, targetIds);

    const periods = buildPeriods(startHour, periodDuration, breakStart, breakEnd, lunchStart, lunchEnd);
    const result = generate(
      schoolId, classes, teachers, existing, catalog, periods,
      workingDays, maxLessonsPerTeacherPerDay, rooms, tSubj, subjectMap,
      occupiedRooms, minFreePeriodsPerDay, maxFreePeriodsPerDay,
    );

    const tMap = new Map(teachers.map((t) => [t.id, t.fullName]));
    const cMap = new Map(classes.map((c) => [c.id, c.name]));

    const slots: PreviewSlot[] = result.slots.map((s) => ({
      classId: s.classId,
      className: cMap.get(s.classId) ?? 'Unknown',
      teacherId: s.teacherId,
      teacherName: tMap.get(s.teacherId) ?? 'Unknown',
      subject: s.subject,
      dayOfWeek: s.dayOfWeek,
      dayName: DAY_NAMES[s.dayOfWeek] ?? 'Unknown',
      startTime: s.startTime,
      endTime: s.endTime,
      room: s.room,
    }));

    const summary: Record<string, number> = {};
    for (const [id, c] of Object.entries(result.assignments)) summary[tMap.get(id) ?? id] = c;

    return {
      slots,
      stats: result.stats,
      teacherAssignments: summary,
      classNames: classes.map((c) => c.name),
      teacherNames: teachers.map((t) => t.fullName),
      roomsUsed: rooms,
      doubleLessons: result.doubles,
      skippedSlots: result.skipped,
    };
  },
};
