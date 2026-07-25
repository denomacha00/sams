import { type AccessTokenPayload, UserRole } from '@sams/shared';
import type { AIQueryResult } from './localEngine';
import { findAction, type ActionScope } from './roleActionRegistry';
import {
  detectStudentContextAction,
  isSchoolPersonnelQuery,
  isStudentContextQuery,
  SCHOOL_ADMIN_LOOKUP_ROLES,
} from './studentContextQuery';

export { isSchoolPersonnelQuery, isStudentContextQuery };
export { detectStudentContextAction as detectRoleContextAction } from './studentContextQuery';

/** Resolve handler registry role — prefer the caller's role for shared actions like list_school_admin or list_my_hod. */
function resolveRegistryRole(userRole: UserRole, action: string): UserRole {
  if (findAction(userRole, action)) return userRole;
  // Shared/lookup actions registered under STUDENT but useful for all roles
  const studentSharedActions = ['list_school_admin', 'list_my_hod', 'list_my_teachers', 'who_is_class_rep', 'describe_my_class', 'describe_my_department'];
  if (studentSharedActions.includes(action) && findAction(UserRole.STUDENT, action)) {
    return UserRole.STUDENT;
  }
  return userRole;
}

function canRunRoleContextAction(user: AccessTokenPayload, action: string): boolean {
  if (action === 'list_school_admin') {
    return SCHOOL_ADMIN_LOOKUP_ROLES.includes(user.role);
  }
  // Guardians can ask about their child's teachers / HOD / class / department.
  if (user.role === UserRole.GUARDIAN) {
    return ['list_my_hod', 'list_my_teachers', 'describe_my_class', 'describe_my_department', 'who_is_class_rep'].includes(action);
  }
  // Any role that can see this info in their dashboard should get it from AI too
  return [UserRole.STUDENT, UserRole.TEACHER, UserRole.HOD, UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN].includes(user.role);
}

/**
 * Role-appropriate handler for actions that STUDENT handlers serve via classId,
 * but non-student roles need to answer via departmentId or their own identity.
 *
 * Returns a result when the role needs special handling, null to fall through to
 * the normal registry lookup (which works fine for students).
 */
/**
 * Resolve a guardian's linked child's classId. Returns the classId of the single
 * linked child, or the first linked child that has a class. null when none.
 */
