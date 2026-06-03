import { prisma } from './prisma';

export interface StudentClassTeacherInfo {
  id: string;
  fullName: string;
  subjects: string[];
  isClassTeacher: boolean;
}

export interface StudentClassContext {
  classId: string;
  className: string;
  teachers: StudentClassTeacherInfo[];
}

/**
 * Teachers a student may know: class teacher + anyone on their class timetable.
 * Same scope as notifications messaging allow-list.
 */
export async function getStudentClassContext(classId: string): Promise<StudentClassContext | null> {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: { id: true, name: true, classTeacherId: true },
  });
  if (!cls) return null;

  const teacherIds = new Set<string>();
  if (cls.classTeacherId) teacherIds.add(cls.classTeacherId);

  const entries = await prisma.timetableEntry.findMany({
    where: { classId },
    select: { teacherId: true, subject: true },
  });
  for (const e of entries) teacherIds.add(e.teacherId);

  if (teacherIds.size === 0) {
    return { classId: cls.id, className: cls.name, teachers: [] };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...teacherIds] } },
    select: { id: true, fullName: true },
  });
  const subjectByTeacher = new Map<string, Set<string>>();
  for (const e of entries) {
    const set = subjectByTeacher.get(e.teacherId) ?? new Set<string>();
    set.add(e.subject);
    subjectByTeacher.set(e.teacherId, set);
  }

  const teachers: StudentClassTeacherInfo[] = users
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      subjects: [...(subjectByTeacher.get(u.id) ?? [])].sort(),
      isClassTeacher: u.id === cls.classTeacherId,
    }))
    .sort((a, b) => {
      if (a.isClassTeacher !== b.isClassTeacher) return a.isClassTeacher ? -1 : 1;
      return a.fullName.localeCompare(b.fullName);
    });

  return { classId: cls.id, className: cls.name, teachers };
}

export function formatStudentTeachersAnswer(ctx: StudentClassContext): string {
  if (ctx.teachers.length === 0) {
    return `You are in **${ctx.className}**, but no teachers are listed on your timetable yet. Ask your class rep or school office if this looks wrong.`;
  }

  const lines = ctx.teachers.map((t) => {
    const role = t.isClassTeacher ? ' (class teacher)' : '';
    const subjects = t.subjects.length > 0 ? ` — teaches ${t.subjects.join(', ')}` : '';
    return `• **${t.fullName}**${role}${subjects}`;
  });

  return `👩‍🏫 **Your teachers** (${ctx.className})\n\n${lines.join('\n')}\n\nSay **"show my timetable"** to see when each subject is scheduled.`;
}

export function formatStudentClassContextForPrompt(ctx: StudentClassContext): string {
  if (ctx.teachers.length === 0) {
    return `Class: ${ctx.className}. No teachers on timetable yet.`;
  }
  const teacherLines = ctx.teachers.map((t) => {
    const parts = [t.fullName];
    if (t.isClassTeacher) parts.push('class teacher');
    if (t.subjects.length) parts.push(`subjects: ${t.subjects.join(', ')}`);
    return parts.join(' — ');
  });
  return `Class: ${ctx.className}. Teachers the student may reference: ${teacherLines.join('; ')}.`;
}
