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
  // Any role that can see this info in their dashboard should get it from AI too
  return [UserRole.STUDENT, UserRole.TEACHER, UserRole.HOD, UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN].includes(user.role);
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