async function resolveGuardianChildClassId(
  guardianId: string,
  schoolId: string,
): Promise<{ classId: string; childName: string } | null> {
  const { prisma } = await import('../../lib/prisma');
  const links = await prisma.guardian.findMany({
    where: { guardianId, schoolId },
    select: { student: { select: { fullName: true, classId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const withClass = links.find((l) => l.student?.classId);
  if (!withClass?.student?.classId) return null;
  return { classId: withClass.student.classId, childName: withClass.student.fullName };
}

async function handleNonStudentContextAction(
  user: AccessTokenPayload,
  action: string,
): Promise<AIQueryResult | null> {
  const role = user.role;
  if (role === UserRole.STUDENT) return null; // handled by normal path

  // GUARDIAN — answer about their linked child's class (teachers, HOD, dept, rep).
  if (role === UserRole.GUARDIAN) {
    const child = await resolveGuardianChildClassId(user.sub, user.schoolId);
    if (!child) {
      return {
        answer:
          'No linked student with a class was found for your parent account. Ask the school admin to link you to your child.',
        intent: action,
      };
    }
    const { getStudentClassContext, formatStudentHodAnswer, formatStudentTeachersAnswer } =
      await import('../../lib/studentClassTeachers');
    const ctx = await getStudentClassContext(child.classId);
    if (!ctx) {
      return { answer: 'I could not find your child\'s class. Contact your school admin.', intent: action };
    }
    switch (action) {
      case 'list_my_hod':
        return { answer: formatStudentHodAnswer(ctx).replace(/your class department/gi, `${child.childName}'s department`), intent: action };
      case 'list_my_teachers':
        return { answer: formatStudentTeachersAnswer(ctx).replace(/Your teachers/gi, `${child.childName}'s teachers`), intent: action };
      case 'describe_my_class':
        return { answer: `📚 **${child.childName}'s class**\n\n${child.childName} is in **${ctx.className}** (${ctx.departmentName} department).`, intent: action };
      case 'describe_my_department': {
        const hodLine = ctx.hod ? ` Head of Department: **${ctx.hod.fullName}**.` : ' No HOD is assigned in SAMS yet.';
        return { answer: `🏫 **${child.childName}'s department**\n\n${child.childName} is in **${ctx.departmentName}** (class **${ctx.className}**).${hodLine}`, intent: action };
      }
      case 'who_is_class_rep': {
        const { prisma } = await import('../../lib/prisma');
        const rep = await prisma.user.findFirst({
          where: { classId: child.classId, role: 'STUDENT', isClassRep: true },
          select: { fullName: true },
        });
        if (!rep) {
          return { answer: `No class representative is assigned for **${ctx.className}** yet.`, intent: action };
        }
        return { answer: `🎓 **Class representative** (${ctx.className})\n\n**${rep.fullName}** is the class rep for ${child.childName}'s class.`, intent: action };
      }
      default:
        return null;
    }
  }

  // HOD asking "who is my HOD" — they ARE the HOD
  if (action === 'list_my_hod' && role === UserRole.HOD) {
    const { prisma } = await import('../../lib/prisma');
    const hod = await prisma.user.findUnique({
      where: { id: user.sub },
      select: { fullName: true, email: true, phone: true, department: { select: { name: true } } },
    });
    if (!hod) return { answer: 'Could not load your profile. Contact school admin.', intent: action };
    const dept = hod.department?.name ?? 'your department';
    const contact: string[] = [];
    if (hod.email) contact.push(`email: ${hod.email}`);
    if (hod.phone) contact.push(`phone: ${hod.phone}`);
    const contactLine = contact.length > 0 ? `\n\nContact: ${contact.join(' · ')}` : '';
    return {
      answer: `👤 **Head of Department** (${dept})\n\nYou (**${hod.fullName}**) are the HOD for ${dept}.${contactLine}`,
      intent: action,
    };
  }

  // TEACHER or HOD asking "who is my HOD" — look up via departmentId
  if (action === 'list_my_hod' && (role === UserRole.TEACHER || role === UserRole.SCHOOL_ADMIN)) {
    const { prisma } = await import('../../lib/prisma');
    const me = await prisma.user.findUnique({
      where: { id: user.sub },
      select: { departmentId: true },
    });
    const deptId = me?.departmentId ?? user.departmentId;
    if (!deptId) {
      return {
        answer: 'Your account is not linked to a department, so I cannot look up the HOD. Contact your school admin.',
        intent: action,
      };
    }
    const hodUser = await prisma.user.findFirst({
      where: { departmentId: deptId, role: 'HOD' },
      select: { fullName: true, email: true, phone: true, department: { select: { name: true } } },
    });
    const dept = hodUser?.department?.name ?? 'your department';
    if (!hodUser) {
      return { answer: `No HOD is assigned to **${dept}** yet. Ask your school admin to assign one.`, intent: action };
    }
    const contact: string[] = [];
    if (hodUser.email) contact.push(`email: ${hodUser.email}`);
    if (hodUser.phone) contact.push(`phone: ${hodUser.phone}`);
    const contactLine = contact.length > 0 ? `\n\nContact: ${contact.join(' · ')}` : '';
    return {
      answer: `👤 **Head of Department** (${dept})\n\n**${hodUser.fullName}** is the HOD for your department.${contactLine}`,
      intent: action,
    };
  }

  // TEACHER or HOD asking "my department"
  if (action === 'describe_my_department' && (role === UserRole.TEACHER || role === UserRole.HOD)) {
    const { prisma } = await import('../../lib/prisma');
    const me = await prisma.user.findUnique({
      where: { id: user.sub },
      select: { departmentId: true, department: { select: { name: true } } },
    });
    const deptId = me?.departmentId ?? user.departmentId;
    const deptName = me?.department?.name;
    if (!deptId || !deptName) {
      return {
        answer: 'Your account is not linked to a department yet. Contact your school admin.',
        intent: action,
      };
    }
    const hodUser = await prisma.user.findFirst({
      where: { departmentId: deptId, role: 'HOD' },
      select: { fullName: true },
    });
    const hodLine = hodUser ? ` Head of Department: **${hodUser.fullName}**.` : ' No HOD is assigned yet.';
    return {
      answer: `🏫 **Your department**\n\nYou are in **${deptName}**.${hodLine}`,
      intent: action,
    };
  }

  // TEACHER asking "my class" — teachers may teach multiple classes
  if (action === 'describe_my_class' && role === UserRole.TEACHER) {
    const { prisma } = await import('../../lib/prisma');
    const { resolveTeacherTeachingClassIds } = await import('../../lib/teacherScope');
    const classIds = await resolveTeacherTeachingClassIds(user.sub, user.classId);
    if (classIds.length === 0) {
      return { answer: 'You are not assigned to any classes yet. Contact your school admin.', intent: action };
    }
    const classes = await prisma.class.findMany({
      where: { id: { in: classIds } },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    const list = classes.map((c) => `**${c.name}**`).join(', ');
    return {
      answer: `📚 **Your classes**\n\nYou teach: ${list}.`,
      intent: action,
    };
  }

  // TEACHER asking "my teachers" — show their own profile + colleagues in same dept
  if (action === 'list_my_teachers' && role === UserRole.TEACHER) {
    const { prisma } = await import('../../lib/prisma');
    const me = await prisma.user.findUnique({
      where: { id: user.sub },
      select: { fullName: true, email: true, phone: true, departmentId: true },
    });
    if (!me) return null;
    const deptId = me.departmentId ?? user.departmentId;
    if (!deptId) {
      const contact: string[] = [];
      if (me.email) contact.push(`email: ${me.email}`);
      if (me.phone) contact.push(`phone: ${me.phone}`);
      return {
        answer: `👤 **Your profile**\n\n**${me.fullName}**${contact.length ? ` — ${contact.join(' · ')}` : ''}`,
        intent: action,
      };
    }
    const colleagues = await prisma.user.findMany({
      where: { departmentId: deptId, role: 'TEACHER', schoolId: user.schoolId },
      select: { fullName: true, email: true, phone: true },
      orderBy: { fullName: 'asc' },
    });
    const lines = colleagues.map((t) => {
      const c: string[] = [];
      if (t.email) c.push(`email: ${t.email}`);
      if (t.phone) c.push(`phone: ${t.phone}`);
      return `• **${t.fullName}**${c.length ? ` — ${c.join(' · ')}` : ''}`;
    });
    return {
      answer: `👩‍🏫 **Teachers in your department (${colleagues.length})**\n\n${lines.join('\n')}`,
      intent: action,
    };
  }

  // HOD asking "my teachers" — already has view_department_teachers action, but handle here too
  if (action === 'list_my_teachers' && role === UserRole.HOD) {
    const deptId = user.departmentId;
    if (!deptId) {
      return { answer: 'Your account is not linked to a department. Contact school admin.', intent: action };
    }
    const { fetchDepartmentTeachers } = await import('./departmentStatsQuery');
    const teachers = await fetchDepartmentTeachers(user.schoolId, deptId);
    if (teachers.length === 0) {
      return { answer: 'No teachers are assigned to your department yet.', intent: action };
    }
    const lines = teachers.map((t) => `• **${t.fullName}**`);
    return {
      answer: `👩‍🏫 **Teachers in your department (${teachers.length})**\n\n${lines.join('\n')}`,
      intent: action,
    };
  }

  return null; // fall through to normal registry path
}

/**
 * DB-backed answers for school personnel and student self-context queries (all roles).
 * Never LLM for school admin / HOD / teachers / class phrasing matched by patterns.
 */
export async function queryRoleContext(
  user: AccessTokenPayload,
  question: string,
): Promise<AIQueryResult | null> {
  const action = detectStudentContextAction(question);
  if (!action || !canRunRoleContextAction(user, action)) return null;

  // Non-student roles need role-appropriate answers (not the classId-dependent student handlers)
  const nonStudentResult = await handleNonStudentContextAction(user, action);
  if (nonStudentResult !== null) return nonStudentResult;

  const registryRole = resolveRegistryRole(user.role, action);
  const actionDef = findAction(registryRole, action);
  if (!actionDef) return null;

  const scope: ActionScope = {
    userId: user.sub,
    role: user.role,
    schoolId: user.schoolId,
    departmentId: user.departmentId,
    classId: user.classId,
  };

  const result = await actionDef.handler({}, scope);
  return {
    answer: result.answer,
    intent: action,
    data: result.data,
  };
}
