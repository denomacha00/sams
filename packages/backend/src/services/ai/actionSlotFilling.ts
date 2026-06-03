import { UserRole, type AccessTokenPayload } from '@sams/shared';
import { prisma } from '../../lib/prisma';
import { resolveTeacherClassId } from '../../lib/teacherScope';
import { findAction } from './roleActionRegistry';
import type { PendingAction } from './aiTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlotName =
  | 'message'
  | 'notifyScope'
  | 'classId'
  | 'className'
  | 'departmentName'
  | 'fullName'
  | 'role'
  | 'email'
  | 'targetRole'
  | 'maxUses'
  | 'teacherName'
  | 'studentName'

const NOTIFICATION_ACTIONS = new Set([
  'send_class_message',
  'send_class_notification',
  'send_department_notification',
  'send_school_notification',
]);

const DESTRUCTIVE_CONFIRM_ACTIONS = new Set([
  'send_class_message',
  'send_class_notification',
  'send_department_notification',
  'send_school_notification',
  'remove_user',
  'end_session',
]);

/** Required slots per action (order matters — first missing is asked). */
const ACTION_SLOT_ORDER: Record<string, SlotName[]> = {
  send_class_message: ['message'],
  send_class_notification: ['classId', 'message'],
  send_department_notification: ['notifyScope', 'departmentName', 'message'],
  send_school_notification: ['notifyScope', 'message'],
  add_user: ['fullName', 'role'],
  remove_user: ['fullName'],
  add_teacher: ['teacherName'],
  mark_attendance: ['studentName'],
  create_class: ['className'],
  create_department: ['departmentName'],
};

const DEFAULT_REGISTRATION_MAX_USES = 50;
const DEFAULT_REGISTRATION_EXPIRY_DAYS = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function normalizeRoleAnswer(text: string): string | undefined {
  const t = text.trim().toLowerCase();
  if (/^(student|pupil)s?$/.test(t)) return 'STUDENT';
  if (/^(teacher|staff)s?$/.test(t)) return 'TEACHER';
  if (/^(hod|head)s?$/.test(t)) return 'HOD';
  if (/^(admin|school\s*admin)$/.test(t)) return 'SCHOOL_ADMIN';
  const upper = text.trim().toUpperCase();
  if (['STUDENT', 'TEACHER', 'HOD', 'SCHOOL_ADMIN'].includes(upper)) return upper;
  return undefined;
}

function parseTargetRoleAnswer(text: string): 'STUDENT' | 'TEACHER' | 'HOD' | undefined {
  const t = text.trim().toLowerCase();
  if (/^(student|pupil)s?$/.test(t)) return 'STUDENT';
  if (/^(teacher|staff)s?$/.test(t)) return 'TEACHER';
  if (/^(hod|head)s?$/.test(t)) return 'HOD';
  const upper = text.trim().toUpperCase();
  if (upper === 'STUDENT' || upper === 'TEACHER' || upper === 'HOD') return upper;
  return undefined;
}

function parseMaxUsesAnswer(text: string): number | undefined {
  if (/^default$/i.test(text.trim())) return DEFAULT_REGISTRATION_MAX_USES;
  const match = text.match(/\d+/);
  if (!match) return undefined;
  const n = parseInt(match[0], 10);
  return n > 0 ? n : undefined;
}

function parseNotifyScopeAnswer(text: string): 'department' | 'school' | 'class' | undefined {
  const t = text.trim().toLowerCase();
  if (/^(department|dept|whole\s+department|my\s+department)$/.test(t)) return 'department';
  if (/^(school|whole\s+school|school[\s-]wide|everyone)$/.test(t)) return 'school';
  if (/^(class|my\s+class|a\s+class|specific\s+class)$/.test(t)) return 'class';
  return undefined;
}

// ─── DB context for role-aware questions ──────────────────────────────────────

