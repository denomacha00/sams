import { prisma } from '../lib/prisma';
import { UserRole } from '@sams/shared';

const DEFAULT_SUBJECTS = [
  'Mathematics', 'English', 'Kiswahili', 'Biology', 'Chemistry',
  'Physics', 'History', 'Geography', 'CRE', 'Business Studies',
];
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
  return s.length > 0 ? s : DEFAULT_SUBJECTS;
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
): { slots: TimetableSlot[]; skipped: number; stats: Record<string, number>; assignments: Record<string, number>; doubles: number } {
  const tr = new Tracker();
  tr.seed(existing);
  const slots: TimetableSlot[] = [];
  let skipped = 0, doubles = 0;
  const stats: Record<string, number> = {}, assignments: Record<string, number> = {};

  const byDept = new Map<string, TeacherInfo[]>();
  const noDept: TeacherInfo[] = [];
  for (const t of teachers) {
    if (t.departmentId) {
      const existing = byDept.get(t.departmentId) ?? [];
      existing.push(t);
      byDept.set(t.departmentId, existing);
    } else {
      noDept.push(t);
    }
  }

  let ri = 0;
  const nextRoom = rooms.length > 0 ? () => rooms[ri++ % rooms.length] : () => undefined as string | undefined;

  for (const cls of classes) {
    const deptT = byDept.get(cls.departmentId) ?? [];
    const cand = deptT.length > 0 ? shuffle([...deptT, ...noDept]) : shuffle(teachers);
    const subs = shuffle(getSubjects(cls, catalog));

    for (const day of days) {
      let filled = 0;
      for (const p of periods) {
        if (!tr.classFree(cls.id, day, p.startTime)) { skipped++; continue; }

        // Pick subject
        let subj = subs.find((s) => !tr.hasSubject(cls.id, day, s)) ?? subs[Math.floor(Math.random() * subs.length)];

        // Find qualified teacher
        const qual = cand.filter((t) => { const ts = tSubj.get(t.id); return !ts || ts.size === 0 || ts.has(subj); });
        const tch = findTeacher(qual, day, p, tr, maxDay);
        if (!tch) { skipped++; continue; }

        // Try double lesson (30% chance)
        const next = nextPeriod(periods, p);
        const doDouble = next && Math.random() < 0.3 && tr.consecutiveFree(cls.id, tch.id, day, p.startTime, next.startTime)
          && tr.teacherLoad(tch.id, day) + 2 <= maxDay;

        if (doDouble) {
          tr.book(tch.id, cls.id, day, p.startTime, subj);
          tr.book(tch.id, cls.id, day, next.startTime, subj);
          slots.push({ schoolId, classId: cls.id, teacherId: tch.id, subject: subj, dayOfWeek: day, startTime: p.startTime, endTime: next.endTime, room: nextRoom() });
          doubles++; filled += 2; (assignments[tch.id] ??= 0, assignments[tch.id] += 2);
          continue;
        }

        tr.book(tch.id, cls.id, day, p.startTime, subj);
        slots.push({ schoolId, classId: cls.id, teacherId: tch.id, subject: subj, dayOfWeek: day, startTime: p.startTime, endTime: p.endTime, room: nextRoom() });
        filled++; (assignments[tch.id] ??= 0, assignments[tch.id] += 1);

        if (next && !tr.classFree(cls.id, day, next.startTime)) { /* consumed by double */ }
      }
      stats[cls.name] = (stats[cls.name] ?? 0) + filled;
    }
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
  existing: { teacherId: string; subject: string }[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of existing) { if (!m.has(e.teacherId)) m.set(e.teacherId, new Set()); m.get(e.teacherId)!.add(e.subject); }
  if (mapping) {
    for (const [key, subs] of Object.entries(mapping)) {
      const t = teachers.find((x) => x.id === key || x.fullName.toLowerCase().includes(key.toLowerCase()));
      if (t) { if (!m.has(t.id)) m.set(t.id, new Set()); for (const s of subs) m.get(t.id)!.add(s); }
    }
  }
  return m;
}

async function loadClasses(schoolId: string, departmentId?: string, classIds?: string[]): Promise<ClassInfo[]> {
  const where: Record<string, unknown> = { schoolId };
  if (departmentId) where.departmentId = departmentId;
  if (classIds?.length) where.id = { in: classIds };
  return prisma.class.findMany({ where, select: { id: true, name: true, departmentId: true }, orderBy: { name: 'asc' } });
}

async function loadTeachers(schoolId: string, departmentId?: string): Promise<TeacherInfo[]> {
  return prisma.user.findMany({
    where: { schoolId, role: { in: [UserRole.TEACHER, UserRole.HOD] }, ...(departmentId ? { departmentId } : {}) },
    select: { id: true, fullName: true, departmentId: true },
  });
}

async function loadSubjectCatalog(schoolId: string, departmentId?: string): Promise<SubjectCatalog> {
  const where: Record<string, unknown> = { schoolId };
  if (departmentId) where.class = { departmentId };
  const rows = await prisma.timetableEntry.findMany({ where, select: { subject: true, class: { select: { departmentId: true } } } });
  const cat: SubjectCatalog = { byDepartment: new Map(), schoolWide: uniqueSubjects(rows.map((r) => r.subject)) };
  for (const r of rows) {
    const d = r.class.departmentId;
    const e = cat.byDepartment.get(d) ?? [];
    e.push(r.subject);
    cat.byDepartment.set(d, uniqueSubjects(e));
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
      rooms = [], teacherSubjectMapping,
    } = opts;

    const classes = await loadClasses(schoolId, departmentId, classIds);
    if (!classes.length) throw new Error('No classes found' + (departmentId ? ' in your department' : '') + '. Create classes first.');
    const targetIds = classes.map((c) => c.id);

    const teachers = await loadTeachers(schoolId, departmentId);
    if (!teachers.length) throw new Error('No teachers found in the school. Add teachers first.');

    const catalog = await loadSubjectCatalog(schoolId, departmentId);

    const existingBookings = !remake ? [] : await prisma.timetableEntry.findMany({
      where: { schoolId, classId: { notIn: targetIds }, ...(departmentId ? { class: { departmentId } } : {}) },
      select: { classId: true, teacherId: true, subject: true, dayOfWeek: true, startTime: true },
    });

    // Build teacher-subject knowledge
    const existingSubjRows = await prisma.timetableEntry.findMany({
      where: { schoolId, classId: { in: targetIds }, ...(departmentId ? { class: { departmentId } } : {}) },
      select: { teacherId: true, subject: true }, distinct: ['teacherId', 'subject'],
    });
    const tSubj = buildTeacherSubjectMap(teachers, teacherSubjectMapping, existingSubjRows);

    // Delete existing if remake
    if (remake) {
      await prisma.timetableEntry.deleteMany({ where: { schoolId, classId: { in: targetIds } } });
    } else {
      const cnt = await prisma.timetableEntry.count({ where: { schoolId, classId: { in: targetIds } } });
      if (cnt > 0) throw new Error(`Timetable already exists with ${cnt} entries. Use "Remake" to regenerate.`);
    }

    const periods = buildPeriods(startHour, periodDuration, breakStart, breakEnd, lunchStart, lunchEnd);
    const result = generate(schoolId, classes, teachers, existingBookings, catalog, periods, workingDays, maxLessonsPerTeacherPerDay, rooms, tSubj);
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
      rooms = [], teacherSubjectMapping,
    } = opts;

    const classes = await loadClasses(schoolId, departmentId, classIds);
    if (!classes.length) throw new Error('No classes found' + (departmentId ? ' in your department' : '') + '. Create classes first.');

    const teachers = await loadTeachers(schoolId, departmentId);
    if (!teachers.length) throw new Error('No teachers found in the school. Add teachers first.');

    const catalog = await loadSubjectCatalog(schoolId, departmentId);

    // Load ALL existing bookings (they aren't deleted in preview mode)
    const existing = await prisma.timetableEntry.findMany({
      where: { schoolId, ...(departmentId ? { class: { departmentId } } : {}) },
      select: { classId: true, teacherId: true, subject: true, dayOfWeek: true, startTime: true },
    });

    // Build teacher-subject knowledge
    const existingSubjRows = await prisma.timetableEntry.findMany({
      where: { schoolId, ...(departmentId ? { class: { departmentId } } : {}) },
      select: { teacherId: true, subject: true }, distinct: ['teacherId', 'subject'],
    });
    const tSubj = buildTeacherSubjectMap(teachers, teacherSubjectMapping, existingSubjRows);

    const periods = buildPeriods(startHour, periodDuration, breakStart, breakEnd, lunchStart, lunchEnd);
    const result = generate(schoolId, classes, teachers, existing, catalog, periods, workingDays, maxLessonsPerTeacherPerDay, rooms, tSubj);

    const tMap = new Map(teachers.map((t) => [t.id, t.fullName]));
    const cMap = new Map(classes.map((c) => [c.id, c.name]));

    // Build preview slots with resolved names
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
