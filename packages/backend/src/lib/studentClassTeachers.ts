import { prisma } from './prisma';

export interface StudentClassTeacherInfo {
  id: string;
  fullName: string;
  subjects: string[];
  isClassTeacher: boolean;
}

export interface StudentClassHodInfo {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export interface StudentClassContext {
  classId: string;
  className: string;
  departmentId: string;
  departmentName: string;
  hod: StudentClassHodInfo | null;
  teachers: StudentClassTeacherInfo[];
}

/**
 * Teachers a student may know: class teacher + anyone on their class timetable.
 * Same scope as notifications messaging allow-list.
 */
export async function getStudentClassContext(classId: string): Promise<StudentClassContext | null> {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: {
      id: true,
      name: true,
      classTeacherId: true,
      departmentId: true,
      department: { select: { name: true } },
    },
  });
  if (!cls) return null;

  const hodUser = await prisma.user.findFirst({
    where: { departmentId: cls.departmentId, role: 'HOD' },
    select: { id: true, fullName: true, email: true, phone: true },
  });
  const hod: StudentClassHodInfo | null = hodUser
    ? {
        id: hodUser.id,
        fullName: hodUser.fullName,
        email: hodUser.email,
        phone: hodUser.phone,
      }
    : null;

  const teacherIds = new Set<string>();
  if (cls.classTeacherId) teacherIds.add(cls.classTeacherId);

  const entries = await prisma.timetableEntry.findMany({
    where: { classId },
    select: { teacherId: true, subject: true },
  });
  for (const e of entries) teacherIds.add(e.teacherId);

  const departmentName = cls.department.name;
  const base = {
    classId: cls.id,
    className: cls.name,
    departmentId: cls.departmentId,
    departmentName,
    hod,
  };

  if (teacherIds.size === 0) {
    return { ...base, teachers: [] };
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

  return { ...base, teachers };
}

function formatHodContact(hod: StudentClassHodInfo): string {
  const parts: string[] = [];
  if (hod.email) parts.push(`email: ${hod.email}`);
  if (hod.phone) parts.push(`phone: ${hod.phone}`);
  return parts.length > 0 ? `\n\nContact: ${parts.join(' · ')}` : '';
}

export function formatStudentHodAnswer(ctx: StudentClassContext): string {
  const dept = ctx.departmentName;
  if (ctx.hod) {
    return `👤 **Your Head of Department** (${dept})\n\n**${ctx.hod.fullName}** is the HOD for your class department.${formatHodContact(ctx.hod)}\n\nYou may see messages from them on your **Notifications** page when they send department announcements.`;
  }
  return `Your class **${ctx.className}** is in the **${dept}** department, but no Head of Department is assigned in SAMS yet. Ask your class teacher or school office.`;
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
  const hodPart = ctx.hod
    ? `HOD (${ctx.departmentName}): ${ctx.hod.fullName}.`
    : `Department: ${ctx.departmentName}. No HOD assigned in SAMS yet.`;

  if (ctx.teachers.length === 0) {
    return `Class: ${ctx.className}. ${hodPart} No teachers on timetable yet.`;
  }
  const teacherLines = ctx.teachers.map((t) => {
    const parts = [t.fullName];
    if (t.isClassTeacher) parts.push('class teacher');
    if (t.subjects.length) parts.push(`subjects: ${t.subjects.join(', ')}`);
    return parts.join(' — ');
  });
  return `Class: ${ctx.className}. ${hodPart} Teachers the student may reference: ${teacherLines.join('; ')}.`;
}