async function listDepartmentClasses(
  schoolId: string,
  departmentId: string,
): Promise<Array<{ id: string; name: string }>> {
  return prisma.class.findMany({
    where: { schoolId, departmentId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

async function listSchoolDepartments(schoolId: string): Promise<Array<{ id: string; name: string }>> {
  return prisma.department.findMany({
    where: { schoolId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

async function resolveClassByName(
  schoolId: string,
  departmentId: string | undefined,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const cls = await prisma.class.findFirst({
    where: {
      schoolId,
      ...(departmentId ? { departmentId } : {}),
      name: { contains: name.trim(), mode: 'insensitive' },
    },
    select: { id: true, name: true },
  });
  return cls;
}

function getRegistrationLinkSlotOrder(
  user: AccessTokenPayload,
  params: Record<string, unknown>,
): SlotName[] {
  if (user.role === UserRole.TEACHER) {
    return ['classId', 'maxUses'];
  }
  if (user.role === UserRole.HOD) {
    const order: SlotName[] = ['targetRole'];
    const target = String(params.targetRole ?? '').toUpperCase();
    if (target === 'STUDENT') order.push('classId');
    order.push('maxUses');
    return order;
  }
  if (user.role === UserRole.SCHOOL_ADMIN) {
    const order: SlotName[] = ['targetRole'];
    const target = String(params.targetRole ?? '').toUpperCase();
    if (target === 'STUDENT' || target === 'TEACHER') order.push('departmentName');
    if (target === 'STUDENT') order.push('classId');
    order.push('maxUses');
    return order;
  }
  return ['classId', 'maxUses'];
}

async function resolveDepartmentByName(
  schoolId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  return prisma.department.findFirst({
    where: { schoolId, name: { contains: name.trim(), mode: 'insensitive' } },
    select: { id: true, name: true },
  });
}

// ─── Slot resolution (defaults + inference) ───────────────────────────────────

/**
 * Apply role defaults and resolve names → IDs before checking missing slots.
 */
export async function resolveActionParams(
  user: AccessTokenPayload,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resolved = { ...params };

  if (user.role === UserRole.TEACHER && action === 'send_class_message') {
    if (!resolved.classId) {
      const classId = await resolveTeacherClassId(user.sub, user.classId);
      if (classId) resolved.classId = classId;
    }
  }

  if (action === 'create_registration_link') {
    if (user.role === UserRole.TEACHER) {
      if (!resolved.targetRole) resolved.targetRole = 'STUDENT';
      if (!resolved.classId) {
        const classId = await resolveTeacherClassId(user.sub, user.classId);
        if (classId) resolved.classId = classId;
      }
    }
    if (user.role === UserRole.HOD && !resolved.departmentId && user.departmentId) {
      resolved.departmentId = user.departmentId;
    }
  }

  if (NOTIFICATION_ACTIONS.has(action) && !resolved.notifyScope) {
    if (action === 'send_school_notification' && isFilled(resolved.message)) {
      resolved.notifyScope = 'school';
    }
    else if (
      action === 'send_department_notification' &&
      user.role === UserRole.HOD &&
      isFilled(resolved.message)
    ) {
      resolved.notifyScope = 'department';
    } else if (action === 'send_class_message' || action === 'send_class_notification') {
      resolved.notifyScope = 'class';
    }
  }

  if (resolved.className && !resolved.classId && user.schoolId) {
    const deptId =
      user.role === UserRole.HOD ? user.departmentId : undefined;
    const cls = await resolveClassByName(user.schoolId, deptId, String(resolved.className));
    if (cls) {
      resolved.classId = cls.id;
      resolved.className = cls.name;
    }
  }

  if (resolved.departmentName && !resolved.departmentId && user.schoolId) {
    const dept = await resolveDepartmentByName(user.schoolId, String(resolved.departmentName));
    if (dept) resolved.departmentId = dept.id;
  }

  return resolved;
}

/**
 * Infer notify scope / action from a slot answer (HOD/Admin multi-target notifications).
 */
export function applySlotAnswer(
  action: string,
  slot: SlotName,
  answer: string,
  params: Record<string, unknown>,
  role: string,
): { action: string; params: Record<string, unknown> } {
  const next = { ...params };

  switch (slot) {
    case 'notifyScope': {
      const scope = parseNotifyScopeAnswer(answer);
      if (scope) next.notifyScope = scope;
      else {
        // Treat as class name when listing classes
        next.notifyScope = 'class';
        next.className = answer.trim();
      }
      break;
    }
    case 'message':
      next.message = answer.trim();
      break;
    case 'fullName':
      next.fullName = answer.trim();
      break;
    case 'role': {
      const roleVal = normalizeRoleAnswer(answer);
      if (roleVal) next.role = roleVal;
      else next.role = answer.trim().toUpperCase();
      break;
    }
    case 'email':
      next.email = answer.trim();
      break;
    case 'departmentName':
      next.departmentName = answer.trim();
      break;
    case 'classId': {
      const trimmed = answer.trim();
      if (/^[a-z0-9]{20,}$/i.test(trimmed)) next.classId = trimmed;
      else next.className = trimmed;
      break;
    }
    case 'className':
      next.className = answer.trim();
      break;
    case 'teacherName':
      next.teacherName = answer.trim();
      break;
    case 'studentName':
      next.studentName = answer.trim();
      break;
    case 'targetRole': {
      const roleVal = parseTargetRoleAnswer(answer);
      if (roleVal) next.targetRole = roleVal;
      else next.targetRole = answer.trim().toUpperCase();
      break;
    }
    case 'maxUses': {
      const uses = parseMaxUsesAnswer(answer);
      if (uses) next.maxUses = uses;
      break;
    }
    default:
      next[slot] = answer.trim();
  }

  let effectiveAction = action;

  if (NOTIFICATION_ACTIONS.has(action) && slot === 'notifyScope') {
    const scope = String(next.notifyScope ?? '');
    if (role === UserRole.HOD) {
      if (scope === 'class') effectiveAction = 'send_class_notification';
      else effectiveAction = 'send_department_notification';
    } else if (role === UserRole.SCHOOL_ADMIN) {
      if (scope === 'school') effectiveAction = 'send_school_notification';
      else if (scope === 'department') effectiveAction = 'send_department_notification';
      else if (scope === 'class') effectiveAction = 'send_class_notification';
    }
  }

  if (slot === 'className' || (slot === 'notifyScope' && next.className)) {
    if (role === UserRole.HOD || role === UserRole.SCHOOL_ADMIN) {
      effectiveAction = 'send_class_notification';
      next.notifyScope = 'class';
    }
  }

  return { action: effectiveAction, params: next };
}

function needsNotifyScopePrompt(role: string, action: string, params: Record<string, unknown>): boolean {
  if (!isFilled(params.notifyScope)) {
    if (role === UserRole.HOD && action === 'send_department_notification' && !isFilled(params.message)) {
      return true;
    }
    if (role === UserRole.SCHOOL_ADMIN) {
      const broad =
        action === 'send_department_notification' ||
        action === 'send_school_notification' ||
        action === 'send_class_notification';
      if (broad && !isFilled(params.message)) return true;
    }
  }
  return false;
}

/**
 * Return the next slot to collect, or null if ready for confirm/execute.
 */
export async function getNextMissingSlot(
  user: AccessTokenPayload,
  action: string,
  params: Record<string, unknown>,
): Promise<SlotName | null> {
  const resolved = await resolveActionParams(user, action, params);
  const order =
    action === 'create_registration_link'
      ? getRegistrationLinkSlotOrder(user, resolved)
      : ACTION_SLOT_ORDER[action] ?? [];

  if (needsNotifyScopePrompt(user.role, action, resolved) && !isFilled(resolved.notifyScope)) {
    return 'notifyScope';
  }

  for (const slot of order) {
    if (slot === 'notifyScope') continue;

    if (slot === 'targetRole') {
      if (!isFilled(resolved.targetRole)) return slot;
      continue;
    }

    if (slot === 'maxUses') {
      if (!isFilled(resolved.maxUses)) return slot;
      continue;
    }

    if (slot === 'departmentName') {
      if (
        resolved.notifyScope !== 'department' &&
        action !== 'create_department' &&
        action !== 'create_registration_link'
      ) {
        continue;
      }
      if (action === 'create_registration_link') {
        const target = String(resolved.targetRole ?? '').toUpperCase();
        if (target !== 'STUDENT' && target !== 'TEACHER') continue;
      }
      if (user.role === UserRole.HOD) continue;
      const depts = await listSchoolDepartments(user.schoolId);
      if (depts.length <= 1 && depts[0]) {
        resolved.departmentId = depts[0].id;
        resolved.departmentName = depts[0].name;
        continue;
      }
      if (!isFilled(resolved.departmentName) && !isFilled(resolved.departmentId)) return slot;
      continue;
    }

    if (slot === 'classId') {
      if (action === 'create_registration_link') {
        const target = String(resolved.targetRole ?? '').toUpperCase();
        if (target !== 'STUDENT') continue;
      } else if (
        resolved.notifyScope !== 'class' &&
        action !== 'send_class_notification'
      ) {
        continue;
      }
      if (isFilled(resolved.classId)) continue;

      const deptId =
        user.role === UserRole.HOD || user.role === UserRole.TEACHER
          ? user.departmentId
          : action === 'create_registration_link' && isFilled(resolved.departmentId)
            ? String(resolved.departmentId)
            : undefined;
      if (!deptId && user.role === UserRole.HOD && action === 'create_registration_link') {
        return slot;
      }
      if (!deptId && user.role === UserRole.HOD) return slot;

      const classes = deptId
        ? await listDepartmentClasses(user.schoolId, deptId)
        : await prisma.class.findMany({
            where: { schoolId: user.schoolId },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          });

      if (classes.length === 1) {
        resolved.classId = classes[0].id;
        continue;
      }
      if (!isFilled(resolved.className)) return 'classId';
      continue;
    }

    if (!isFilled(resolved[slot])) return slot;
  }

  // Re-check message for notification actions after scope resolution
  if (NOTIFICATION_ACTIONS.has(action) && !isFilled(resolved.message)) {
    return 'message';
  }

  return null;
}

/**
 * Build a single clear question for the missing slot (role-aware).
 */
export async function buildSlotQuestion(
  user: AccessTokenPayload,
  action: string,
  slot: SlotName,
  params: Record<string, unknown>,
): Promise<string> {
  switch (slot) {
    case 'notifyScope': {
      if (user.role === UserRole.HOD) {
        const classes = user.departmentId
          ? await listDepartmentClasses(user.schoolId, user.departmentId)
          : [];
        const classList =
          classes.length > 0
            ? classes.map((c) => `**${c.name}**`).join(', ')
            : '(no classes found)';
        return (
          `Who should receive this notification?\n` +
          `• Reply **department** for everyone in your department\n` +
          `• Or reply with a class name: ${classList}`
        );
      }
      if (user.role === UserRole.SCHOOL_ADMIN) {
        return (
          `What is the scope for this notification?\n` +
          `• Reply **school** for a school-wide message\n` +
          `• Reply **department** then I'll ask which department\n` +
          `• Reply **class** then I'll ask which class`
        );
      }
      return 'What should receive this notification — department or a specific class?';
    }
    case 'message':
      return 'What is the message text you want to send?';
    case 'classId': {
      const deptId =
        user.role === UserRole.HOD
          ? user.departmentId
          : undefined;
      const classes = deptId
        ? await listDepartmentClasses(user.schoolId, deptId!)
        : await prisma.class.findMany({
            where: { schoolId: user.schoolId },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
            take: 30,
          });
      if (classes.length === 0) {
        if (action === 'create_registration_link') {
          return 'Which class is this registration link for? (No classes found in your department.)';
        }
        return 'Which class should receive this? (No classes found in your scope.)';
      }
      const names = classes.map((c) => `**${c.name}**`).join(', ');
      if (action === 'create_registration_link') {
        return `Which class should the new student join? Reply with one of: ${names}`;
      }
      return `Which class should receive this? Reply with one of: ${names}`;
    }
    case 'departmentName': {
      const depts = await listSchoolDepartments(user.schoolId);
      if (depts.length === 0) return 'Which department? (None found — create a department first.)';
      const names = depts.map((d) => `**${d.name}**`).join(', ');
      return `Which department? Reply with one of: ${names}`;
    }
    case 'fullName':
      return 'What is the person\'s full name?';
    case 'role':
      return 'What role should they have? Reply **student**, **teacher**, **HOD**, or **school admin**.';
    case 'teacherName':
      return 'Which teacher should be assigned? (Full name)';
    case 'studentName':
      return 'Which student? (Full name)';
    case 'targetRole':
      if (user.role === UserRole.HOD) {
        return (
          'Who should this registration link be for?\n' +
          '• Reply **student** for a class enrollment link\n' +
          '• Reply **teacher** to invite a teacher to your department'
        );
      }
      return 'What role is the link for? Reply **student**, **teacher**, or **HOD**.';
    case 'maxUses':
      return (
        `How many people can use this link? (Default on the dashboard is **${DEFAULT_REGISTRATION_MAX_USES}** — reply with a number, e.g. "50".)`
      );
    case 'className':
      return 'What should the new class be called?';
    default:
      return `Please provide ${slot}.`;
  }
}

export function actionRequiresConfirmation(role: string, action: string): boolean {
  const def = findAction(role, action);
  if (def?.destructive) return true;
  return DESTRUCTIVE_CONFIRM_ACTIONS.has(action);
}

export function buildPendingFromIntent(
  action: string,
  params: Record<string, unknown>,
  description: string,
  awaitingSlot?: SlotName,
): PendingAction {
  return {
    action,
    params,
    description,
    awaitingSlot,
  };
}

export function mergePendingDescription(
  role: string,
  action: string,
  params: Record<string, unknown>,
): string {
  const def = findAction(role, action);
  if (!def) return `Complete ${action}`;
  return def.descriptionTemplate(params);
}
