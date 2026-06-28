import { UserRole } from '@sams/shared';
import { isActionForbiddenForRole } from './roleRestrictions';
import { superAdminActions } from './handlers/superAdminHandlers';
import { schoolAdminActions } from './handlers/schoolAdminHandlers';
import { hodActions } from './handlers/hodHandlers';
import { teacherActions } from './handlers/teacherHandlers';
import { studentActions } from './handlers/studentHandlers';
import { guardianActions } from './handlers/guardianHandlers';
import { examActions, classAttendanceAction } from './handlers/examHandlers';
import { guardianLinkActions } from './handlers/guardianLinkAction';
import { timetableEditActions } from './handlers/timetableEditAction';
import { knowledgeActions } from './handlers/knowledgeHandlers';
import { profileActions } from './handlers/userProfileHandlers';
import { virtualAssistantActions } from './handlers/virtualAssistantActions';
import { teacherWorkbenchActions } from './handlers/teacherStudentWorkbenchActions';
import { classRepActions } from './handlers/classRepAction';
import { parentChatTeacherActions, parentChatGuardianActions } from './handlers/parentChatHandlers';
import { riskViewActions } from './handlers/riskViewHandlers';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionDefinition {
  action: string;
  description: string;
  destructive: boolean;
  patterns: RegExp[];
  extractParams: (message: string, match: RegExpMatchArray | null) => Record<string, unknown>;
  descriptionTemplate: (params: Record<string, unknown>) => string;
  handler: ActionHandler;
}

export type ActionHandler = (
  params: Record<string, unknown>,
  scope: ActionScope,
) => Promise<ActionResult>;

export interface ActionScope {
  userId: string;
  role: UserRole;
  schoolId: string;
  departmentId?: string;
  classId?: string;
}

export interface ActionResult {
  answer: string;
  data?: unknown;
}

export type RoleActionMap = Record<string, ActionDefinition[]>;

/** Coerce action patterns to RegExp[] (empty when missing; wrap a lone RegExp). */
export function normalizeActionPatterns(
  patterns: RegExp[] | RegExp | undefined | null,
): RegExp[] {
  if (patterns == null) return [];
  if (Array.isArray(patterns)) return patterns;
  return [patterns];
}

function normalizeRoleActions(actions: ActionDefinition[]): ActionDefinition[] {
  return actions.map((action) => ({
    ...action,
    patterns: normalizeActionPatterns(action.patterns),
  }));
}

// ─── Registry ─────────────────────────────────────────────────────────────────

// Registry - populated by handler imports
export const roleActionRegistry: RoleActionMap = {};

roleActionRegistry['SUPER_ADMIN'] = normalizeRoleActions([
  ...superAdminActions,
  ...profileActions,
  ...virtualAssistantActions,
  ...riskViewActions,
]);

roleActionRegistry['SCHOOL_ADMIN'] = normalizeRoleActions([
  ...schoolAdminActions,
  ...classRepActions,
  ...guardianLinkActions,
  ...knowledgeActions,
  ...examActions,
  ...profileActions,
  ...virtualAssistantActions,
  ...riskViewActions,
]);

roleActionRegistry['HOD'] = normalizeRoleActions([
  ...hodActions,
  ...teacherWorkbenchActions,
  ...knowledgeActions,
  ...examActions,
  ...timetableEditActions,
  ...profileActions,
  ...virtualAssistantActions,
  ...riskViewActions,
  classAttendanceAction,
]);

roleActionRegistry['TEACHER'] = normalizeRoleActions([
  ...teacherActions,
  ...teacherWorkbenchActions,
  ...classRepActions,
  ...knowledgeActions,
  ...examActions,
  ...profileActions,
  ...virtualAssistantActions,
  ...parentChatTeacherActions,
  ...riskViewActions,
  classAttendanceAction,
]);

roleActionRegistry['STUDENT'] = normalizeRoleActions([
  ...studentActions,
  ...examActions,
  ...profileActions,
  ...virtualAssistantActions,
]);

roleActionRegistry['GUARDIAN'] = normalizeRoleActions([
  ...guardianActions,
  ...profileActions,
  ...virtualAssistantActions,
  ...examActions,
  ...parentChatGuardianActions,
  ...riskViewActions,
]);

// ─── Lookup Utilities ─────────────────────────────────────────────────────────

export function getActionsForRole(role: string): ActionDefinition[] {
  return roleActionRegistry[role] ?? [];
}

export function findAction(role: string, actionName: string): ActionDefinition | undefined {
  return getActionsForRole(role).find((a) => a.action === actionName);
}

export function isActionPermitted(role: string, actionName: string): boolean {
  if (isActionForbiddenForRole(role, actionName)) return false;
  return getActionsForRole(role).some((a) => a.action === actionName);
}

export function getActionNames(role: string): string[] {
  return getActionsForRole(role).map((a) => a.action);
}
